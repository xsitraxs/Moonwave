import type HlsType from "hls.js";
import type { ErrorData } from "hls.js";
import { EQ_BANDS } from "@shared/ipc";
import type { AudioHealth } from "@shared/audioHealth";
import { MAX_REBUILDS, REBUILD_BUDGET_MS, chainLostAction, graphAction, isPolicyRefusal, recoveryStep, teardownIsCurrent } from "@shared/audioHealth";
import type { ErrorCode, StreamInfo, Track } from "@shared/types";
import { call, errorCode } from "@/lib/sky";

/**
 * Playback. SoundCloud streams AAC over HLS (hls.js feeds it through Media Source Extensions); a progressive MP3
 * plays directly. Stream URLs are signed and short-lived, so a network failure mid-track asks main for a fresh URL
 * once and resumes at the same position.
 *
 * Two decks (an <audio> each) make the crossfade: near the end of a track the next one starts on the other deck and
 * the two volumes cross over. The equalizer is a Web Audio chain that is only built once it's switched on — until
 * then the decks play straight to the speakers and cost nothing extra.
 */
export interface EngineEvents {
  loading(): void;
  playing(): void;
  paused(): void;
  ended(): void;
  duration(seconds: number): void;
  time(seconds: number): void;
  error(code: ErrorCode): void;
  /** the next track to crossfade into (and whose stream to play: a substitute upload's id), or null */
  peekNext(): { track: Track; streamId: number } | null;
  /** the track's own stream turned out to be a 30 s preview */
  snippet(track: Track): void;
  /** a crossfade moved playback on to `track` */
  advanced(track: Track): void;
  /** does the player mean to be heard right now? (the engine rebuilds only what the person actually wanted) */
  wanted(): boolean;
}

let Hls: typeof HlsType | null = null;
const loadHls = async () => (Hls ??= (await import("hls.js/light")).default);

let events: EngineEvents | null = null;
let volume = 0.8;
let muted = false;
let crossfade = 0;
let sinkId = "";

// ---- the optional Web Audio chain (equalizer, the sound-reactive sky) ----------------------------------------------

/**
 * The Web Audio chain is only ever an *addition* to the output, never the only path to the speakers.
 *
 * Handing a deck over is one-way and permanent for its element: createMediaElementSource moves the element's sound out
 * of the speakers and into the graph, and there is no way back — a routed element stays in the graph until the app is
 * reloaded. Everything here follows from that one fact:
 *
 * - a deck is handed over only while the context is running, and only on a machine that can route at all (with hardware
 *   acceleration off Chromium does not route element media, and a routed element would simply be silent);
 * - the chain is never closed while a deck is inside it (graphAction): switching the equalizer or the sky off keeps it
 *   until a restart puts the decks on fresh elements, instead of silencing them;
 * - a context that dies is cleaned up through its own identity (teardownIsCurrent), so cleaning up the old one can
 *   never close the new one recovery just built.
 */
let chainCarries = false;

/** the gain a deck was given in the current context; an element can be routed only once, so this also tells "already done" */
const routedElements = new WeakMap<HTMLAudioElement, GainNode>();

let ctx: AudioContext | null = null;
let bus: GainNode | null = null;
let filters: BiquadFilterNode[] = [];
let eq = { enabled: false, gains: EQ_BANDS.map(() => 0) as number[] };
/** what asked for the chain: the equalizer, the sound-reactive sky, or both */
let graphWanted = new Set<"eq" | "reactive">();
/** the setting that turns hardware acceleration off: an element cannot be routed through Web Audio there */
let memorySaver = false;

/** the muted error name, so a refusal that is normal is not logged as a fault */
let lastChainError = "";

function fault(what: string) {
  const line = `audio: ${what}`;
  if (line === lastChainError) return;
  lastChainError = line;
  // through main, so it sits in the same log a report attaches
  void call("log:write", line).catch(() => undefined);
  reportHealth();
}

