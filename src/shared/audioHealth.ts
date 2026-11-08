/**
 * The audio tract's health, shared by the page and main: what the engine says about its output, which media helper
 * a dead utility process was, and how many rebuilds a failure may cost. Kept free of stream URLs, tokens and device
 * ids — this is what "Report a problem" prints, so it must never carry anything private.
 */

/** What the engine reports about the output. Pushed to main so a report can explain silence the UI didn't show. */
export interface AudioHealth {
  /** the page's AudioContext, "none" when the Web Audio chain was never built ("interrupted" is Windows hiding it) */
  context: AudioContextState | "none";
  /** what asked for the Web Audio chain: the equalizer, the sound-reactive sky, both, or nothing */
  graph: "off" | "eq" | "reactive" | "both";
  /** the stream the current deck holds, and what that <audio> element itself reports */
  stream: "hls" | "progressive" | "none";
  element: "playing" | "paused" | "waiting" | "none";
  /** 0..1, the slider's value before the curve */
  volume: number;
  muted: boolean;
  output: "default" | "custom";
  /** why the last setSinkId failed (a device that is gone), null when it worked */
  sinkError: string | null;
  /**
   * Whether the decks are handed to the chain right now, so the sound leaves through Web Audio instead of the
   * element's own output. This is the pair that decides most silences, and it is the one thing a level cannot show:
   * "playing, graph running, routed, and the analyser hears nothing" is a different fault from "routed, and it is
   * loud in the graph but nobody hears it" (the output device), which is why both are reported.
   */
  routed: boolean;
  /** the loudest the analyser heard in the last second, 0..255; null without an analyser */
  level: number | null;
  /** rebuilds of the output this session (each one reloads the stream) */
  rebuilds: number;
}

const LONG = 200;
const short = (v: unknown) => (typeof v === "string" ? v.slice(0, LONG).replace(/https?:\/\/\S+/gi, "…") : null);

/**
 * What main keeps from the page's report. The page is the app's own, but this is what gets attached to a bug report
 * and written to the log, so the shape is enforced here: fixed sets for the states, numbers clamped, and any string
 * truncated with links removed — a device error message never smuggles a stream URL or a token into a report.
 */
