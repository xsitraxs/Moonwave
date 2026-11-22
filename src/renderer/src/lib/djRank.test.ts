import assert from "node:assert/strict";
import { test } from "node:test";
import type { Track } from "../../../shared/types.ts";
import { rankDjCandidates, type DjCandidate, type DjSeed } from "./djRank.ts";

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

const seed: DjSeed = { id: 1, title: "Seed Song" };
const cand = (track: Track, viaSeeds: number[] = [seed.id], order = 0): DjCandidate => ({ track, viaSeeds, order });
const base = { seeds: [seed], exclude: [] as number[], perArtistCap: 2, limit: 20 };

test("empty pool gives empty picks", () => {
  assert.deepEqual(rankDjCandidates([], base), []);
});

test("zero limit gives empty picks", () => {
  assert.deepEqual(rankDjCandidates([cand(makeTrack(2))], { ...base, limit: 0 }), []);
});

test("history, queue and dismissed ids are excluded", () => {
  const picks = rankDjCandidates([cand(makeTrack(2), [1], 0), cand(makeTrack(3), [1], 1)], { ...base, exclude: [2] });
  assert.deepEqual(picks.map((p) => p.track.id), [3]);
});

test("the seed itself is never recommended", () => {
  const seedTrack = makeTrack(1, { title: "Seed Song" });
  const picks = rankDjCandidates([cand(seedTrack, [1], 0), cand(makeTrack(2), [1], 1)], base);
  assert.deepEqual(picks.map((p) => p.track.id), [2]);
});

test("playability is not filtered: blocked and drm rank like everything else", () => {
  const picks = rankDjCandidates(
    [
      cand(makeTrack(2, { playability: "blocked" }), [1], 0),
      cand(makeTrack(3, { playability: "drm" }), [1], 1),
      cand(makeTrack(4, { playability: "preview" }), [1], 2),
      cand(makeTrack(5, { playability: "ok" }), [1], 3),
    ],
    base,
  );
  // SoundCloud order decides; the substitute system (not the ranker) handles protection at play time
  assert.deepEqual(picks.map((p) => p.track.id), [2, 3, 4, 5]);
});

test("duplicates merge: one pick, union of seeds, best order", () => {
  const seeds: DjSeed[] = [
    { id: 1, title: "Seed One" },
    { id: 7, title: "Seed Seven" },
  ];
  const track = makeTrack(2);
  const picks = rankDjCandidates([cand(track, [1], 5), cand(track, [7, 1], 2)], { ...base, seeds });
  assert.equal(picks.length, 1);
  assert.deepEqual(picks[0]!.why, { kind: "seeds", count: 2 });
});

test("a track in two seeds' lists outranks a single-seed one", () => {
  const seeds: DjSeed[] = [
    { id: 1, title: "Seed One" },
    { id: 7, title: "Seed Seven" },
  ];
  const picks = rankDjCandidates([cand(makeTrack(2), [1], 0), cand(makeTrack(3), [1, 7], 19)], { ...base, seeds });
  assert.deepEqual(picks.map((p) => p.track.id), [3, 2]);
  assert.deepEqual(picks[0]!.why, { kind: "seeds", count: 2 });
});

test("with one seed, SoundCloud's order decides", () => {
  const picks = rankDjCandidates([cand(makeTrack(2), [1], 3), cand(makeTrack(3), [1], 0), cand(makeTrack(4), [1], 1)], base);
  assert.deepEqual(picks.map((p) => p.track.id), [3, 4, 2]);
});

test("per-artist cap keeps the best and drops the rest", () => {
  const a = (id: number, order: number) => cand(makeTrack(id, { user: { id: 42, username: "Same Artist", permalinkUrl: "" } }), [1], order);
  const picks = rankDjCandidates([a(2, 0), a(3, 1), a(4, 2), cand(makeTrack(5), [1], 3)], { ...base, perArtistCap: 2 });
  assert.deepEqual(picks.map((p) => p.track.id), [2, 3, 5]);
});