/**
 * Whether an element's own output can be handed over to the chain. With hardware acceleration off (the memory saver on
 * a machine without a graphics card) Chromium keeps an element's media in software and routes none of it through Web
 * Audio: creating the source node empties the element without filling the chain. There the chain cannot carry, and the
 * decks stay on their own output — the visual reaction then simply has nothing to read.
 */
const canRoute = () => !memorySaver;

function buildChain() {
  const c = new AudioContext({ latencyHint: "playback" });
  const b = c.createGain();
  const next = EQ_BANDS.map((hz, i) => {
    const f = c.createBiquadFilter();
    f.type = i === 0 ? "lowshelf" : i === EQ_BANDS.length - 1 ? "highshelf" : "peaking";
    f.frequency.value = hz;
    f.Q.value = 1.1;
    return f;
  });
  b.connect(next[0]!);
  next.forEach((f, i) => f.connect(next[i + 1] ?? c.destination));
  ctx = c;
  bus = b;
  filters = next;
  c.addEventListener("statechange", onContextState);
  for (const deck of decks) deck.route();
  applyEq();
  if (sinkId) void applySink();
  // only a running context carries sound; a suspended one is woken (and until then the elements speak for themselves)
  if (stateOf(c) === "running") setChainCarries(true);
  else void wakeChain();
}

/**
 * Brings a dead chain back: a new context and fresh nodes, each deck routed into it again, and the output device
 * applied. Returns false when there is nothing to rebuild, so a caller doesn't throw away decks for nothing.
 */
function rebuildChain() {
  const decks_ = decks.filter((d) => d.track);
  ctx?.close().catch(() => undefined);
  ctx = null;
  bus = null;
  filters = [];
  analyserNode = null;
  if (!graphWanted.size || !canRoute()) {
    // nothing wants a chain, or this machine cannot route one: the decks keep playing on their own
    chainCarries = false;
    decks.forEach((d) => d.applyLevel());
    reportHealth();
    return decks_.length > 0;
  }
  buildChain();
  return decks_.length > 0;
}

/**
 * The chain carries the sound only while its context runs. Turning that on hands every playing deck over to it (the
 * element's own output is muted then, and the graph carries the sample-exact copy); turning it off is the emergency:
 * the decks' elements may be stranded in a graph that no longer produces sound, so the tract is rebuilt on fresh ones.
 */
function setChainCarries(next: boolean) {
  if (chainCarries === next) return;
  chainCarries = next;
  if (next) decks.forEach((d) => d.route());
  decks.forEach((d) => d.applyLevel());
  reportHealth();
}

function onContextState() {
  const dead = ctx;
  if (!dead) return;
  if (stateOf(dead) === "closed") {
    fault("the audio context closed itself");
    // The context is already gone; what is left is to detach it *by identity*. Recovery is not started from here:
    // it builds a new context synchronously, and anything this handler did afterwards would race that new one. It is
    // started from a timeout below, once this handler has finished and the old context is forgotten.
    const stranded = decks.some((d) => routedElements.has(d.audio));
    const wanted = events?.wanted() ?? false;
    setChainCarries(false);
    teardownChain(dead);
    if (chainLostAction({ stranded, wanted }) === "detach-and-recover") {
      window.setTimeout(() => void recoverSound("the audio context closed itself"), 0);
    }
    return;
  }
  // running: the chain carries the sound (and the elements are muted). Suspended: it does not, so the elements are
  // heard; play() and attach() wake it again. This is the whole safety property — never a muted element without a
  // chain that can be heard.
  // read the same reference the closed branch above used, so the compiler sees it cannot be null here
  setChainCarries(stateOf(dead) === "running");
}

/**
 * Forgets a specific context and lets its decks go back to their own output. The argument is the point: a context is
 * closed only by a caller that holds it, and only while it is still the current one — recovery builds a new context
 * synchronously, and closing "whatever `ctx` is now" would kill the replacement instead of the corpse.
 */
