/**
 * The queue's decisions, kept out of the store: which index comes next (skipping what can't play, wrapping when the
 * list repeats), what a shuffle does, and when the queue needs filling. Nothing here touches React, the engine or
 * SoundCloud, so queue.test.ts can check it on its own.
 */

/**
 * Next index after `from` that may play (wrapping to the start when asked), or -1 when there is none. With a wrap the
 * current track may be the answer itself: a one-track list repeats it.
 */
export function nextPlayableIndex<T>(queue: readonly T[], from: number, wrap: boolean, ok: (track: T) => boolean): number {
  for (let i = from + 1; i < queue.length; i++) if (ok(queue[i]!)) return i;
  if (wrap) for (let i = 0; i <= from && i < queue.length; i++) if (ok(queue[i]!)) return i;
  return -1;
}

/** A shuffled copy (Fisher–Yates); `random` exists so a test can make it repeatable. */
export function shuffled<T>(list: readonly T[], random: () => number = Math.random): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Is there less than `ahead` tracks left after the current one, i.e. is it time to fill the queue? */
export function needsTopUp(queueLength: number, index: number, ahead: number): boolean {
  return queueLength - index <= ahead;
}
