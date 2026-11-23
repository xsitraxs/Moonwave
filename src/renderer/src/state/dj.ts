import { create } from "zustand";
import { isLocalTrack } from "@shared/types";
import { collectDjCandidates, DJ_COLLECT_DEFAULTS } from "@/lib/djCollect";
import { DJ_RANK_DEFAULTS, rankDjCandidates, type DjPick, type DjSeed, type DjWhy } from "@/lib/djRank";
import { buildDjExclude, buildRoundSeeds, chainSeedId, decideDjNext, DJ_DRY_ROUNDS_TO_STOP, feedbackArtists, isRoundFailed, type DjVote } from "@/lib/djRefill";
import { call } from "@/lib/sky";
import { canPlay, currentTrack, inRoom, player, queueGeneration, usePlayer } from "./player";
import { useRoom } from "./room";
import { useSettings } from "./settings";

/**
 * Moonwave DJ: one explicit session at a time, grown from its origin seeds (the current track, for now). The
 * session owns the *suggestions* — fetching, ranking, appending, refilling — while the player keeps owning
 * playback, the manual queue, repeat, shuffle and the autopilot. Nothing here rewrites what the person queued
 * by hand.
 *
 * How the suggestions ride the queue: on start the session holds the autopilot's filler and drops its old tail
 * (player.setAutopilotSuspended/dropAutoTail), then appends its picks in bulk (player.appendMany), flagged like
 * hand-added tracks so shuffles keep them. The honest boundary is not a queue index but the `reasons` map
 * (track id → why it was picked): manual tracks have no entry, DJ tracks do, whatever the order becomes.
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

interface DjStore {
  /** a session runs: suggestions may still arrive */
  active: boolean;
  status: DjStatus;
  /** the session's origin seeds (what it started from); every refill round anchors back to these */
  seeds: DjSeed[];
  /** a refill round is flying (the first round uses `loading` instead) */
  refilling: boolean;
  /** honest reasons, by suggested track id — kept after the session so queued tracks keep their labels */
  reasons: Record<number, DjWhy>;
  /** session-only thumbs up / down, by track id — gone with the session, never stored */
  votes: Record<number, DjVote>;
  /** session ratings apply to the ranking; pausing collects without applying */
  feedbackOn: boolean;
}

export const useDj = create<DjStore>(() => ({ active: false, status: "idle", seeds: [], refilling: false, reasons: {}, votes: {}, feedbackOn: true }));

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

/** What the next round must not recommend: queue + history + dismissed. */
function excludeNow(): number[] {
  const { queue } = usePlayer.getState();
  const { history } = useSettings.getState();
  return buildDjExclude([queue.map((t) => t.id), history.map((t) => t.id), [...dismissed]]);
}

interface RoundOutcome {
  picks: DjPick[];
  failed: boolean;
}

async function runRound(roundSeeds: readonly DjSeed[], signal: AbortSignal): Promise<RoundOutcome> {
  const { candidates, failedSeeds } = await collectDjCandidates(roundSeeds, (id) => call("data:related", id), { signal, ...DJ_COLLECT_DEFAULTS });
  // one seed's failure never sinks the rest: only all-failed is a failed round (a lone seed behaves as before)
  if (isRoundFailed(failedSeeds, roundSeeds.map((s) => s.id))) return { picks: [], failed: true };
  const s = get();
  // the player's own gate, same as the autopilot's append: hidden and proven-dead stay out, fresh drm stays in
  const picks = rankDjCandidates(candidates, { seeds: roundSeeds, exclude: excludeNow(), ...DJ_RANK_DEFAULTS, feedback: feedbackArtists(s.votes, artistOf), feedbackOn: s.feedbackOn }).filter((p) => canPlay(p.track));
  return { picks, failed: false };
}

function appendPicks(picks: RoundOutcome["picks"]) {
  player.appendMany(
    picks.map((p) => p.track),
    { silent: true },
  );
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

function applyOutcome(kind: "start" | "refill", outcome: RoundOutcome) {
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
    appendPicks(outcome.picks);
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
    const outcome = await runRound(roundSeeds, controller.signal);
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
  if (!s.active || !s.seeds.length) return;
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
  set({ active: false, status: reason === "exhausted" ? "exhausted" : "stopped", seeds: [], refilling: false, votes: {} });
}

/** The DJ's actions for its button, panel and page. */
export const dj = {
  /** Starts a session from the current track (restarts a running one). Quietly refuses without one or in a room. */
  start() {
    const cur = currentTrack();
    if (!cur || inRoom()) return;
    if (isLocalTrack(cur.id)) {
      // a local file has no related list: "nothing to suggest" without burning a request that 404s
      gen++;
      resetMachinery();
      busy = false;
      set({ active: false, status: "empty", seeds: [], refilling: false, reasons: {}, votes: {}, feedbackOn: true });
      return;
    }
    resetMachinery();
    busy = true;
    // the takeover: hold the autopilot's filler and drop its old tail first — it prefetched the same related
    // tracks, and leaving them would exclude every candidate (busy is already set, so the tick stays quiet)
    player.setAutopilotSuspended(true);
    player.dropAutoTail();
    expectedQueueGen = queueGeneration();
    const myGen = ++gen;
    const seed = { id: cur.id, title: cur.title };
    set({ active: true, status: "loading", seeds: [seed], refilling: false, reasons: {}, votes: {}, feedbackOn: true });
    void runFlight([seed], myGen, "start");
  },
  /** No more suggestions; queued ones stay, the flight (if any) is dropped. */
  stop() {
    if (get().active) stopInternal("user");
  },
  /** After an error (or an empty start): clears the hold and tries again — now if the tail is short. */
  retry() {
    const s = get();
    errStreak = 0;
    dryStreak = 0;
    if (!s.active) {
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
/** Follows the player: refills a thinning tail, steps aside when the session's thread is gone. */
export function initDj() {
  if (inited) return;
  inited = true;
  usePlayer.subscribe(tick);
  // a room takes the player: the session steps aside at once, before the queue turns over
  useRoom.subscribe((s) => {
    if (s.room && get().active) stopInternal("context");
  });
}