function teardownChain(c: AudioContext | null) {
  // the identity gate: a corpse or an already-replaced context is left alone, so recovery's new one cannot be hit here
  if (!c || !teardownIsCurrent(c, ctx)) return;
  ctx = null;
  bus = null;
  filters = [];
  analyserNode = null;
  chainCarries = false;
  c.close().catch(() => undefined);
  // decks routed by that context hold a gain node that leads nowhere; the element's own output takes over
  for (const d of decks) {
    d.gain = null;
    d.applyLevel();
  }
  reportHealth();
}

function applyEq() {
  filters.forEach((f, i) => (f.gain.value = eq.enabled ? (eq.gains[i] ?? 0) : 0));
}

/** with the chain on, the audio graph sleeps while nothing plays (it would keep a thread busy) */
let sleepTimer = 0;
function sleepSoon() {
  window.clearTimeout(sleepTimer);
  sleepTimer = window.setTimeout(() => {
    if (!ctx || !decks.every((d) => d.audio.paused)) return;
    // suspending is safe: the elements carry the sound while the chain sleeps, and resume() wakes it
    setChainCarries(false);
    void ctx.suspend();
  }, 1500);
}

/**
 * Reads the state, so the compiler doesn't narrow it: a context changes on its own, outside this function's control
 * ("interrupted" is Windows putting it aside while another app has the device exclusively).
 */
const stateOf = (c: AudioContext): AudioContextState => c.state;

/** Wakes a sleeping or interrupted chain, and notes a context that can no longer be brought back. */
async function wakeChain() {
  const c = ctx;
  if (!c) return;
  const before = stateOf(c);
  if (before === "running" || before === "closed") return;
  try {
    await c.resume();
  } catch {
    setChainCarries(false);
    fault(`the audio context would not resume (${before}) — the decks play on their own output`);
    return;
  }
  if (ctx !== c) return;
  const after = stateOf(c);
  if (after === "running") setChainCarries(true);
  else {
    // the elements carry the sound while the chain can't; the next play() tries again
    setChainCarries(false);
    fault(`the audio context stayed ${after} — the decks play on their own output`);
  }
}

// ---- decks --------------------------------------------------------------------------------------------------------

class Deck {
  /**
   * The <audio> this deck plays through. Replaced (not reused) when the sound has to go back to the speakers: an
   * element handed to createMediaElementSource can never leave the graph again, so a fresh one is the only way out.
   */
  audio = new Audio();
  hls: HlsType | null = null;
  track: Track | null = null;
  /** the track whose stream plays: the track itself, or the other upload substituted for it */
  streamId = 0;
  /** bumped on every load: answers for an older track are ignored */
  gen = 0;
  refreshed = false;
  mediaRecovered = false;
  /** a track is starting: the pause events the old source fires while switching are not a real pause */
  starting = false;
  /** 0..1, the crossfade's share of this deck */
  level = 1;
  gain: GainNode | null = null;

  constructor() {
    this.prepare();
  }

  /** Gives the deck a fresh element with its listeners (also used after a rebuild, see replaceElement). */
  private prepare() {
    this.audio.preload = "auto";
    // so the equalizer may read the samples (SoundCloud's CDN answers with CORS; main adds the header if missing)
    this.audio.crossOrigin = "anonymous";
    const on = (ev: string, fn: () => void) => this.audio.addEventListener(ev, () => this === active && fn());
    on("playing", () => {
      this.starting = false;
      events?.playing();
    });
    on("pause", () => {
      if (!this.audio.ended && !this.starting) events?.paused();
      sleepSoon();
    });
    on("waiting", () => events?.loading());
    on("ended", () => events?.ended());
    on("durationchange", () => {
      if (Number.isFinite(this.audio.duration)) events?.duration(this.audio.duration);
    });
    on("timeupdate", () => {
      events?.time(this.audio.currentTime);
      maybeCrossfade();
    });
    this.audio.addEventListener("error", () => {
      if (!this.hls && this.track) void this.recover("offline");
    });
    this.applyLevel();
  }

