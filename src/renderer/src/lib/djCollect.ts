import type { Track } from "@shared/types";
import type { DjCandidate, DjSeed } from "./djRank";

/**
 * Moonwave DJ: gathering the candidate pool. One `data:related` request per seed, in parallel; duplicates merged
 * (union of seeds, SoundCloud's best position), pool capped. No ranking here — `rankDjCandidates` orders the pool.
 *
 * - One seed's failure never sinks the rest: `failedSeeds` tells them apart. All failed = network trouble, none
 *   failed but empty = nothing found — the session controller turns that into the right UI state.
 * - AbortSignal cancels: an abort before or during the flight throws the signal's reason instead of delivering
 *   tracks nobody waits for. (Dropping a response that arrived after a *newer* session started is the controller's
 *   generation counter, not this one-shot call.)
 * - The fetch is injected (`data:related` in the app, a stub in tests), so this runs without Electron or IPC.
 */

/** What `data:related` gives for one seed. */
export type DjFetchRelated = (seedId: number) => Promise<Track[]>;

export interface DjCollectOptions {
  /** cancels the flight: the call throws the signal's reason */
  signal?: AbortSignal;
  /** tracks kept per seed (SoundCloud sends 20; this is a guard). Default 20. */
  perSeedLimit?: number;
  /** tracks kept in the whole pool (a memory guard, not a playlist length). Default 200. */
  totalLimit?: number;
}

export interface DjCollectResult {
  /** deduped pool in first-seen order (seeds in the given order, then SoundCloud's order within a seed) */
  candidates: DjCandidate[];
  /** seeds whose request failed — the rest still contributed */
  failedSeeds: number[];
}

export const DJ_COLLECT_DEFAULTS = { perSeedLimit: 20, totalLimit: 200 } as const;

function asLimit(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}

/** Settles like `promise`, but rejects with the signal's reason the moment it fires (listener removed either way). */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

export async function collectDjCandidates(seeds: readonly DjSeed[], fetchRelated: DjFetchRelated, options: DjCollectOptions = {}): Promise<DjCollectResult> {
  const signal = options.signal;
  signal?.throwIfAborted();
  // the same seed twice: fetched once
  const unique = [...new Map(seeds.map((s) => [s.id, s])).values()];
  if (unique.length === 0) return { candidates: [], failedSeeds: [] };
  const perSeedLimit = asLimit(options.perSeedLimit, DJ_COLLECT_DEFAULTS.perSeedLimit);
  const totalLimit = asLimit(options.totalLimit, DJ_COLLECT_DEFAULTS.totalLimit);

  const flight = Promise.allSettled(unique.map((s) => fetchRelated(s.id)));
  const settled = signal ? await abortable(flight, signal) : await flight;
  // aborted while the last answer was on its way: throw instead of delivering it late
  signal?.throwIfAborted();

  const failedSeeds: number[] = [];
  const byId = new Map<number, { track: Track; via: Set<number>; order: number }>();
  for (let i = 0; i < settled.length; i++) {
    const seed = unique[i];
    if (!seed) continue;
    const result = settled[i];
    if (!result || result.status === "rejected") {
      failedSeeds.push(seed.id);
      continue;
    }
    // a resolved non-list is a provider bug, not a network error: the seed counts as empty, not failed
    const list = Array.isArray(result.value) ? result.value.slice(0, perSeedLimit) : [];
    for (let order = 0; order < list.length; order++) {
      const track = list[order];
      if (!track) continue;
      const prev = byId.get(track.id);
      if (!prev) byId.set(track.id, { track, via: new Set([seed.id]), order });
      else {
        prev.via.add(seed.id);
        if (order < prev.order) prev.order = order;
      }
    }
  }
  const candidates = [...byId.values()].slice(0, totalLimit).map(({ track, via, order }) => ({ track, viaSeeds: [...via], order }));
  return { candidates, failedSeeds };
}
