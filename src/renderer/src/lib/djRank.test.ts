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

test("untitled seeds count for co-occurrence but are never named", () => {
  const seeds: DjSeed[] = [
    { id: 1, title: "Seed One" },
    { id: 7, title: null },
  ];
  // via the untitled seed alone: outranks a seedless track, but stays nameless
  const picks = rankDjCandidates([cand(makeTrack(2), [7], 5), cand(makeTrack(3), [999], 0)], { ...base, seeds });
  assert.deepEqual(picks.map((p) => p.track.id), [2, 3]);
  assert.deepEqual(picks[0]!.why, { kind: "generic" });
  // mixed with a titled seed: the titled one is named, the untitled one stays quiet
  const mixed = rankDjCandidates([cand(makeTrack(4), [1, 7], 3)], { ...base, seeds });
  assert.deepEqual(mixed[0]!.why, { kind: "seed", seedId: 1, seedTitle: "Seed One" });
  assert.equal(mixed[0]!.score, 2 * 1000 - 3);
  // ...and the untitled seed itself is never recommended either
  const self = rankDjCandidates([cand(makeTrack(7), [1], 0), cand(makeTrack(8), [1], 1)], { ...base, seeds });
  assert.deepEqual(self.map((p) => p.track.id), [8]);
});

test("one seed: an untitled lone seed ranks like a titled one", () => {
  const pool = [cand(makeTrack(2), [1], 2), cand(makeTrack(3), [1], 0)];
  const titled = rankDjCandidates(pool, base);
  const untitled = rankDjCandidates(pool, { ...base, seeds: [{ id: 1, title: null }] });
  assert.deepEqual(untitled.map((p) => p.track.id), titled.map((p) => p.track.id));
  assert.deepEqual(untitled.map((p) => p.score), titled.map((p) => p.score));
  assert.ok(untitled.every((p) => p.why.kind === "generic"));
});

test("the result doesn't depend on the seed order", () => {
  const seeds: DjSeed[] = [
    { id: 1, title: "Seed One" },
    { id: 7, title: "Seed Seven" },
  ];
  const pool = [cand(makeTrack(2), [7, 1], 4), cand(makeTrack(3), [1], 0), cand(makeTrack(4), [7], 1)];
  const ab = rankDjCandidates(pool, { ...base, seeds });
  const ba = rankDjCandidates(pool, { ...base, seeds: [...seeds].reverse() });
  assert.deepEqual(ba, ab);
});

test("a likes group explains by overlap, and only when it hits", () => {
  const seeds: DjSeed[] = [
    { id: 1, title: null },
    { id: 2, title: null },
    { id: 3, title: "Seed Three" },
  ];
  const opts = { ...base, seeds, groups: { likes: [1, 2] } };
  // the group wins over single-seed naming: the count is the real overlap
  const hit = rankDjCandidates([cand(makeTrack(4), [1, 2], 3), cand(makeTrack(5), [2], 1)], opts);
  assert.deepEqual(hit.map((p) => p.track.id), [4, 5]);
  assert.deepEqual(hit[0]!.why, { kind: "likes", count: 2 });
  assert.deepEqual(hit[1]!.why, { kind: "likes", count: 1 });
  // mixed with an outsider: the group still explains, counting only its own
  const mixed = rankDjCandidates([cand(makeTrack(8), [1, 3], 2)], opts);
  assert.deepEqual(mixed[0]!.why, { kind: "likes", count: 1 });
  // no group seed in the list: the old words still apply
  const miss = rankDjCandidates([cand(makeTrack(6), [3], 0), cand(makeTrack(7), [999], 0)], opts);
  assert.deepEqual(miss[0]!.why, { kind: "seed", seedId: 3, seedTitle: "Seed Three" });
  assert.deepEqual(miss[1]!.why, { kind: "generic" });
});

test("an artist group explains with its name, and only when it hits", () => {
  const seeds: DjSeed[] = [
    { id: 1, title: "One" },
    { id: 2, title: "Two" },
    { id: 3, title: "Seed Three" },
  ];
  const opts = { ...base, seeds, groups: { artist: { ids: [1, 2], name: "The Weeknd", via: "tracks" as const } } };
  const hit = rankDjCandidates([cand(makeTrack(4), [1, 2], 3)], opts);
  assert.deepEqual(hit[0]!.why, { kind: "artist", count: 2, name: "The Weeknd", via: "tracks" });
  // a likes-grown artist page says so: the via rides along for the honest words
  const viaLikes = { ...base, seeds, groups: { artist: { ids: [1], name: "Fan", via: "likes" as const } } };
  const liked = rankDjCandidates([cand(makeTrack(5), [1], 1)], viaLikes);
  assert.deepEqual(liked[0]!.why, { kind: "artist", count: 1, name: "Fan", via: "likes" });
  // no group seed in the list: the old words still apply
  const miss = rankDjCandidates([cand(makeTrack(6), [3], 0)], opts);
  assert.deepEqual(miss[0]!.why, { kind: "seed", seedId: 3, seedTitle: "Seed Three" });
});

test("a playlist group explains with its title, and only when it hits", () => {
  const seeds: DjSeed[] = [
    { id: 1, title: "One" },
    { id: 3, title: "Seed Three" },
  ];
  const opts = { ...base, seeds, groups: { playlist: { ids: [1], title: "Chill" } } };
  const hit = rankDjCandidates([cand(makeTrack(4), [1], 2)], opts);
  assert.deepEqual(hit[0]!.why, { kind: "playlist", count: 1, title: "Chill" });
  const miss = rankDjCandidates([cand(makeTrack(6), [3], 0), cand(makeTrack(7), [999], 0)], opts);
  assert.deepEqual(miss[0]!.why, { kind: "seed", seedId: 3, seedTitle: "Seed Three" });
  assert.deepEqual(miss[1]!.why, { kind: "generic" });
});

test("a genre group explains with its name, and only when it hits", () => {
  const seeds: DjSeed[] = [
    { id: 1, title: "One" },
    { id: 3, title: "Seed Three" },
  ];
  const opts = { ...base, seeds, groups: { genre: { ids: [1], name: "Phonk" } } };
  const hit = rankDjCandidates([cand(makeTrack(4), [1], 2)], opts);
  assert.deepEqual(hit[0]!.why, { kind: "genre", count: 1, name: "Phonk" });
  const miss = rankDjCandidates([cand(makeTrack(6), [3], 0), cand(makeTrack(7), [999], 0)], opts);
  assert.deepEqual(miss[0]!.why, { kind: "seed", seedId: 3, seedTitle: "Seed Three" });
  assert.deepEqual(miss[1]!.why, { kind: "generic" });
});

test("a mood group explains with its name, and only when it hits", () => {
  const seeds: DjSeed[] = [
    { id: 1, title: "One" },
    { id: 3, title: "Seed Three" },
  ];
  const opts = { ...base, seeds, groups: { mood: { ids: [1], name: "Night" } } };
  const hit = rankDjCandidates([cand(makeTrack(4), [1], 2)], opts);
  assert.deepEqual(hit[0]!.why, { kind: "mood", count: 1, name: "Night" });
  const miss = rankDjCandidates([cand(makeTrack(6), [3], 0), cand(makeTrack(7), [999], 0)], opts);
  assert.deepEqual(miss[0]!.why, { kind: "seed", seedId: 3, seedTitle: "Seed Three" });
  assert.deepEqual(miss[1]!.why, { kind: "generic" });
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