  /**
   * Trades the element for a fresh one: the sound goes back to the speakers, and the old (routed, now unused) element
   * is dropped. What it was playing is not carried over — the caller reloads the track on the new element.
   */
  replaceElement() {
    this.hls?.destroy();
    this.hls = null;
    this.gain = null;
    const old = this.audio;
    old.pause();
    old.removeAttribute("src");
    old.load();
    this.audio = new Audio();
    this.prepare();
  }

  /**
   * Hand this deck's sound to the Web Audio chain. A routed element can't go back to the speakers, so this happens only
   * while a live context exists and the machine can route; a context that is merely suspended is woken, and until it
   * runs the element's own output stays audible (see applyLevel).
   */
  route() {
    if (!ctx || !bus || !canRoute()) return;
    if (routedElements.has(this.audio)) return;
    const src = ctx.createMediaElementSource(this.audio);
    const gain = ctx.createGain();
    src.connect(gain).connect(bus);
    routedElements.set(this.audio, gain);
    this.gain = gain;
    this.applyLevel();
  }

  /**
   * The volume, wherever the sound actually leaves the app: the chain's gain while this deck is handed over, the
   * element's own volume otherwise (the crossfade slides whichever is in use).
   */
  applyLevel() {
    const v = muted ? 0 : volume * volume * this.level;
    const level = Math.max(0, Math.min(1, v));
    if (this.gain) this.gain.gain.value = level;
    // the element's own copy is muted only while the chain actually carries the sound; while it is asleep or lost, the
    // element is the sound (and a suspended context can be woken by play())
    this.audio.volume = this.gain && chainCarries ? 0 : level;
  }

  teardown() {
    this.hls?.destroy();
    this.hls = null;
    this.audio.removeAttribute("src");
    this.audio.load();
  }

  attach(info: StreamInfo, startAt: number, autoplay: boolean) {
    this.teardown();
    const H = Hls;
    if (info.protocol === "hls" && H?.isSupported()) {
      // no worker: the page's CSP stays strict, and remuxing a single audio stream is light
      const hls = new H({ enableWorker: false, startPosition: startAt > 0 ? startAt : -1, maxBufferLength: 60, backBufferLength: 30 });
      this.hls = hls;
      hls.on(H.Events.ERROR, (_e, data: ErrorData) => {
        if (!data.fatal) return;
        if (data.type === H.ErrorTypes.MEDIA_ERROR && !this.mediaRecovered) {
          this.mediaRecovered = true;
          hls.recoverMediaError();
          return;
        }
        void this.recover(data.type === H.ErrorTypes.NETWORK_ERROR ? "offline" : "unknown");
      });
      hls.loadSource(info.url);
      hls.attachMedia(this.audio);
    } else {
      this.audio.src = info.url;
      if (startAt > 0) this.audio.addEventListener("loadedmetadata", () => (this.audio.currentTime = startAt), { once: true });
    }
    if (autoplay) {
      this.starting = true;
      void wakeChain();
      void this.audio.play().catch(() => {
        this.starting = false;
        if (this === active) events?.paused();
      });
    }
  }

  /** The signed URL probably expired: get a new one once and continue where we were. */
  async recover(code: ErrorCode) {
    const track = this.track;
    if (!track) return;
    if (this.refreshed) {
      if (this === active) events?.error(code);
      return;
    }
    this.refreshed = true;
    const at = this.audio.currentTime;
    const wasPlaying = !this.audio.paused;
    const gen = this.gen;
    try {
      const info = await call("data:stream", this.streamId);
      if (info.protocol === "hls") await loadHls();
      if (gen !== this.gen) return;
      this.attach(info, at, wasPlaying);
    } catch (err) {
      if (gen === this.gen && this === active) events?.error(errorCode(err));
    }
  }

