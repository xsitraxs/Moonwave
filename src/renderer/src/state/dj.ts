import { create } from "zustand";
import { isLocalTrack, type Page, type Track } from "@shared/types";
import { collectDjCandidates, DJ_COLLECT_DEFAULTS } from "@/lib/djCollect";
import { DJ_RANK_DEFAULTS, rankDjCandidates, type DjArtistVia, type DjPick, type DjSeed, type DjWhy } from "@/lib/djRank";
import { buildRoundSeeds, chainSeedId, decideDjNext, DJ_DRY_ROUNDS_TO_STOP, excludeDjRound, feedbackArtists, isRoundFailed, needsRefillAfterStart, type DjVote } from "@/lib/djRefill";
import { DJ_MIN_SEEDS, pickLikeSeeds, pickTrackSeeds } from "@/lib/djSources";
import { call } from "@/lib/sky";
import { canPlay, currentTrack, inRoom, player, queueGeneration, usePlayer } from "./player";
import { useRoom } from "./room";
import { useSettings } from "./settings";

/**
 * Moonwave DJ: one explicit session at a time, grown from its origin seeds (a track, likes, an artist, a playlist, a genre or mood wave). The
 * session owns the *suggestions* — fetching, ranking, appending, refilling — while the player keeps owning
 * playback, the queue, repeat, shuffle and the autopilot. The session never rewrites the queue behind the person's
 * back: the one hand-over is the start they asked for, and after it the session only appends.
 *
 * How the suggestions ride the queue: on start the session holds the autopilot's filler, drops its old tail
 * (player.setAutopilotSuspended/dropAutoTail) and — once the first round is in — takes over what came after the
 * current track (player.takeOverUpcoming): that is the hand-over the person asked for, so the DJ is heard at once
 * instead of after a queue they had built. The current track and what already played stay; later rounds only append
 * (player.appendMany), and the picks are flagged like hand-added tracks so shuffles keep them. The honest boundary is
 * not a queue index but the `reasons` map (track id → why it was picked): manual tracks have no entry, DJ tracks do,
 * whatever the order becomes.
 * When the session ends the autopilot resumes as the natural fallback; no writer races, because every queue
 * update reads and writes synchronously.
 *
 * Every round ranks from several seeds at once (co-occurrence needs them): the first round from the origin
 * seeds, refills from the chain tip, the session's thumbs-up and the origins — the roots that keep the drift
 * in check. The session watches the queue's generation, not the seeds' presence: it refills a thinning tail
 * and steps aside when another list (or a room) turns the queue over.
 *
 * A session ends when the person stops it, removes every suggestion, starts another list (or a room takes the
 * player), or the chain runs dry twice. Ending never yanks queued tracks and never leaves a flight behind:
 * every flight carries the session generation and an AbortController, and stale answers are dropped.
 */

export type DjStatus = "idle" | "loading" | "ready" | "error" | "empty" | "exhausted" | "stopped";

/**
 * What the session grows from: one track, recent likes, an artist's uploads (or a listener's likes),
 * a playlist, a genre wave (search results for the query), a mood wave (search results, a localized name).
 */
export type DjOrigin =
  | { kind: "track"; seed: DjSeed }
  | { kind: "likes" }
  | { kind: "artist"; userId: number; name: string; via: DjArtistVia }
  | { kind: "playlist"; id: string; title: string }
  | { kind: "genre"; query: string; name: string }
  | { kind: "mood"; query: string; name: string };

interface DjStore {
  /** a session runs: suggestions may still arrive */
  active: boolean;
  status: DjStatus;
  /** the session's origin seeds (what it started from); every refill round anchors back to these */
  seeds: DjSeed[];
  /** what the session grows from — kept for the honest status words (and the retry's way back) */
  origin: DjOrigin | null;
  /** a refill round is flying (the first round uses `loading` instead) */
  refilling: boolean;
  /** honest reasons, by suggested track id — kept after the session so queued tracks keep their labels */
  reasons: Record<number, DjWhy>;
  /** session-only thumbs up / down, by track id — gone with the session, never stored */
  votes: Record<number, DjVote>;
  /** session ratings apply to the ranking; pausing collects without applying */
  feedbackOn: boolean;
}

