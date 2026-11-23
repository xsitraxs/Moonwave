/**
 * Moonwave DJ: where a session's origin seeds come from. Pure selection over already-fetched data — the
 * session controller (state/dj.ts) fetches, then calls these; nothing here touches the network or the player.
 */

/** Recent likes seeding a "from my likes" session: a wave and a half of the provider's 4 parallel requests. */
export const DJ_LIKE_SEEDS = 6;
/** Non-track sources need at least this many seeds: co-occurrence means nothing with a lone seed. */
export const DJ_MIN_SEEDS = 2;

/**
 * The ids to seed a likes session from an ordered liked-ids list (newest first): local files can't seed
 * (no related lists), dupes and garbage are skipped, the first `count` survivors win.
 */
export function pickLikeSeeds(likedIds: readonly number[], isLocal: (id: number) => boolean, count: number = DJ_LIKE_SEEDS): number[] {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : DJ_LIKE_SEEDS;
  const picked: number[] = [];
  const seen = new Set<number>();
  for (const id of likedIds) {
    if (picked.length >= n) break;
    if (!Number.isSafeInteger(id) || id <= 0 || seen.has(id) || isLocal(id)) continue;
    seen.add(id);
    picked.push(id);
  }
  return picked;
}