  /** Resolves true once the stream is attached (and playing, with autoplay). */
  async load(track: Track, opts: { autoplay: boolean; startAt?: number; streamId?: number }): Promise<boolean> {
    const gen = ++this.gen;
    this.track = track;
    this.streamId = opts.streamId ?? track.id;
    this.refreshed = false;
    this.mediaRecovered = false;
    this.starting = opts.autoplay;
    this.teardown();
    try {
      const info = await call("data:stream", this.streamId);
      if (info.protocol === "hls") await loadHls();
      if (gen !== this.gen) return false;
      this.attach(info, opts.startAt ?? 0, opts.autoplay);
      if (info.snipped && this.streamId === track.id && track.playability === "ok") events?.snippet(track);
      return true;
    } catch (err) {
      if (gen === this.gen) {
        this.starting = false;
        if (this === active) events?.error(errorCode(err));
      }
      return false;
    }
  }

  stop() {
    this.gen++;
    this.track = null;
    this.audio.pause();
    this.teardown();
  }
}

const decks = [new Deck(), new Deck()] as const;
let active: Deck = decks[0];
const other = () => (active === decks[0] ? decks[1] : decks[0]);

// ---- crossfade ----------------------------------------------------------------------------------------------------

let fade: { from: Deck; to: Deck; startedAt: number; length: number; timer: number } | null = null;
let preparing = false;

function endFade() {
  if (!fade) return;
  window.clearInterval(fade.timer);
  fade.from.stop();
  fade.from.level = 1;
  fade.to.level = 1;
  fade.from.applyLevel();
  fade.to.applyLevel();
  fade = null;
}

function maybeCrossfade() {
  if (!crossfade || fade || preparing || active.audio.paused) return;
  const left = active.audio.duration - active.audio.currentTime;
  if (!Number.isFinite(left) || left > crossfade || left < 0.5) return;
  const next = events?.peekNext();
  if (!next) return;
  preparing = true;
  const from = active;
  const to = other();
  const length = Math.max(0.5, left);
  to.level = 0;
  to.applyLevel();
  void to.load(next.track, { autoplay: true, streamId: next.streamId }).then((ok) => {
    preparing = false;
    if (!ok || from !== active || from.audio.paused) {
      if (to !== active) to.stop();
      return;
    }
    // the next track is now the current one; the old deck fades out underneath
    active = to;
    events?.advanced(next.track);
    if (Number.isFinite(to.audio.duration)) events?.duration(to.audio.duration);
    const startedAt = performance.now();
    fade = {
      from,
      to,
      startedAt,
      length,
      timer: window.setInterval(() => {
        const k = Math.min(1, (performance.now() - startedAt) / (length * 1000));
        from.level = 1 - k;
        to.level = k;
        from.applyLevel();
        to.applyLevel();
        if (k >= 1) endFade();
      }, 50),
    };
  });
}

// ---- public -------------------------------------------------------------------------------------------------------

export const currentTime = () => active.audio.currentTime;
/** whose stream the current deck plays (the track's own id, or a substitute upload's) */
export const activeStreamId = () => active.streamId;

export function bindEngine(handlers: EngineEvents) {
  events = handlers;
}

export async function load(track: Track, opts: { autoplay: boolean; startAt?: number; streamId?: number }) {
  endFade();
  preparing = false;
  other().stop();
  active.level = 1;
  active.applyLevel();
  events?.loading();
  const ok = await active.load(track, opts);
  if (ok && !opts.autoplay) events?.paused();
}

export function stop() {
  endFade();
  decks.forEach((d) => d.stop());
}

export function play() {
  if (!active.track) return;
  void wakeChain();
  void active.audio.play().catch((err: unknown) => {
    if (isPolicyRefusal(err)) {
      // the page hasn't been clicked yet (a tray command, a hotkey): not a fault, and the next click plays
      events?.paused();
      return;
    }
    // the element itself won't start: the output is broken in a way only a rebuilt tract may fix
    events?.error("audio");
  });
}

