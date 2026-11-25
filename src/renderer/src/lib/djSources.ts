/**
 * Moonwave DJ: where a session's origin seeds come from. Pure selection over already-fetched data — the
 * session controller (state/dj.ts) fetches, then calls these; nothing here touches the network or the player.
 */

import type { Track } from "@shared/types";
import type { DjSeed } from "./djRank";

/** Seeds taken from a multi-track source (likes, an artist, a playlist): a wave and a half of the provider's 4 parallel requests. */
export const DJ_SOURCE_SEEDS = 6;
/** Non-track sources need at least this many seeds: co-occurrence means nothing with a lone seed. */
export const DJ_MIN_SEEDS = 2;

/**
 * Genre waves: English search queries doubling as their own labels (SoundCloud's catalog is English-tagged;
 * the search page's quick genres speak the same words, this list just runs further).
 */
export const DJ_GENRES = ["Electronic", "Hip-Hop", "Lo-Fi", "Phonk", "Ambient", "Indie", "Rock", "House", "Techno", "Drum & Bass", "Pop", "Jazz"] as const;

/** Mood waves: a stable id plus the English query that grows them (the UI speaks the id's localized name). */
export interface DjMoodPreset {
  id: "night" | "focus" | "party" | "chill" | "workout" | "road";
  query: string;
}
export const DJ_MOODS: readonly DjMoodPreset[] = [
  { id: "night", query: "night" },
  { id: "focus", query: "focus" },
  { id: "party", query: "party" },
  { id: "chill", query: "chill" },
  { id: "workout", query: "workout" },
  { id: "road", query: "drive" },
];

/**
 * The ids to seed a likes session from an ordered liked-ids list (newest first): local files can't seed
 * (no related lists), dupes and garbage are skipped, the first `count` survivors win.
 */
export function pickLikeSeeds(likedIds: readonly number[], isLocal: (id: number) => boolean, count: number = DJ_SOURCE_SEEDS): number[] {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : DJ_SOURCE_SEEDS;
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

/**
 * The seeds to grow an artist or playlist session from a page of tracks (first page, source order): local
 * files can't seed (no related lists), dupes and garbage are skipped, the first `count` survivors win —
 * titles known, so the seeds carry them.
 */
export function pickTrackSeeds(tracks: readonly Track[], isLocal: (id: number) => boolean, count: number = DJ_SOURCE_SEEDS): DjSeed[] {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : DJ_SOURCE_SEEDS;
  const picked: DjSeed[] = [];
  const seen = new Set<number>();
  for (const t of tracks) {
    if (picked.length >= n) break;
    if (!t || !Number.isSafeInteger(t.id) || t.id <= 0 || seen.has(t.id) || isLocal(t.id)) continue;
    seen.add(t.id);
    picked.push({ id: t.id, title: t.title ?? null });
  }
  return picked;
}
