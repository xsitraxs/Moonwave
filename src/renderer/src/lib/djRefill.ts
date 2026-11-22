import type { DjFeedback } from "./djRank";

/**
 * Moonwave DJ: when the session refills, and when it steps aside. Pure decisions over a snapshot of the player —
 * the state/dj.ts session feeds them and acts on them; the async flight itself lives there too.
 *
 * - refill: fewer than DJ_REFILL_BELOW unplayed suggestions left — fetch the next round, chained from the last
 *   suggestion. While a session runs it holds the autopilot's filler (and drops its old tail on start), so the
 *   DJ's picks are the only tail; once the session ends the autopilot resumes as the natural fallback.
 * - stop/cleared: no unplayed suggestions left while the seed is still around — the person removed them
 *   (clearUpcoming, one-by-one), so the DJ gets out of the way instead of re-adding what was just thrown out.
 * - stop/context: the seed left the queue — another list started, or a listening room took over the player.
 * - wait: busy, holding after repeated errored rounds (a retry button resets that), or plenty of suggestions left.
 *   Dry rounds don't hold: the session stops after two of them instead.
 *
 * Jumping back to an older manual track neither stops nor refills: the session idles until playback returns
 * to the DJ thread.
 */

export interface DjQueueView {
  queueIds: number[];
  index: number;
}

export interface DjSessionView {
  seedId: number;
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

export function decideDjNext(view: DjQueueView, session: DjSessionView): DjDecision {
  if (session.busy || session.failures >= DJ_MAX_REFILL_FAILURES) return { action: "wait" };
  if (!view.queueIds.includes(session.seedId)) return { action: "stop", reason: "context" };
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

/** History + queue + dismissed ids, deduped: what the next round must not recommend. */
export function buildDjExclude(parts: readonly (readonly number[])[]): number[] {
  return [...new Set(parts.flat())];
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