export function pause() {
  endFade();
  active.audio.pause();
}

export function seek(seconds: number) {
  if (!Number.isFinite(seconds)) return;
  endFade();
  active.audio.currentTime = Math.max(0, seconds);
}

/**
 * A touch faster or slower (a listening room catching up with the others), the pitch kept; a new track starts at 1.
 */
export function setRate(rate: number) {
  const r = Math.max(0.9, Math.min(1.1, rate));
  for (const d of decks) {
    d.audio.preservesPitch = true;
    if (d.audio.playbackRate !== r) d.audio.playbackRate = r;
  }
}

/** 0..1 slider → a curve that feels even to the ear */
export function setVolume(v: number, m: boolean) {
  volume = Math.max(0, Math.min(1, v));
  muted = m;
  decks.forEach((d) => d.applyLevel());
}

export function setCrossfade(seconds: number) {
  crossfade = Math.max(0, Math.min(12, seconds));
}

/**
 * The equalizer. Switching it on builds the Web Audio chain; switching it off (with nothing else wanting the chain)
 * hands the sound back to the elements, so a decorative graph never stays in the path of the sound for nothing.
 */
export function setEq(next: { enabled: boolean; gains: number[] }) {
  eq = next;
  syncGraph();
  applyEq();
  reportHealth();
}

/** how long a deck may sit inside a chain nothing wants before it is moved onto fresh elements */
const STRANDED_RESTART_MS = 12_000;
/** when a deck was first found stranded in a chain nothing wants (0 = not stranded) */
let graphStrandedSince = 0;

/** Keeps the chain in step with what wants it: the equalizer, the sound-reactive sky, and this machine's ability to route. */
function syncGraph() {
  const wanted = new Set<"eq" | "reactive">();
  if (eq.enabled) wanted.add("eq");
  if (reactiveWanted) wanted.add("reactive");
  graphWanted = wanted;
  const stranded = decks.some((d) => routedElements.has(d.audio));
  const action = graphAction({ wanted: wanted.size, hasChain: !!ctx, stranded, canRoute: canRoute() });
  if (action === "keep" && stranded) {
    if (!graphStrandedSince) graphStrandedSince = performance.now();
  } else if (action !== "keep" || !stranded) {
    graphStrandedSince = 0;
  }
  if (action === "idle" || action === "keep") {
    // "keep" can mean a deck is still inside a graph nothing wants any more. Closing it would silence that deck, and
    // the only way out of a graph is fresh elements — so the track is reloaded once, on purpose. The window being
    // hidden or minimised must not trigger that reload on its own, so a minimum listening time is required (a pause
    // gives every deck a slow fade first, which keeps this floor from firing on the usual cases).
    if (action === "keep" && stranded && (events?.wanted() ?? false) && graphStrandedSince > 0 && performance.now() - graphStrandedSince > STRANDED_RESTART_MS) {
      graphStrandedSince = 0;
      void restartDecks();
    }
    return;
  }
  if (action === "blocked") {
    // hardware acceleration is off: an element routed through Web Audio goes silent here, so the decks stay on theirs
    fault("the audio graph stays off: with the memory saver on, Chromium does not route an element's sound through Web Audio");
    return;
  }
  if (action === "build") {
    buildChain();
    reportHealth();
    return;
  }
  // "drop": nothing wants the chain and no deck is inside it, so closing it cannot silence anything
  teardownChain(ctx);
}

/** the sound-reactive sky asked for the chain (or stopped asking) */
let reactiveWanted = false;
export function setReactive(on: boolean) {
  if (reactiveWanted === on) return;
  reactiveWanted = on;
  syncGraph();
}

/** the memory saver setting: it decides whether an element can be routed at all */
export function setMemorySaver(on: boolean) {
  if (memorySaver === on) return;
  memorySaver = on;
  syncGraph();
}

let analyserNode: AnalyserNode | null = null;

