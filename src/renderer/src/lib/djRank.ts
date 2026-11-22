import type { Track } from "@shared/types";

/**
 * Moonwave DJ: picking the next tracks from already-fetched candidates.
 *
 * A pure, deterministic function: no network, no storage, no player access. The session controller (a later step)
 * fetches `data:related` for the seeds, marks what to exclude, and calls this to order the pool.
 *
 * Scoring (starting numbers, to be tuned by listening — not by tests):
 * - each seed whose related list contained the track: +1000 (co-occurrence; with one seed every candidate ties here)
 * - minus the best position in a seed's related response (0 = SoundCloud's own top pick), so the service's order
 *   breaks ties but never beats an extra seed
 * - session feedback on the track's artist: +500 for "more", -500 for "less" (ignored while paused)
 * - ties: SoundCloud order first, then the smaller track id — the same input always gives the same output
 *
 * Filtering: seeds themselves and excluded ids (history, queue, dismissed). Playability is deliberately NOT
 * filtered here — exactly like the autopilot and the stations: fresh `blocked` / `drm` tracks usually play
 * through the substitute system, and their flag in a related response often just means "no stream data attached".
 * The session controller applies the player's own `canPlay` before appending, so hidden and proven-dead tracks
 * still stay out. Local tracks never come from `data:related`; a local seed simply yields no candidates and
 * the controller reports "no data" instead of calling this with garbage.
 *
 * Reasons (`why`) only ever name seeds that really listed the track; anything else is the neutral `generic`.
 * `feedback` tells the UI when a session rating moved the track, so the interface can say so honestly.
 */

export interface DjSeed {
  id: number;
  title: string;
}

/** One related track as the collector saw it. Duplicates are fine: they are merged (union of seeds, best order). */
export interface DjCandidate {
  track: Track;
  /** ids of the seeds whose `data:related` list contained this track */
  viaSeeds: readonly number[];
  /** best (smallest) position in a seed's related response; 0 = SoundCloud's top pick */
  order: number;
}

export interface DjFeedback {
  /** artist (`track.user.id`) ratings from this session's thumbs up / down; the UI keeps the two disjoint */
  moreArtists: readonly number[];
  lessArtists: readonly number[];
}

export interface DjRankOptions {
  seeds: readonly DjSeed[];
  /** history + queue + dismissed track ids: never recommended */
  exclude: readonly number[];
  /** max tracks per artist (`track.user.id`) in the output */
  perArtistCap: number;
  /** max tracks to return */
  limit: number;
  feedback?: DjFeedback;
  /** session ratings paused: collected, but not applied. Default true (applied). */
  feedbackOn?: boolean;
}

export type DjWhy = { kind: "seed"; seedId: number; seedTitle: string } | { kind: "seeds"; count: number } | { kind: "generic" };

export interface DjPick {
  track: Track;
  score: number;
  why: DjWhy;
  /** session rating on this track's artist that moved it, if any */
  feedback: "more" | "less" | null;
}

const SEED_WEIGHT = 1000;
const FEEDBACK_WEIGHT = 500;

/** A count from options: a finite integer ≥ `min`, or `min` when the caller passed garbage (NaN stays deterministic). */
function asCount(value: number, min: number): number {
  return Number.isFinite(value) ? Math.max(min, Math.floor(value)) : min;
}

/** A related-list position: a finite number ≥ 0 (garbage becomes 0, i.e. "top of the list"). */
function asOrder(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/** Starting numbers for the MVP: one seed × 20 related, at most 2 tracks per artist in the output. Tune by listening. */
export const DJ_RANK_DEFAULTS = { perArtistCap: 2, limit: 20 } as const;

export function rankDjCandidates(candidates: readonly DjCandidate[], options: DjRankOptions): DjPick[] {
  const seedById = new Map(options.seeds.map((s) => [s.id, s]));
  const excluded = new Set(options.exclude);
  const perArtistCap = asCount(options.perArtistCap, 1);
  const limit = asCount(options.limit, 0);
  if (!limit || candidates.length === 0) return [];
  const feedbackOn = options.feedbackOn ?? true;
  const more = feedbackOn ? new Set(options.feedback?.moreArtists ?? []) : new Set<number>();
  const less = feedbackOn ? new Set(options.feedback?.lessArtists ?? []) : new Set<number>();

  // Duplicates merged: the union of the seeds that listed the track, SoundCloud's best position for it.
  // Unknown seed ids are dropped — only real seeds count towards the score and the reason.
  // The first-seen track object wins when two snapshots of the same id disagree (deterministic).
  const merged = new Map<number, { track: Track; via: Set<number>; order: number }>();
  for (const c of candidates) {
    const order = asOrder(c.order);
    const prev = merged.get(c.track.id);
    if (!prev) {
      const via = new Set<number>();
      for (const s of c.viaSeeds) if (seedById.has(s)) via.add(s);
      merged.set(c.track.id, { track: c.track, via, order });
    } else {
      for (const s of c.viaSeeds) if (seedById.has(s)) prev.via.add(s);
      if (order < prev.order) prev.order = order;
    }
  }

  const scored: { track: Track; via: number; order: number; score: number; feedback: "more" | "less" | null }[] = [];
  for (const { track, via, order } of merged.values()) {
    if (excluded.has(track.id)) continue;
    if (seedById.has(track.id)) continue;
    const inMore = more.has(track.user.id);
    const inLess = less.has(track.user.id);
    const feedback = inMore && inLess ? null : inMore ? "more" : inLess ? "less" : null;
    scored.push({ track, via: via.size, order, score: via.size * SEED_WEIGHT - order + (feedback === "more" ? FEEDBACK_WEIGHT : feedback === "less" ? -FEEDBACK_WEIGHT : 0), feedback });
  }
  scored.sort((a, b) => b.score - a.score || a.order - b.order || a.track.id - b.track.id);

  const perArtist = new Map<number, number>();
  const picks: DjPick[] = [];
  for (const s of scored) {
    if (picks.length >= limit) break;
    const n = perArtist.get(s.track.user.id) ?? 0;
    if (n >= perArtistCap) continue;
    perArtist.set(s.track.user.id, n + 1);
    picks.push({ track: s.track, score: s.score, why: whyFor(merged.get(s.track.id)!.via, seedById), feedback: s.feedback });
  }
  return picks;
}

function whyFor(via: Set<number>, seedById: Map<number, DjSeed>): DjWhy {
  const known = [...via].filter((id) => seedById.has(id));
  if (known.length >= 2) return { kind: "seeds", count: known.length };
  const seed = seedById.get(known[0] ?? -1);
  if (seed) return { kind: "seed", seedId: seed.id, seedTitle: seed.title };
  return { kind: "generic" };
}
