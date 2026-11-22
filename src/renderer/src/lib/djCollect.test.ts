import assert from "node:assert/strict";
import { test } from "node:test";
import type { Track } from "../../../shared/types.ts";
import { collectDjCandidates, type DjFetchRelated } from "./djCollect.ts";

function makeTrack(id: number, overrides: Partial<Track> = {}): Track {
  return {
    id,
    title: `Track ${id}`,
    artist: `Artist ${id}`,
    user: { id: 1000 + id, username: `Artist ${id}`, permalinkUrl: "" },
    durationMs: 180_000,
    artworkUrl: null,
    waveformUrl: null,
    permalinkUrl: "",
    playability: "ok",
    ...overrides,
  };
}

const seeds = [
  { id: 1, title: "Seed One" },
  { id: 7, title: "Seed Seven" },
];

test("merges seeds: union of viaSeeds, best order, first-seen track wins", async () => {
  const fetch: DjFetchRelated = async (id) =>
    id === 1 ? [makeTrack(10), makeTrack(11)] : [makeTrack(11, { title: "Other snapshot" }), makeTrack(12)];
  const { candidates, failedSeeds } = await collectDjCandidates(seeds, fetch);
  assert.deepEqual(failedSeeds, []);
  assert.deepEqual(
    candidates.map((c) => [c.track.id, [...c.viaSeeds], c.order]),
    [
      [10, [1], 0],
      [11, [1, 7], 0],
      [12, [7], 1],
    ],
  );
  assert.equal(candidates[1]!.track.title, "Track 11");
});

test("the same seed twice is fetched once", async () => {
  let calls = 0;
  const fetch: DjFetchRelated = async () => {
    calls++;
    return [makeTrack(10)];
  };
  const { candidates } = await collectDjCandidates(
    [
      { id: 1, title: "Seed" },
      { id: 1, title: "Seed again" },
    ],
    fetch,
  );
  assert.equal(calls, 1);
  assert.deepEqual(candidates[0]!.viaSeeds, [1]);
});

test("per-seed and total caps guard the pool", async () => {
  const fetch: DjFetchRelated = async (id) => Array.from({ length: 25 }, (_, i) => makeTrack(id * 1000 + i));
  const perSeed = await collectDjCandidates(seeds.slice(0, 1), fetch, { perSeedLimit: 20 });
  assert.equal(perSeed.candidates.length, 20);
  const total = await collectDjCandidates(seeds, fetch, { perSeedLimit: 25, totalLimit: 30 });
  assert.equal(total.candidates.length, 30);
});

test("one seed's failure doesn't sink the rest", async () => {
  const fetch: DjFetchRelated = async (id) => {
    if (id === 1) throw new Error("offline");
    return [makeTrack(12)];
  };
  const { candidates, failedSeeds } = await collectDjCandidates(seeds, fetch);
  assert.deepEqual(failedSeeds, [1]);
  assert.deepEqual(candidates.map((c) => c.track.id), [12]);
});

test("all seeds failed: empty pool, all failed, no throw", async () => {
  const fetch: DjFetchRelated = async () => {
    throw new Error("offline");
  };
  const { candidates, failedSeeds } = await collectDjCandidates(seeds, fetch);
  assert.deepEqual(candidates, []);
  assert.deepEqual(failedSeeds, [1, 7]);
});

test("empty answers: empty pool, none failed", async () => {
  const { candidates, failedSeeds } = await collectDjCandidates(seeds, async () => []);
  assert.deepEqual(candidates, []);
  assert.deepEqual(failedSeeds, []);
});

test("no seeds: fetch never runs", async () => {
  let calls = 0;
  const result = await collectDjCandidates([], async () => {
    calls++;
    return [];
  });
  assert.equal(calls, 0);
  assert.deepEqual(result, { candidates: [], failedSeeds: [] });
});

test("a resolved non-list counts the seed as empty, not failed", async () => {
  const fetch = (async () => "garbage") as unknown as DjFetchRelated;
  const { candidates, failedSeeds } = await collectDjCandidates(seeds.slice(0, 1), fetch);
  assert.deepEqual(candidates, []);
  assert.deepEqual(failedSeeds, []);
});

test("abort before start throws and never fetches", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(
    collectDjCandidates(seeds, async () => {
      calls++;
      return [];
    }, { signal: controller.signal }),
    (e: unknown) => e === controller.signal.reason,
  );
  assert.equal(calls, 0);
});

test("abort mid-flight throws the signal's reason", async () => {
  const controller = new AbortController();
  let release: (tracks: Track[]) => void = () => {};
  const gate = new Promise<Track[]>((resolve) => (release = resolve));
  const run = collectDjCandidates(seeds.slice(0, 1), () => gate, { signal: controller.signal });
  const failed = assert.rejects(run, (e: unknown) => e === controller.signal.reason);
  controller.abort();
  release([makeTrack(10)]);
  await failed;
});

test("seeds input is left untouched", async () => {
  const input = [
    { id: 1, title: "Seed One" },
    { id: 1, title: "Seed One again" },
  ];
  await collectDjCandidates(input, async () => [makeTrack(10)]);
  assert.deepEqual(input, [
    { id: 1, title: "Seed One" },
    { id: 1, title: "Seed One again" },
  ]);
});