/**
 * The sound-reactive sky's ear: an analyser listening to the chain's output, after the equalizer, or null when there
 * is no chain to listen to (the sky then keeps its resting look).
 */
export function analyser(): AnalyserNode | null {
  const c = ctx;
  if (!c || !chainCarries) return null;
  if (!analyserNode) {
    analyserNode = c.createAnalyser();
    analyserNode.fftSize = 1024;
    analyserNode.smoothingTimeConstant = 0.3;
    filters[filters.length - 1]!.connect(analyserNode);
  }
  return analyserNode;
}

/**
 * Audio output device ("" = the system default). The outcome is kept for the report — a chosen device that has gone
 * away is a common reason for silence, and until now it failed without a trace.
 */
export async function setOutput(id: string) {
  // the default device needs no call: setSinkId starts Chromium's media device service (and its video capture
  // helper, ~60 MB) even for ""
  if (id === sinkId) return;
  sinkId = id;
  await applySink();
}

async function applySink() {
  const id = sinkId;
  // wherever the sound leaves the app: the graph while it carries, and every element that still plays on its own.
  // One failing must not keep the other from being set, so both are asked and the first failure is what gets reported.
  const targets: Promise<void>[] = [];
  if (ctx && "setSinkId" in ctx) targets.push((ctx as AudioContext & { setSinkId(id: string): Promise<void> }).setSinkId(id));
  for (const deck of decks) if (!routedElements.has(deck.audio)) targets.push(deck.audio.setSinkId(id));
  const results = await Promise.allSettled(targets);
  const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failed) {
    // the device is gone: stay on the current one, and say so in the report and the log
    const err = failed.reason as unknown;
    sinkError = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    fault(`the output device could not be used (${sinkError}) — the current one plays on`);
  } else sinkError = null;
  reportHealth();
}

// ---- health: what main needs to explain a silence the window called "playing" -------------------------------------

let sinkError: string | null = null;
let rebuilds = 0;

/** The analyser's loudest bin, sampled by the reporter below; null while there is no analyser. */
let peak: Uint8Array<ArrayBuffer> | null = null;

function measure(): number | null {
  const node = analyserNode;
  if (!node || !ctx || !chainCarries) return null;
  peak ??= new Uint8Array(node.frequencyBinCount);
  node.getByteFrequencyData(peak);
  let loudest = 0;
  for (let i = 0; i < peak.length; i++) if (peak[i]! > loudest) loudest = peak[i]!;
  return loudest;
}

function health(): AudioHealth {
  const deck = active;
  return {
    context: ctx ? ctx.state : "none",
    graph: graphWanted.size === 2 ? "both" : graphWanted.has("eq") ? "eq" : graphWanted.has("reactive") ? "reactive" : "off",
    stream: deck.hls ? "hls" : deck.track ? "progressive" : "none",
    element: !deck.track ? "none" : deck.audio.paused ? "paused" : deck.audio.readyState < 3 ? "waiting" : "playing",
    volume,
    muted,
    output: sinkId ? "custom" : "default",
    sinkError,
    level: measure(),
    rebuilds,
  };
}

let healthTimer = 0;
let lastHealth = "";

/** Sends the engine's account of its output to main (for the report and the log). Coalesced, so the player can call it freely. */
export function reportHealth() {
  window.clearTimeout(healthTimer);
  healthTimer = window.setTimeout(() => {
    const next = health();
    const key = JSON.stringify(next);
    if (key === lastHealth) return;
    lastHealth = key;
    void call("audio:health", next).catch(() => undefined);
  }, 0);
}

// ---- recovery -----------------------------------------------------------------------------------------------------

/** rebuilds spent on the current trouble, and when the first one came */
let spent: number[] = [];
/** set while a rebuild has already been decided: the steps it causes must not buy a second one */
let inRebuild = false;

/**
 * The recovery budget, shared by every caller: a crash event, a context that died, the watchdog, Retry. Without one
 * place to count, each trigger would get its own free rebuilds and a crash loop would reload the stream forever.
 */