test("limit cuts the tail", () => {
  const picks = rankDjCandidates([cand(makeTrack(2), [1], 0), cand(makeTrack(3), [1], 1)], { ...base, limit: 1 });
  assert.deepEqual(picks.map((p) => p.track.id), [2]);
});

test("reasons name the real seed", () => {
  const picks = rankDjCandidates([cand(makeTrack(2), [1], 0)], base);
  assert.deepEqual(picks[0]!.why, { kind: "seed", seedId: 1, seedTitle: "Seed Song" });
});

test("unknown seed ids are ignored, not claimed", () => {
  const picks = rankDjCandidates([cand(makeTrack(2), [999], 0)], base);
  assert.equal(picks.length, 1);
  assert.deepEqual(picks[0]!.why, { kind: "generic" });
});

test("\"more\" lifts the artist, \"less\" sinks it, and the pick says so", () => {
  const liked = makeTrack(2, { user: { id: 11, username: "Loved", permalinkUrl: "" } });
  const disliked = makeTrack(3, { user: { id: 12, username: "Meh", permalinkUrl: "" } });
  const plain = makeTrack(4, { user: { id: 13, username: "Plain", permalinkUrl: "" } });
  const pool = [cand(disliked, [1], 0), cand(plain, [1], 1), cand(liked, [1], 2)];
  const picks = rankDjCandidates(pool, { ...base, feedback: { moreArtists: [11], lessArtists: [12] } });
  assert.deepEqual(picks.map((p) => p.track.id), [2, 4, 3]);
  assert.deepEqual(picks.map((p) => p.feedback), ["more", null, "less"]);
});

test("paused feedback changes nothing", () => {
  const pool = [cand(makeTrack(2), [1], 0), cand(makeTrack(3), [1], 1)];
  const plain = rankDjCandidates(pool, base);
  const paused = rankDjCandidates(pool, { ...base, feedback: { moreArtists: [1003], lessArtists: [] }, feedbackOn: false });
  assert.deepEqual(paused, plain);
});

test("no seeds: neutral reasons, SoundCloud order decides", () => {
  const picks = rankDjCandidates([cand(makeTrack(2), [1], 1), cand(makeTrack(3), [1], 0)], { ...base, seeds: [] });
  assert.deepEqual(picks.map((p) => p.track.id), [3, 2]);
  assert.ok(picks.every((p) => p.why.kind === "generic"));
});

test("garbage numbers stay deterministic", () => {
  const pool = [cand(makeTrack(2), [1], -5), cand(makeTrack(3), [1], Number.NaN)];
  // a negative / NaN position becomes "top of the list": full tie, the smaller id wins
  assert.deepEqual(rankDjCandidates(pool, base).map((p) => p.track.id), [2, 3]);
  // a NaN cap falls back to 1, a NaN limit to 0
  const sameArtist = (id: number) => cand(makeTrack(id, { user: { id: 42, username: "Same", permalinkUrl: "" } }), [1], 0);
  assert.equal(rankDjCandidates([sameArtist(2), sameArtist(3)], { ...base, perArtistCap: Number.NaN }).length, 1);
  assert.deepEqual(rankDjCandidates(pool, { ...base, limit: Number.NaN }), []);
});

test("deterministic: same input, same output, input untouched", () => {
  const pool = [cand(makeTrack(3), [1], 1), cand(makeTrack(2), [1], 1), cand(makeTrack(4), [1], 0)];
  const frozen = structuredClone(pool);
  const first = rankDjCandidates(pool, base);
  const second = rankDjCandidates(pool, base);
  assert.deepEqual(first, second);
  assert.deepEqual(pool, frozen);
  // full tie (same order, same score): the smaller id wins, every time
  assert.deepEqual(first.map((p) => p.track.id), [4, 2, 3]);
});