export const useDj = create<DjStore>(() => ({ active: false, status: "idle", seeds: [], origin: null, refilling: false, reasons: {}, votes: {}, feedbackOn: true }));

/** One collect+rank round may take this long before it counts as failed (a slow network, not a dead one). */
const DJ_FLIGHT_TIMEOUT_MS = 20_000;
/** ...a little more per extra seed (two waves of parallel requests), up to the ceiling below. */
const DJ_FLIGHT_TIMEOUT_PER_SEED_MS = 2_000;
const DJ_FLIGHT_TIMEOUT_MAX_MS = 35_000;
const flightTimeoutMs = (seeds: number) => Math.min(DJ_FLIGHT_TIMEOUT_MS + DJ_FLIGHT_TIMEOUT_PER_SEED_MS * Math.max(0, seeds - 1), DJ_FLIGHT_TIMEOUT_MAX_MS);

// ---- session machinery (not UI state: no re-renders, reset on every start/stop) ----------------------------------

/** appended suggestion ids, in append order; dismissed ones are filtered out (the chain seeds from the tail) */
let appended: number[] = [];
let appendedSet = new Set<number>();
let dismissed = new Set<number>();
/** errored rounds in a row (the auto-refill holds at DJ_MAX_REFILL_FAILURES) and dry ones (stop at DJ_DRY_ROUNDS_TO_STOP) */
let errStreak = 0;
let dryStreak = 0;
/** bumped on every flight and every stop: answers from an older generation are dropped */
let gen = 0;
/** a collect+rank flight is running (start or refill) */
let busy = false;
/** a flight's outcome is being written into the queue (the session's own turn-over, not another list's) */
let applying = false;
let flight: AbortController | null = null;
let timer = 0;
/** the queue generation the running session started on (the tick stops the session when it moves) */
let expectedQueueGen = 0;
/** session thumbs-up track ids, freshest first — the newest ones anchor the next refill round */
let voteOrder: number[] = [];

const set = useDj.setState;
const get = useDj.getState;

function resetMachinery() {
  appended = [];
  appendedSet = new Set();
  dismissed = new Set();
  errStreak = 0;
  dryStreak = 0;
  expectedQueueGen = queueGeneration();
  voteOrder = [];
  applying = false;
  if (flight) {
    flight.abort();
    flight = null;
  }
  window.clearTimeout(timer);
  timer = 0;
}

function artistOf(trackId: number): number | undefined {
  const inQueue = usePlayer.getState().queue.find((t) => t.id === trackId);
  if (inQueue) return inQueue.user.id;
  return useSettings.getState().history.find((t) => t.id === trackId)?.user.id;
}

function trackTitle(trackId: number): string | null {
  const { queue } = usePlayer.getState();
  return queue.find((t) => t.id === trackId)?.title ?? useSettings.getState().history.find((t) => t.id === trackId)?.title ?? null;
}

/** A first round replaces the queue's tail; later rounds append behind it. */
function excludeNow(kind: "start" | "refill"): number[] {
  const { queue, index } = usePlayer.getState();
  const { history } = useSettings.getState();
  return excludeDjRound(kind, queue.map((t) => t.id), index, history.map((t) => t.id), [...dismissed]);
}

interface RoundOutcome {
  picks: DjPick[];
  failed: boolean;
}