export function recoveryBudget(): { spent: number; max: number } {
  const now = performance.now();
  spent = spent.filter((at) => now - at < REBUILD_BUDGET_MS);
  return { spent: spent.length, max: MAX_REBUILDS };
}
/** the recovery in flight, so a burst of crash events rebuilds once */
let recovering: Promise<void> | null = null;

/**
 * The sound matters and isn't happening: put the tract back. Bounded — a rebuild reloads the stream, so a few are
 * allowed per minute (a crash loop is continuous; a one-off crash gets a fresh start); after that the player is told
 * plainly that the sound is broken instead of showing "playing" over silence.
 *
 * Called when a Chromium media helper died, when a context died under us, or when an element refused to play.
 */
export function recoverSound(why: string): Promise<void> {
  recovering ??= (async () => {
    // a rebuild in flight causes reloads of its own (element teardown, a deck pause): those are not new trouble
    if (inRebuild) return;
    const now = performance.now();
    spent = spent.filter((at) => now - at < REBUILD_BUDGET_MS);
    const wanted = events?.wanted() ?? false;
    // only a sleeping context is cheaply woken; anything else (no context, or one that closed) needs fresh elements
    const resumable = ctx?.state === "suspended";
    const step = recoveryStep({ wanted, rebuilds: spent.length, resumable, dead: !resumable });
    if (step === "none") return;
    if (step === "give-up") {
      fault(`${why}; recovery gave up after ${spent.length} rebuilds — the player is told the sound is broken`);
      events?.error("audio");
      return;
    }
    if (step === "resume") {
      await wakeChain();
      if (chainCarries) return;
    }
    spent.push(now);
    rebuilds++;
    fault(`${why}; rebuilding the output (${spent.length}/${MAX_REBUILDS})`);
    inRebuild = true;
    try {
      await restartDecks();
    } finally {
      inRebuild = false;
    }
    reportHealth();
  })().finally(() => {
    recovering = null;
  });
  return recovering;
}

/**
 * The person pressed Retry on a sound error: forget what the automatic recovery spent and try once more. An explicit
 * click is a new attempt; holding it to the automatic budget would leave them stuck with a dead output.
 */
export function retrySound() {
  spent = [];
  return recoverSound("Retry pressed");
}

/**
 * Starts the current track over on fresh elements: an element handed to Web Audio can never play to the speakers
 * again, so this is the way back from a graph that stopped carrying (and the repair after a dead helper). The
 * position and the person's intention are kept; the crossfade's other deck is dropped rather than restored, since it
 * was a half-finished transition.
 */
async function restartDecks() {
  const track = active.track;
  const streamId = active.streamId;
  const at = active.audio.currentTime;
  const wasPlaying = !active.audio.paused;
  endFade();
  preparing = false;
  // Both decks, not just the one playing: a deck left holding an element from the old graph answers no route() and
  // keeps its own volume at 0, so the next crossfade into it would be silent — the very symptom this all exists to
  // prevent. Fresh elements for both, the inactive one empty and ready for the next crossfade.
  for (const d of decks) {
    d.stop();
    d.replaceElement();
  }
  chainCarries = false;
  rebuildChain();
  if (!track) return;
  // load() re-asks main for a stream URL (the signed one may have expired too) and plays on the fresh element
  const ok = await active.load(track, { autoplay: wasPlaying, startAt: at > 0 ? at : undefined, streamId });
  if (!ok) events?.error("audio");
  else if (!wasPlaying) events?.paused();
}

// a context can also be found dead later (it fell asleep and never came back): catch it whenever the report runs
setInterval(() => {
  if (!ctx || ctx.state !== "closed") return;
  void recoverSound("the audio context was closed");
}, 5000);

// dev only: drive the engine from DevTools (window.__engine.seek(25))
if (import.meta.env.DEV) (window as unknown as { __engine: unknown }).__engine = { seek, currentTime, decks };
