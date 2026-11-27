/**
 * The arithmetic of a track change: when a crossfade starts, how long it lasts, what each deck's level is while it
 * runs, and when the next stream's URL is worth asking for ahead. The engine decides when to act; these say what the
 * numbers are, and fades.test.ts checks them without an AudioContext.
 */

/** Is the track close enough to its end for the fade to begin (within the chosen crossfade, but not its last half second)? */
export function crossfadeDue(left: number, crossfade: number): boolean {
  return Number.isFinite(left) && left <= crossfade && left >= 0.5;
}

/**
 * How long the outgoing deck fades, in seconds: the chosen crossfade, never longer than what is left of the track, and
 * never shorter than half a second (a stream that reports no duration still gets a short fade).
 */
export function fadeLength(remaining: number, crossfade: number): number {
  return Number.isFinite(remaining) ? Math.max(0.5, Math.min(crossfade, remaining)) : 0.5;
}

/** Both decks' levels `elapsedMs` into a fade of `lengthS` seconds: the old one goes down as the new one comes up. */
export function fadeLevels(elapsedMs: number, lengthS: number): { from: number; to: number } {
  const k = Math.min(1, elapsedMs / (lengthS * 1000));
  return { from: 1 - k, to: k };
}

/** Is the track within `at` seconds of its end, i.e. is it time to ask for the next stream's URL already? */
export function prefetchDue(left: number, at: number): boolean {
  return Number.isFinite(left) && left <= at;
}
