import { create } from "zustand";
import { isLocalTrack } from "@shared/types";
import { collectDjCandidates, DJ_COLLECT_DEFAULTS } from "@/lib/djCollect";
import { DJ_RANK_DEFAULTS, rankDjCandidates, type DjPick, type DjSeed, type DjWhy } from "@/lib/djRank";
import { buildDjExclude, chainSeedId, decideDjNext, DJ_DRY_ROUNDS_TO_STOP, feedbackArtists, type DjVote } from "@/lib/djRefill";
import { call } from "@/lib/sky";
import { currentTrack, inRoom, player, usePlayer } from "./player";
import { useSettings } from "./settings";

/**
 * Moonwave DJ: one explicit session at a time, seeded by the current track. The session owns the *suggestions* —
 * fetching, ranking, appending, refilling — while the player keeps owning playback, the manual queue, repeat,
 * shuffle and the autopilot. Nothing here rewrites what the person queued by hand.
 *
 * How the suggestions ride the queue: they are appended in bulk before the autopilot's tail (player.appendMany),
 * flagged like hand-added tracks so shuffles keep them. The honest boundary is not a queue index but the `reasons`
 * map (track id → why it was picked): manual tracks have no entry, DJ tracks do, whatever the order becomes.
 * Refills trigger above the autopilot's own threshold (see djRefill), so a healthy DJ always goes first and
 * the autopilot degrades into a fallback instead of a competitor; no writer races, because every queue update
 * reads and writes synchronously.
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
  seed: DjSeed | null;
  /** a refill round is flying (the first round uses `loading` instead) */
  refilling: boolean;
  /** honest reasons, by suggested track id — kept after the session so queued tracks keep their labels */
  reasons: Record<number, DjWhy>;
  /** session-only thumbs up / down, by track id — gone with the session, never stored */
  votes: Record<number, DjVote>;
  /** session ratings apply to the ranking; pausing collects without applying */
  feedbackOn: boolean;
}

export const useDj = create<DjStore>(() => ({ active: false, status: "idle", seed: null, refilling: false, reasons: {}, votes: {}, feedbackOn: true }));

/** One collect+rank round may take this long before it counts as failed (a slow network, not a dead one). */
const DJ_FLIGHT_TIMEOUT_MS = 20_000;

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

const set = useDj.setState;
const get = useDj.getState;

function resetMachinery() {
  appended = [];
  appendedSet = new Set();
  dismissed = new Set();
  errStreak = 0;
  dryStreak = 0;
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

async function runRound(seedId: number, signal: AbortSignal): Promise<RoundOutcome> {
  const { candidates, failedSeeds } = await collectDjCandidates([{ id: seedId, title: "" }], (id) => call("data:related", id), { signal, ...DJ_COLLECT_DEFAULTS });
  // one seed per round: its failure is the round's failure
  if (failedSeeds.length > 0) return { picks: [], failed: true };
  const s = get();
  // a seed whose title can't be found anymore gets no name in the reasons — generic instead of a lie
  const title = trackTitle(seedId);
  const seeds = title === null ? [] : [{ id: seedId, title }];
  const picks = rankDjCandidates(candidates, { seeds, exclude: excludeNow(), ...DJ_RANK_DEFAULTS, feedback: feedbackArtists(s.votes, artistOf), feedbackOn: s.feedbackOn });
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
      set({ active: false, status: "error" });
      return;
    }
    if (!outcome.picks.length) {
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

async function runFlight(seedId: number, myGen: number, kind: "start" | "refill") {
  const controller = new AbortController();
  flight = controller;
  let timedOut = false;
  const timerId = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, DJ_FLIGHT_TIMEOUT_MS);
  timer = timerId;
  try {
    const outcome = await runRound(seedId, controller.signal);
    if (myGen !== gen) return;
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
  if (!s.active || busy || !s.seed) return;
  busy = true;
  set({ refilling: true });
  const myGen = ++gen;
  void runFlight(chainSeedId(appended, s.seed.id), myGen, "refill");
}

/** Every player change passes the session through the decide function: refill, step aside, or idle. */
function tick() {
  const s = get();
  if (!s.active || !s.seed) return;
  const p = usePlayer.getState();
  const decision = decideDjNext({ queueIds: p.queue.map((t) => t.id), index: p.index }, { seedId: s.seed.id, appendedIds: appended, busy, failures: errStreak });
  if (decision.action === "refill") refill();
  else if (decision.action === "stop") stopInternal(decision.reason);
}

function stopInternal(reason: "user" | "cleared" | "context" | "exhausted") {
  gen++;
  resetMachinery();
  busy = false;
  // queued suggestions stay queued (never yanked); their reasons stay too, until the next session replaces them
  set({ active: false, status: reason === "exhausted" ? "exhausted" : "stopped", seed: null, refilling: false, votes: {} });
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
      set({ active: false, status: "empty", seed: { id: cur.id, title: cur.title }, refilling: false, reasons: {}, votes: {}, feedbackOn: true });
      return;
    }
    resetMachinery();
    busy = true;
    const myGen = ++gen;
    set({ active: true, status: "loading", seed: { id: cur.id, title: cur.title }, refilling: false, reasons: {}, votes: {}, feedbackOn: true });
    void runFlight(cur.id, myGen, "start");
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
    set({ votes: {} });
  },
  /** Takes a track out of the session: never suggested again, removed from the upcoming queue (skipped if playing). */
  dismiss(trackId: number) {
    dismissed.add(trackId);
    appendedSet.delete(trackId);
    appended = appended.filter((id) => id !== trackId);
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
}