async function runRound(roundSeeds: readonly DjSeed[], signal: AbortSignal, kind: "start" | "refill"): Promise<RoundOutcome> {
  const { candidates, failedSeeds } = await collectDjCandidates(roundSeeds, (id) => call("data:related", id), { signal, ...DJ_COLLECT_DEFAULTS });
  // one seed's failure never sinks the rest: only all-failed is a failed round (a lone seed behaves as before)
  if (isRoundFailed(failedSeeds, roundSeeds.map((s) => s.id))) return { picks: [], failed: true };
  const s = get();
  // a sourced session explains by its origin group (the count is the real overlap, shown only when it hits)
  const seedIds = s.seeds.map((sd) => sd.id);
  const groups =
    s.origin?.kind === "likes"
      ? { likes: seedIds }
      : s.origin?.kind === "artist"
        ? { artist: { ids: seedIds, name: s.origin.name, via: s.origin.via } }
        : s.origin?.kind === "playlist"
          ? { playlist: { ids: seedIds, title: s.origin.title } }
          : s.origin?.kind === "genre"
            ? { genre: { ids: seedIds, name: s.origin.name } }
            : s.origin?.kind === "mood"
              ? { mood: { ids: seedIds, name: s.origin.name } }
              : undefined;
  // the player's own gate, same as the autopilot's append: hidden and proven-dead stay out, fresh drm stays in
  const picks = rankDjCandidates(candidates, { seeds: roundSeeds, groups, exclude: excludeNow(kind), ...DJ_RANK_DEFAULTS, feedback: feedbackArtists(s.votes, artistOf), feedbackOn: s.feedbackOn }).filter((p) => canPlay(p.track));
  return { picks, failed: false };
}

function recordPicks(picks: RoundOutcome["picks"]) {
  for (const p of picks) {
    appended.push(p.track.id);
    appendedSet.add(p.track.id);
  }
  set((s) => {
    const reasons = { ...s.reasons };
    for (const p of picks) reasons[p.track.id] = p.why;
    return { reasons };
  });
}

function appendPicks(picks: RoundOutcome["picks"]) {
  player.appendMany(
    picks.map((p) => p.track),
    { silent: true },
  );
  recordPicks(picks);
}

function applyOutcome(kind: "start" | "refill", outcome: RoundOutcome) {
  // the session's own turn-over (a start onto an empty player) must not read as another list taking the queue
  applying = true;
  try {
    writeOutcome(kind, outcome);
  } finally {
    applying = false;
  }
}

function writeOutcome(kind: "start" | "refill", outcome: RoundOutcome) {
  if (kind === "start") {
    if (outcome.failed) {
      // no session to hold the suspension: the autopilot resumes
      player.setAutopilotSuspended(false);
      set({ active: false, status: "error" });
      return;
    }
    if (!outcome.picks.length) {
      player.setAutopilotSuspended(false);
      set({ active: false, status: "empty" });
      return;
    }
    // an explicit start onto an empty player: the picks become the queue (appendMany drops them with no current)
    const first = outcome.picks[0];
    if (usePlayer.getState().index < 0 && first) {
      player.playFrom(
        outcome.picks.map((p) => p.track),
        0,
        { kind: "static" },
      );
      // the queue turned over under the flight (busy held the tick): this is the session's queue now
      expectedQueueGen = queueGeneration();
      recordPicks(outcome.picks);
    } else {
      // the person asked for the DJ: the queue after the current track is the session's from now on, so it is heard
      // at once and not after everything that happened to be queued there
      player.takeOverUpcoming(outcome.picks.map((p) => p.track));
      expectedQueueGen = queueGeneration();
      recordPicks(outcome.picks);
    }
    set({ status: "ready" });
    return;
  }
  if (outcome.failed) {
    errStreak++;
    dryStreak = 0;
    set({ status: "error" });
    return;
  }
  if (!outcome.picks.length) {
    dryStreak++;
    errStreak = 0;
    // the same chain seed would answer the same emptiness: twice dry, the session bows out
    if (dryStreak >= DJ_DRY_ROUNDS_TO_STOP) stopInternal("exhausted");
    return;
  }
  errStreak = 0;
  dryStreak = 0;
  appendPicks(outcome.picks);
  set({ status: "ready" });
}