export function sanitizeHealth(raw: AudioHealth): AudioHealth {
  const state = (v: unknown, set: readonly string[], fallback: string) => (typeof v === "string" && set.includes(v) ? v : fallback);
  const n = (v: unknown, min: number, max: number, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
  return {
    context: state(raw.context, ["none", "suspended", "running", "closed", "interrupted"], "none") as AudioHealth["context"],
    graph: state(raw.graph, ["off", "eq", "reactive", "both"], "off") as AudioHealth["graph"],
    stream: state(raw.stream, ["hls", "progressive", "none"], "none") as AudioHealth["stream"],
    element: state(raw.element, ["playing", "paused", "waiting", "none"], "none") as AudioHealth["element"],
    volume: n(raw.volume, 0, 1, AUDIO_HEALTH_DEFAULTS.volume),
    muted: raw.muted === true,
    output: raw.output === "custom" ? "custom" : "default",
    sinkError: short(raw.sinkError),
    routed: raw.routed === true,
    level: raw.level === null || raw.level === undefined ? null : Math.round(n(raw.level, 0, 255, 0)),
    rebuilds: Math.round(n(raw.rebuilds, 0, 999, 0)),
  };
}

/** What the engine knows before anything played. */
export const AUDIO_HEALTH_DEFAULTS: AudioHealth = {
  context: "none",
  graph: "off",
  stream: "none",
  element: "none",
  volume: 0.8,
  muted: false,
  output: "default",
  sinkError: null,
  routed: false,
  level: null,
  rebuilds: 0,
};

/** How a dead utility process relates to the sound. */
export type AudioUtilityRole = "audio" | "capture";

/**
 * Which media helper a gone utility process was. Chromium's "Audio Service" carries the sound; the "Video Capture"
 * helper is the media device service that setSinkId starts, so its death points at a chosen output device rather
 * than at the stream. Everything else (GPU, network, storage) is left out: the report says so separately.
 */
export function audioUtilityRole(type: string, name?: string): AudioUtilityRole | null {
  if (type !== "Utility") return null;
  const n = (name ?? "").toLowerCase();
  if (n.includes("video capture")) return "capture";
  // Windows calls it "Audio Service"; the mojo name on the other platforms is audio.mojom.AudioService
  if (n.includes("audio")) return "audio";
  return null;
}

/** The few Windows status codes worth naming, so a log line reads like something instead of a large negative number. */
const EXIT_NAMES: Record<string, string> = {
  "80000003": "STATUS_BREAKPOINT",
  c0000005: "STATUS_ACCESS_VIOLATION",
  c0000374: "STATUS_HEAP_CORRUPTION",
  c0000409: "STATUS_STACK_BUFFER_OVERRUN",
};

/**
 * A process exit code as the log and the report show it: the hexadecimal code, its Windows name when it has one,
 * and the signed 32-bit number Electron reports (-2147483645 is 0x80000003, STATUS_BREAKPOINT).
 */
export function exitText(code: number): string {
  if (code === 0) return "0";
  const hex = (code >>> 0).toString(16).padStart(8, "0");
  const name = EXIT_NAMES[hex];
  return `${name ? `0x${hex} ${name}` : `0x${hex}`} (${code})`;
}

/**
 * What to do about the Web Audio chain, given what wants it and what is already inside it. `canRoute` is not only a
 * setting: when Chromium ends up in software rendering (no graphics card, a blocked or crashed driver process), it does
 * not route an element's media through Web Audio either, and a routed element goes silent — so the answer to "does this
 * machine route" comes from the graphics status main reports, not from the memory saver alone.
 */
export type GraphAction =
  /** nothing wants a chain, and none exists */
  | "idle"
  /** the chain stays as it is */
  | "keep"
  /** something wants it and none exists yet */
  | "build"
  /** nothing wants it and no deck is inside it, so it can be closed */
  | "drop"
  /** something wants it, but this machine cannot route an element (hardware acceleration off, or no hardware rendering) */
  | "blocked";

/**
 * The chain's fate. The one rule that matters: a deck whose element was handed to Web Audio cannot return to the
 * speakers by itself, so the chain must never be closed while a deck is still inside it — that would be silence with a
 * player that says "playing". Closing it is only safe when nothing was routed through it.
 */
export function graphAction(s: { wanted: number; hasChain: boolean; stranded: boolean; canRoute: boolean }): GraphAction {
  if (s.wanted > 0) {
    if (!s.canRoute) return "blocked";
    return s.hasChain ? "keep" : "build";
  }
  if (!s.hasChain) return "idle";
  return s.stranded ? "keep" : "drop";
}

/** What a context that closed leaves behind: the chain is dropped, and the sound rebuilt only if it was inside the graph. */
export type ChainLostAction = "detach" | "detach-and-recover";

export function chainLostAction(s: { stranded: boolean; wanted: boolean }): ChainLostAction {
  return s.stranded && s.wanted ? "detach-and-recover" : "detach";
}

/**
 * Whether a teardown may close the context it was made for. Recovery creates a new context synchronously, so the
 * cleanup of the old one must be compared by identity: anything else would close the context recovery just built.
 */
export function teardownIsCurrent(dead: object | null, current: object | null): boolean {
  return current !== null && current !== undefined && dead === current;
}

/** Whether a play() failure is the ordinary autoplay policy rather than a broken output. */
export function isPolicyRefusal(err: unknown): boolean {
  const name = err && typeof err === "object" && "name" in err ? String((err as { name: unknown }).name) : "";
  // NotAllowedError: the page hasn't been interacted with yet (a tray click, a hotkey); the next click plays
  return name === "NotAllowedError";
}

/** What to do about a silent or broken output. */
export type RecoveryStep = "none" | "resume" | "rebuild" | "give-up";

/** Rebuilds one failure may cost: each one reloads the stream, so they are spent, not repeated forever. */
export const MAX_REBUILDS = 2;

/** After this much quiet between failures the budget is full again (the crash loops this guards against are continuous). */
export const REBUILD_BUDGET_MS = 60_000;

/**
 * The next step for a silent output: nothing while the person didn't ask for sound, a cheap resume while the context
 * only fell asleep, a rebuild while the budget lasts, and then a plain error for the UI instead of pretending to play.
 */
export function recoveryStep(s: {
  /** the player means to be heard (status playing, not paused by the person) */
  wanted: boolean;
  /** rebuilds already spent on this failure */
  rebuilds: number;
  /** a context exists and is suspended, which resume() can bring back */
  resumable: boolean;
  /** a context exists and is closed, or the decks are held by a graph that can never play again */
  dead: boolean;
}): RecoveryStep {
  if (!s.wanted) return "none";
  if (s.rebuilds >= MAX_REBUILDS) return "give-up";
  if (s.dead) return "rebuild";
  if (s.resumable) return "resume";
  return "rebuild";
}

/** How the page's graphics stack is doing, as Chromium reports it (electron's GPUFeatureStatus values are strings). */
export type GraphicsStatus = { gpuCompositing?: string; webgl?: string } | null | undefined;

/**
 * Whether an element's sound may be handed to Web Audio here.
 *
 * Hardware acceleration being off is only one way to end up unable to route; the other is Chromium falling back to
 * software rendering on its own — no usable graphics card, or a graphics process that died (the log then says
 * `gpu_compositing disabled_software`). In both cases `createMediaElementSource` takes the element's sound out of the
 * speakers without filling the chain, and the player plays silently while every state says "playing". So the chain is
 * built only when Chromium itself reports a working graphics stack, and a deck is never handed over when the answer
 * is unknown (no report yet).
 */
export function canRouteAudio(input: { memorySaver: boolean; graphics?: GraphicsStatus }): boolean {
  if (input.memorySaver) return false;
  const status = input.graphics;
  if (!status) return false;
  return status.gpuCompositing === "enabled" || status.webgl === "enabled";
}

/**
 * What a "playing" deck with a live route and a silent analyser means. The level is the only evidence of whether
 * samples ever reached the graph, so it separates the two silences that looked identical in every log so far:
 * nothing fed into the graph at all, or a graph that carries fine but whose output goes to a device nobody hears.
 */
export function silenceVerdict(h: Pick<AudioHealth, "element" | "routed" | "level" | "context" | "sinkError">): "playing-loud" | "silent-graph" | "silent-device" {
  if (h.element !== "playing" || !h.routed || h.level === null || h.level > 0) return "playing-loud";
  // nothing is in the graph: it was never fed (routing that did not work) or its context is not really running
  if (h.context !== "running" || !h.sinkError) return "silent-graph";
  return "silent-device";
}

/**
 * How long a running graph may carry nothing while its deck plays on, before routing is given up for the run. A quiet
 * passage still shows something in the analyser within a second or two; minutes of exact zero with the position
 * advancing is a graph that took the sound out of the speakers and gave nothing back.
 */
export const ROUTE_SILENCE_MS = 6_000;

/**
 * Whether a route that is supposed to carry the sound has failed silently. This is the one fault no state can show:
 * the context says "running", the element is handed over (and therefore muted), the player says "playing" — and the
 * graph never carries a sample, which is what an element torn out of the graph *into* a chain that cannot play it
 * looks like (a graphics process that died under the routing, a context that recovered into a graph with no input).
 */
export function routeIsSilent(s: { running: boolean; level: number | null; progressedSeconds: number }): boolean {
  // a playing deck that has moved on by any real amount while the analyser heard exact zero
  return s.running && s.level === 0 && s.progressedSeconds >= 0.5;
}

/** The crash tally a report prints. */
export interface AudioCrashTally {
  audio: number;
  capture: number;
  /** the last exit code and when it came, ISO time */
  lastExit: number | null;
  lastAt: string | null;
}

export const AUDIO_CRASH_TALLY: AudioCrashTally = { audio: 0, capture: 0, lastExit: null, lastAt: null };

/**
 * The report's audio section: the runtime that has to be healthy for any of this to work, what the engine last said,
 * and the media helpers that died. Safe by construction — the values are all counts, states and version strings.
 */
export function audioReportLines(input: {
  health: AudioHealth | null;
  crashes: AudioCrashTally;
  /** from process.versions: the versions that actually run, not the ones package.json asks for */
  runtime: { electron: string; chrome: string };
  /** true when the sound-reactive sky or the equalizer put the sound through Web Audio */
  webAudioInUse: boolean;
}): string[] {
  const { health, crashes, runtime } = input;
  const lines = [`runtime: Electron ${runtime.electron}, Chromium ${runtime.chrome}`];
  if (!health) {
    lines.push("audio: the page has not reported yet (nothing played, or the page is older than this report)");
  } else {
    const chain = health.context === "none" ? "off (decks play straight to the speakers)" : `${health.graph}, context ${health.context}`;
    const device = health.output === "default" ? "system default" : "chosen in Settings";
    lines.push(`audio: ${health.element}, stream ${health.stream}; output ${device}${health.sinkError ? ` (last setSinkId failed: ${health.sinkError})` : ""}`);
    // where the sound actually leaves the app: the graph (and then the analyser can say whether anything is in it) or
    // the element's own output. Without this line a report could not tell a silent graph from a silent device.
    const path = health.routed ? "sound through the graph" : "sound straight from the deck";
    lines.push(`audio: Web Audio chain ${chain}, ${path}${health.muted ? ", muted" : `, volume ${Math.round(health.volume * 100)}%`}${health.level === null ? "" : `, analyser peak ${health.level}/255`}; rebuilds ${health.rebuilds}`);
    if (input.webAudioInUse && health.context !== "none") {
      lines.push("audio: the sound is routed through Web Audio for the equalizer or the sound-reactive sky, so a dead context silences it while <audio> still reports playing");
    }
  }
  if (!crashes.audio && !crashes.capture) {
    lines.push("audio helpers: none crashed this session");
  } else {
    const parts = [];
    if (crashes.audio) parts.push(`audio service ${crashes.audio}×`);
    if (crashes.capture) parts.push(`video capture ${crashes.capture}×`);
    lines.push(`audio helpers: ${parts.join(", ")}${crashes.lastExit === null ? "" : `; last exit ${exitText(crashes.lastExit)}${crashes.lastAt ? ` at ${crashes.lastAt}` : ""}`}`);
  }
  return lines;
}

/** What a context's statechange event means, given whether that context is still the current one. */
export type ContextEvent = "ignore" | "closed" | "carry" | "asleep";

/**
 * A context can change after it has been torn down — recovery closes the old one itself, and the "closed" that
 * produces is really news to nobody; a late event from it must not touch the replacement's state. Only events from
 * the context that is current may be acted on, and only "closed" is a loss; anything else that is not "running"
 * (suspended, or Windows' "interrupted") simply means the chain cannot carry right now and the elements must.
 */
export function contextEventAction(s: { isCurrent: boolean; state: string }): ContextEvent {
  if (!s.isCurrent) return "ignore";
  if (s.state === "closed") return "closed";
  if (s.state === "running") return "carry";
  return "asleep";
}

/** What currently asks for a Web Audio chain: the equalizer and the sound-reactive sky, in either order. */
export function wantedGraph(eqEnabled: boolean, reactiveWanted: boolean): Set<"eq" | "reactive"> {
  const wanted = new Set<"eq" | "reactive">();
  if (eqEnabled) wanted.add("eq");
  if (reactiveWanted) wanted.add("reactive");
  return wanted;
}
