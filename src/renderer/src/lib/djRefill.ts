import type { DjFeedback, DjSeed } from "./djRank";

/**
 * Moonwave DJ: when the session refills, and when it steps aside. Pure decisions over a snapshot of the player —
 * the state/dj.ts session feeds them and acts on them; the async flight itself lives there too.
 *
 * - refill: fewer than DJ_REFILL_BELOW unplayed suggestions left — fetch the next round from its anchors (the
 *   chain tip, the session's thumbs-up, the origin seeds). While a session runs it holds the autopilot's filler
 *   (and drops its old tail on start), so the DJ's picks are the only tail; once the session ends the autopilot
 *   resumes as the natural fallback.
 * - stop/cleared: no unplayed suggestions left on the session's queue — the person removed them (clearUpcoming,
 *   one-by-one), so the DJ gets out of the way instead of re-adding what was just thrown out.
 * - stop/context: the queue turned over — another list started, or a listening room took over the player. This is
 *   checked first: a flight in progress never outlives the context it was started in.
 * - wait: busy, holding after repeated errored rounds (a retry button resets that), or plenty of suggestions left.
 *   Dry rounds don't hold: the session stops after two of them instead.
 *
 * Jumping back to an older manual track neither stops nor refills: the session idles until playback returns
 * to the DJ thread.
 */

export interface DjQueueView {
  queueIds: number[];
  index: number;
  /** the player's queue generation: bumped when a whole new list replaces the queue (not on appends/removals) */
  queueGen: number;
}

export interface DjSessionView {
  /** the queue generation the session started on — a mismatch means another list (or a room) took the player */
  expectedGen: number;
  /** every suggestion appended this session, in append order (dismissed ones removed) */
  appendedIds: readonly number[];
  /** a collect+rank flight is running */
  busy: boolean;
  /** consecutive errored refill rounds (dry rounds stop the session instead of holding) */
  failures: number;
}

export type DjDecision = { action: "wait" } | { action: "refill" } | { action: "stop"; reason: "cleared" | "context" };

/** Refill while this many unplayed suggestions are left — above the player's AHEAD (3), so the DJ goes first. */
export const DJ_REFILL_BELOW = 5;
/** After this many errored rounds in a row the DJ holds (no network hammering while offline) until a retry. */
export const DJ_MAX_REFILL_FAILURES = 2;
/** After this many dry rounds in a row (the chain yields nothing) the session bows out instead of holding. */
export const DJ_DRY_ROUNDS_TO_STOP = 2;
/** Seeds in one collect+rank round: two waves of the provider's 4 parallel requests. */
export const DJ_ROUND_SEEDS = 8;
/** Session thumbs-up anchoring a refill round (the freshest first); origin seeds fill the rest. */
export const DJ_VOTE_ANCHORS = 2;

export function decideDjNext(view: DjQueueView, session: DjSessionView): DjDecision {
  // the context check comes before the busy hold: a list started (or a room took the player) while a flight was
  // in the air must end the session, not wait for an answer that belongs to the queue it replaced
  if (view.queueGen !== session.expectedGen) return { action: "stop", reason: "context" };
  if (session.busy || session.failures >= DJ_MAX_REFILL_FAILURES) return { action: "wait" };
  const appended = new Set(session.appendedIds);
  let tail = 0;
  for (let i = view.index + 1; i < view.queueIds.length; i++) {
    const id = view.queueIds[i];
    if (id !== undefined && appended.has(id)) tail++;
  }
  if (tail === 0) return { action: "stop", reason: "cleared" };
  if (tail < DJ_REFILL_BELOW) return { action: "refill" };
  return { action: "wait" };
}

/**
 * A start round that delivered fewer than DJ_REFILL_BELOW suggestions leaves a thin tail (one pick is even a zero
 * tail once it plays): such a session refills at once instead of waiting for the next player change — and a short
 * start is never mistaken for the person clearing the queue.
 */
export function needsRefillAfterStart(appendedCount: number): boolean {
  return appendedCount < DJ_REFILL_BELOW;
}

/** History + queue + dismissed ids, deduped: what the next round must not recommend. */
export function buildDjExclude(parts: readonly (readonly number[])[]): number[] {
  return [...new Set(parts.flat())];
}

/** A start replaces the unplayed tail, so its old suggestions can be picked again; a refill keeps them. */
export function excludeDjRound(kind: "start" | "refill", queue: readonly number[], index: number, history: readonly number[], dismissed: readonly number[]): number[] {
  return buildDjExclude([kind === "start" ? queue.slice(0, index + 1) : queue, history, dismissed]);
}

export type DjVote = "more" | "less";

/** Session votes (by track) into artist ratings for the ranker; votes whose artist can't be found are dropped. */
export function feedbackArtists(votes: Readonly<Record<number, DjVote>>, artistOf: (trackId: number) => number | undefined): DjFeedback {
  const more: number[] = [];
  const less: number[] = [];
  for (const [id, vote] of Object.entries(votes)) {
    const artist = artistOf(Number(id));
    if (artist === undefined) continue;
    (vote === "more" ? more : less).push(artist);
  }
  return { moreArtists: [...new Set(more)], lessArtists: [...new Set(less)] };
}

/** The next round chains from the newest surviving suggestion (dismissed ones are already gone from the list). */
export function chainSeedId(appendedIds: readonly number[], fallbackId: number): number {
  return appendedIds[appendedIds.length - 1] ?? fallbackId;
}

/**
 * A round fails only when every seed failed (a lone failure among live seeds just shrinks the pool).
 * No seeds at all is not a failure — there is simply nothing to rank.
 */
export function isRoundFailed(failedSeeds: readonly number[], seedIds: readonly number[]): boolean {
  const seeds = new Set(seedIds);
  if (seeds.size === 0) return false;
  let failed = 0;
  for (const id of new Set(failedSeeds)) if (seeds.has(id)) failed++;
  return failed >= seeds.size;
}

/**
 * The seeds of a refill round: the chain tip first (continuity), then the freshest session thumbs-up (explicit
 * taste), then the session's origin seeds (the roots that keep the drift in check) — deduped and capped, so on
 * overflow the oldest origin seed drops first. Titles resolve through `titleOf`; an unknown one stays null
 * (counted for co-occurrence, never named in a reason).
 */
export function buildRoundSeeds(
  origin: readonly DjSeed[],
  moreIds: readonly number[],
  chainId: number | null,
  titleOf: (id: number) => string | null,
  limit: number = DJ_ROUND_SEEDS,
): DjSeed[] {
  const ids: number[] = [];
  const seen = new Set<number>();
  const push = (id: number) => {
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  };
  if (chainId !== null) push(chainId);
  for (const id of moreIds.slice(0, DJ_VOTE_ANCHORS)) push(id);
  for (const s of origin) push(s.id);
  const n = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : DJ_ROUND_SEEDS;
  return ids.slice(0, n).map((id) => ({ id, title: titleOf(id) }));
}