async function runFlight(roundSeeds: readonly DjSeed[], myGen: number, kind: "start" | "refill") {
  const controller = new AbortController();
  flight = controller;
  let timedOut = false;
  const timerId = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, flightTimeoutMs(roundSeeds.length));
  timer = timerId;
  try {
    const outcome = await runRound(roundSeeds, controller.signal, kind);
    if (myGen !== gen) return;
    // the queue turned over mid-flight while busy held the tick: step aside instead of appending elsewhere
    if (queueGeneration() !== expectedQueueGen) {
      stopInternal("context");
      return;
    }
    applyOutcome(kind, outcome);
  } catch {
    if (myGen !== gen) return;
    // stopped or superseded: quiet. A timeout (or an unexpected throw) counts as a failed round.
    if (controller.signal.aborted && !timedOut) return;
    applyOutcome(kind, { picks: [], failed: true });
  } finally {
    window.clearTimeout(timerId);
    if (timer === timerId) timer = 0;
    if (flight === controller) flight = null;
    if (myGen === gen) {
      busy = false;
      if (kind === "refill") set({ refilling: false });
      // re-evaluate now that the flight is over (busy held every tick): a short start, an emptied tail or a
      // queue that turned over is handled at once instead of waiting for the next player change
      if (kind === "start" && get().active && needsRefillAfterStart(appended.length)) {
        refill();
      } else {
        tick();
      }
    }
  }
}

function refill() {
  const s = get();
  const origin = s.seeds[0];
  if (!s.active || busy || !origin) return;
  busy = true;
  set({ refilling: true });
  const myGen = ++gen;
  void runFlight(buildRoundSeeds(s.seeds, voteOrder, chainSeedId(appended, origin.id), trackTitle), myGen, "refill");
}

/** Every player change passes the session through the decide function: refill, step aside, or idle. */
function tick() {
  const s = get();
  // applying: the player is changing because of this session's own outcome, not under it
  if (!s.active || !s.seeds.length || applying) return;
  const p = usePlayer.getState();
  const decision = decideDjNext(
    { queueIds: p.queue.map((t) => t.id), index: p.index, queueGen: queueGeneration() },
    { expectedGen: expectedQueueGen, appendedIds: appended, busy, failures: errStreak },
  );
  if (decision.action === "refill") refill();
  else if (decision.action === "stop") stopInternal(decision.reason);
}

function stopInternal(reason: "user" | "cleared" | "context" | "exhausted") {
  gen++;
  resetMachinery();
  busy = false;
  player.setAutopilotSuspended(false);
  // queued suggestions stay queued (never yanked); their reasons stay too, until the next session replaces them
  set({ active: false, status: reason === "exhausted" ? "exhausted" : "stopped", seeds: [], origin: null, refilling: false, votes: {} });
}

/** The track-source core every track start shares: one origin seed, same takeover, same flight. */
function startFromSeed(seed: DjSeed) {
  if (isLocalTrack(seed.id)) {
    // a local file has no related list: "nothing to suggest" without burning a request that 404s
    gen++;
    resetMachinery();
    busy = false;
    // no session to hold the suspension (a restart drops the old hold here instead of leaking it)
    player.setAutopilotSuspended(false);
    set({ active: false, status: "empty", seeds: [], origin: { kind: "track", seed }, refilling: false, reasons: {}, votes: {}, feedbackOn: true });
    return;
  }
  resetMachinery();
  busy = true;
  // the takeover: hold the autopilot's filler and drop its old tail first; the first round will replace the
  // remaining unplayed tail, so only the current/played tracks and history are excluded (busy holds the tick quiet)
  player.setAutopilotSuspended(true);
  player.dropAutoTail();
  expectedQueueGen = queueGeneration();
  const myGen = ++gen;
  set({ active: true, status: "loading", seeds: [seed], origin: { kind: "track", seed }, refilling: false, reasons: {}, votes: {}, feedbackOn: true });
  void runFlight([seed], myGen, "start");
}

/**
 * Starts a session from a search wave (restarts a running one): the first page of tracks for the query
 * seeds it, in the service's order. Too few seedable tracks — an honest empty, same as a short playlist.
 * Quietly refuses in a room. Genre and mood waves share it; only the origin kind and the spoken name differ.
 */
