export type Bezier = [number, number, number, number];

const cache = new Map<string, string>();
const root = () => (typeof document !== "undefined" ? document.documentElement : null);

function read(name: string): string {
  const cached = cache.get(name);
  if (cached !== undefined) return cached;
  const el = root();
  const val = el ? getComputedStyle(el).getPropertyValue(name).trim() : "";
  if (val) cache.set(name, val);
  return val;
}

/** Parse a CSS time string (`"90ms"`, `"0.16s"`, `"0s"`) into milliseconds. */
export function parseDurationMs(raw: string): number {
  const s = raw.trim();
  const n = parseFloat(s);
  if (!Number.isFinite(n) || n < 0) return 0;
  if (s.endsWith("ms")) return n;
  if (s.endsWith("s")) return n * 1000;
  return n;
}

/** Parse a CSS time string into seconds (for Framer Motion `duration`). */
export function parseDurationSeconds(raw: string): number {
  return parseDurationMs(raw) / 1000;
}

/** Parse a CSS `cubic-bezier(...)` string (or `"linear"`) into a 4-tuple for Framer Motion. */
export function parseBezier(raw: string): Bezier {
  const nums = raw.match(/-?\d*\.?\d+/g) ?? [];
  return nums.length === 4 ? (nums.map(Number) as Bezier) : [0, 0, 1, 1];
}

export function isReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Exit duration of the side queue in milliseconds (reads `--motion-fast` from `:root`). */
export function queueExitMs(): number {
  return parseDurationMs(read("--motion-fast"));
}

/** Horizontal shift in pixels (`--motion-shift`: `8` normally, `0` under reduced motion). */
export function shiftPx(): number {
  const n = parseFloat(read("--motion-shift"));
  return Number.isFinite(n) ? n : 0;
}

/** Panel / dialog / screen entrance (160 ms, enter curve). */
export const enter = () => ({ duration: parseDurationSeconds(read("--motion-base")), ease: parseBezier(read("--motion-ease-enter")) });

/** Fast popover / cursor menu entrance (90 ms, enter curve). */
export const enterFast = () => ({ duration: parseDurationSeconds(read("--motion-fast")), ease: parseBezier(read("--motion-ease-enter")) });

/** Any panel / overlay / menu exit (90 ms, exit curve). */
export const exit = () => ({ duration: parseDurationSeconds(read("--motion-fast")), ease: parseBezier(read("--motion-ease-exit")) });

/** State move (160 ms, move curve). */
export const move = () => ({ duration: parseDurationSeconds(read("--motion-base")), ease: parseBezier(read("--motion-ease-move")) });

/** Large layer movement such as NowPlaying open and stage shift (240 ms, move curve). */
export const slowMove = () => ({ duration: parseDurationSeconds(read("--motion-slow")), ease: parseBezier(read("--motion-ease-move")) });

export function clearMotionCache() {
  cache.clear();
}

if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
  window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", clearMotionCache);
}
