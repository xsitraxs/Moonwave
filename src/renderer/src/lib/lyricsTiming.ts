/**
 * The math behind word-by-word (karaoke) highlighting, shared by the full screen player (NowPlaying) and the words
 * panel. Pure: tested on its own.
 */

export interface TimedLine {
  t: number;
}

/**
 * The line being sung at `now`: the last one that started, or -1 before the first. The lines are sorted by time.
 * Binary search, since this runs on every frame of the paint loop.
 */
export function lineIndexAt(lines: readonly TimedLine[], now: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let at = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid]!.t <= now) {
      at = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return at;
}

/**
 * Lines coming quicker than every 1.5 s (fast rap): smooth easing keeps the light behind the voice, so the panel and
 * the full screen player switch to near-instant transitions. Decided on the median gap, not the fastest one.
 */
export function fastLines(lines: readonly TimedLine[]): boolean {
  const gaps = lines
    .slice(1)
    .map((l, i) => l.t - lines[i]!.t)
    .filter((g) => g > 0)
    .sort((a, b) => a - b);
  return gaps.length > 4 && gaps[gaps.length >> 1]! < 1.5;
}

/**
 * How far (0..1) each word of a line has been sung, shared out by word length (the words come with line times only).
 * Never NaN: duplicate timestamps (bad LRC) collapse to a hair faster than one video frame of fill.
 */
export function sweep(words: readonly string[], start: number, next: number, now: number): number[] {
  const total = words.reduce((n, w) => n + w.length + 1, 0);
  if (!total) return words.map(() => 0);
  // at a readable ~7.5 chars a second, capped by 90% of the gap to the next line; at least a human word's blink
  const span = Math.max(0.05, Math.min(Math.max(next - start, 0) * 0.9, Math.max(1.2, total * 0.075)));
  const p = (now - start) / span;
  let at = 0;
  return words.map((w) => {
    const a = at / total;
    const b = (at + w.length) / total;
    at += w.length + 1;
    const v = (p - a) / Math.max(1e-6, b - a);
    return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
  });
}

/** One word's light (0..1) from its own times; a zero-length or unreadable word still lights (in 50 ms). */
export function wordProgress(t: number, end: number, now: number): number {
  const span = Number.isFinite(end - t) ? Math.max(0.05, end - t) : 0.05;
  const v = (now - t) / span;
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
}