async function startFromSearch(kind: "genre" | "mood", query: string, name: string) {
  if (inRoom()) return;
  const myGen = ++gen;
  resetMachinery();
  busy = true;
  const origin: DjOrigin = kind === "genre" ? { kind: "genre", query, name } : { kind: "mood", query, name };
  set({ active: true, status: "loading", seeds: [], origin, refilling: false, reasons: {}, votes: {}, feedbackOn: true });
  let picked: DjSeed[];
  try {
    // the service's order, first page: the only "by genre" list the provider has (no charts call)
    const page = await call("data:search", query, "tracks", null);
    if (!page || !Array.isArray((page as Page<Track>).items)) throw new TypeError("data:search must be a page");
    picked = pickTrackSeeds((page as Page<Track>).items, isLocalTrack);
  } catch {
    if (myGen !== gen) return;
    busy = false;
    // the hold was never taken (a restart's old hold drops here instead of leaking)
    player.setAutopilotSuspended(false);
    set({ active: false, status: "error" });
    return;
  }
  if (myGen !== gen) return;
  if (picked.length < DJ_MIN_SEEDS) {
    busy = false;
    player.setAutopilotSuspended(false);
    set({ active: false, status: "empty", origin });
    return;
  }
  // the takeover, only now that the seeds are real (same hold-and-drop as the other starts)
  player.setAutopilotSuspended(true);
  player.dropAutoTail();
  expectedQueueGen = queueGeneration();
  set({ seeds: picked, origin });
  void runFlight(picked, myGen, "start");
}

