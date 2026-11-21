/** Store only meaningful unfinished positions; keep the most recently updated 100 tracks. */
export function updateTrackProgress(previous: Record<string, number>, id: number, position: number, duration: number): Record<string, number> {
  const next = { ...previous };
  const key = `t:${id}`;
  delete next[key];
  if (Number.isFinite(position) && Number.isFinite(duration) && duration > 0 && position >= 5 && position < duration - 5 && position / duration < 0.95) {
    next[key] = Math.floor(position);
  }
  return Object.fromEntries(Object.entries(next).slice(-100));
}