/** The DJ's actions for its button, panel and page. */
export const dj = {
  /** Starts a session from the current track (restarts a running one). Quietly refuses without one or in a room. */
  start() {
    const cur = currentTrack();
    if (!cur || inRoom()) return;
    startFromSeed({ id: cur.id, title: cur.title });
  },
  /** Starts a session from any track (a menu's, not necessarily the current one). Quietly refuses in a room. */
  startFromTrack(track: Track) {
    if (inRoom()) return;
    startFromSeed({ id: track.id, title: track.title });
  },
  /**
   * Starts a session from recent likes (restarts a running one). Needs two seedable likes; this computer's
   * likes work signed out. The autopilot hold waits until the seeds are real, so a failed lookup leaks nothing.
   */
  async startFromLikes() {
    if (inRoom()) return;
    const myGen = ++gen;
    resetMachinery();
    busy = true;
    set({ active: true, status: "loading", seeds: [], origin: { kind: "likes" }, refilling: false, reasons: {}, votes: {}, feedbackOn: true });
    let ids: number[];
    try {
      // ordered newest-first, this computer's likes included: no sign-in needed
      ids = await call("data:likedIds");
      // typed number[], but the wire can lie (a main-process bug): fail loud instead of stuck-loading
      if (!Array.isArray(ids)) throw new TypeError("data:likedIds must be an array");
    } catch {
      if (myGen !== gen) return;
      busy = false;
      // the hold was never taken (a restart's old hold drops here instead of leaking)
      player.setAutopilotSuspended(false);
      set({ active: false, status: "error" });
      return;
    }
    if (myGen !== gen) return;
    const picked = pickLikeSeeds(ids, isLocalTrack);
    if (picked.length < DJ_MIN_SEEDS) {
      busy = false;
      player.setAutopilotSuspended(false);
      set({ active: false, status: "empty", origin: { kind: "likes" } });
      return;
    }
    // the takeover, only now that the seeds are real (same hold-and-drop as the track start)
    player.setAutopilotSuspended(true);
    player.dropAutoTail();
    expectedQueueGen = queueGeneration();
    const seeds: DjSeed[] = picked.map((id) => ({ id, title: null }));
    set({ seeds, origin: { kind: "likes" } });
    void runFlight(seeds, myGen, "start");
  },
  /**
   * Starts a session from an artist's uploads (restarts a running one). A page with no uploads to seed from
   * (a listener) falls back to their public likes instead — one source or the other, never a mix, so the
   * reasons name one honest source. The autopilot hold waits until the seeds are real.
   */
  async startFromArtist(userId: number, name: string) {
    if (inRoom()) return;
    const myGen = ++gen;
    resetMachinery();
    busy = true;
    set({ active: true, status: "loading", seeds: [], origin: { kind: "artist", userId, name, via: "tracks" }, refilling: false, reasons: {}, votes: {}, feedbackOn: true });
    let picked: DjSeed[];
    let via: DjArtistVia = "tracks";
    try {
      // uploads, newest first — the only "by this artist" list the provider has (no top-tracks call)
      const page = await call("data:userTracks", userId, null);
      if (!page || !Array.isArray(page.items)) throw new TypeError("data:userTracks must be a page");
      picked = pickTrackSeeds(page.items, isLocalTrack);
    } catch {
      if (myGen !== gen) return;
      busy = false;
      // the hold was never taken (a restart's old hold drops here instead of leaking)
      player.setAutopilotSuspended(false);
      set({ active: false, status: "error" });
      return;
    }
    if (myGen !== gen) return;
    if (picked.length < DJ_MIN_SEEDS) {
      // no uploads to seed from: the page's public likes seed instead (best effort — they may be few too)
      try {
        const liked = await call("data:userLikes", userId, null);
        if (myGen !== gen) return;
        if (liked && Array.isArray(liked.items)) {
          picked = pickTrackSeeds(liked.items, isLocalTrack);
          via = "likes";
        }
      } catch {
        if (myGen !== gen) return;
        // likes unavailable (private?): the uploads already answered — an honest empty, not an error
      }
    }
    if (picked.length < DJ_MIN_SEEDS) {
      busy = false;
      player.setAutopilotSuspended(false);
      set({ active: false, status: "empty", origin: { kind: "artist", userId, name, via } });
      return;
    }
    // the takeover, only now that the seeds are real (same hold-and-drop as the other starts)
    player.setAutopilotSuspended(true);
    player.dropAutoTail();
    expectedQueueGen = queueGeneration();
    set({ seeds: picked, origin: { kind: "artist", userId, name, via } });
    void runFlight(picked, myGen, "start");
  },
  /**
   * Starts a session from a playlist's tracks in order (restarts a running one). A playlist of local files
   * seeds nothing (no related lists) — an honest empty, same as one too short to seed from.
   */
  async startFromPlaylist(id: string, title: string) {
    if (inRoom()) return;
    const myGen = ++gen;
    resetMachinery();
    busy = true;
    set({ active: true, status: "loading", seeds: [], origin: { kind: "playlist", id, title }, refilling: false, reasons: {}, votes: {}, feedbackOn: true });
    let picked: DjSeed[];
    try {
      // the playlist's order, first page (fifty tracks: plenty for the seeds)
      const page = await call("data:playlistTracks", id, null);
      if (!page || !Array.isArray(page.items)) throw new TypeError("data:playlistTracks must be a page");
      picked = pickTrackSeeds(page.items, isLocalTrack);
    } catch {
      if (myGen !== gen) return;
      busy = false;
      // the hold was never taken (a restart's old hold drops here instead of leaking)
      player.setAutopilotSuspended(false);
      set({ active: false, status: "error" });
      return;
    }
    if (myGen !== gen) return;
    if (picked.length < DJ_MIN_SEEDS) {
      busy = false;
      player.setAutopilotSuspended(false);
      set({ active: false, status: "empty", origin: { kind: "playlist", id, title } });
      return;
    }
    // the takeover, only now that the seeds are real (same hold-and-drop as the other starts)
    player.setAutopilotSuspended(true);
    player.dropAutoTail();
    expectedQueueGen = queueGeneration();
    set({ seeds: picked, origin: { kind: "playlist", id, title } });
    void runFlight(picked, myGen, "start");
  },
  /**
   * Starts a session from a genre wave: the top search results for the genre seed it (the query is the
   * name — SoundCloud's catalog is English-tagged). Restarts a running one.
   */
  startFromGenre(query: string, name: string) {
    return startFromSearch("genre", query, name);
  },
  /**
   * Starts a session from a mood wave: the top search results for the mood's query seed it, the mood's
   * localized name is what the session speaks. Restarts a running one.
   */
  startFromMood(query: string, name: string) {
    return startFromSearch("mood", query, name);
  },
  /** No more suggestions; queued ones stay, the flight (if any) is dropped. */
  stop() {
    if (get().active) stopInternal("user");
  },
  /** After an error (or an empty start): back to the same source that failed — now if the tail is short. */
  retry() {
    const s = get();
    errStreak = 0;
    dryStreak = 0;
    if (!s.active) {
      if (s.origin?.kind === "likes") {
        void dj.startFromLikes();
        return;
      }
      if (s.origin?.kind === "artist") {
        void dj.startFromArtist(s.origin.userId, s.origin.name);
        return;
      }
      if (s.origin?.kind === "playlist") {
        void dj.startFromPlaylist(s.origin.id, s.origin.title);
        return;
      }
      if (s.origin?.kind === "genre") {
        void dj.startFromGenre(s.origin.query, s.origin.name);
        return;
      }
      if (s.origin?.kind === "mood") {
        void dj.startFromMood(s.origin.query, s.origin.name);
        return;
      }
      if (s.origin?.kind === "track") {
        startFromSeed(s.origin.seed);
        return;
      }
      dj.start();
      return;
    }
    set({ status: "ready" });
    tick();
  },
  /** Thumbs up / down for the session only (null takes the vote back); the next round ranks with it. */
  vote(trackId: number, vote: DjVote | null) {
    // the freshest thumbs-up anchor the next round (a "less" or a taken-back vote leaves the anchors)
    voteOrder = vote === "more" ? [trackId, ...voteOrder.filter((id) => id !== trackId)] : voteOrder.filter((id) => id !== trackId);
    set((s) => {
      const votes = { ...s.votes };
      if (vote) votes[trackId] = vote;
      else delete votes[trackId];
      return { votes };
    });
  },
  /** Ratings apply to the ranking, or sit collected-but-paused. */
  setFeedbackOn(on: boolean) {
    set({ feedbackOn: on });
  },
  /** Forgets the session's ratings. */
  clearVotes() {
    voteOrder = [];
    set({ votes: {} });
  },
  /** Dismisses a finished status (error, empty, exhausted) without a session: the strip and the page go quiet. */
  clear() {
    if (get().active) return;
    // the reasons stay: queued suggestions keep their labels (they just have no session behind them anymore)
    set({ status: "idle", seeds: [], origin: null, refilling: false, votes: {} });
    voteOrder = [];
  },
  /** Takes a track out of the session: never suggested again, removed from the upcoming queue (skipped if playing). */
  dismiss(trackId: number) {
    dismissed.add(trackId);
    appendedSet.delete(trackId);
    appended = appended.filter((id) => id !== trackId);
    voteOrder = voteOrder.filter((id) => id !== trackId);
    set((s) => {
      const votes = { ...s.votes };
      delete votes[trackId];
      const reasons = { ...s.reasons };
      delete reasons[trackId];
      return { votes, reasons };
    });
    const p = usePlayer.getState();
    if (p.queue[p.index]?.id === trackId) {
      player.next();
      return;
    }
    const at = p.queue.findIndex((t, i) => i > p.index && t.id === trackId);
    if (at >= 0) player.removeAt(at);
  },
};

let inited = false;
/** The player snapshot the session last looked at: volume, mute and the like never move it. */
let seenQueue: readonly Track[] | null = null;
let seenIndex = -1;
/** Follows the player: refills a thinning tail, steps aside when the session's thread is gone. */
export function initDj() {
  if (inited) return;
  inited = true;
  const start = usePlayer.getState();
  seenQueue = start.queue;
  seenIndex = start.index;
  usePlayer.subscribe((next) => {
    // only the queue or the current track can change a decision (stops, refills, takeovers)
    if (next.queue === seenQueue && next.index === seenIndex) return;
    seenQueue = next.queue;
    seenIndex = next.index;
    tick();
  });
  // a room takes the player: the session steps aside at once, before the queue turns over
  useRoom.subscribe((s) => {
    if (s.room && get().active) stopInternal("context");
  });
}
