import assert from "node:assert/strict";
import { test } from "node:test";
import { isLocalTrack as isLocal, LOCAL_TRACK_BASE, type Track } from "../../../shared/types.ts";
import { DJ_SOURCE_SEEDS, pickLikeSeeds, pickTrackSeeds } from "./djSources.ts";

const LOCAL_BASE = LOCAL_TRACK_BASE;

function makeTrack(id: number, title: string | null = `Track ${id}`): Track {
  return { id, title: title ?? `Track ${id}`, artist: "Artist", user: { id: 7, username: "Artist", permalinkUrl: "" }, durationMs: 180_000, artworkUrl: null, waveformUrl: null, permalinkUrl: "", playability: "ok" };
}

test("seeds keep the list order, newest first", () => {
  assert.deepEqual(pickLikeSeeds([9, 7, 5, 3, 1], isLocal, 3), [9, 7, 5]);
});

test("all-local likes seed nothing", () => {
  assert.deepEqual(pickLikeSeeds([LOCAL_BASE + 1, LOCAL_BASE + 2], isLocal), []);
});

test("local files are skipped among seedable likes", () => {
  assert.deepEqual(pickLikeSeeds([LOCAL_BASE + 1, 9, LOCAL_BASE + 2, 7], isLocal), [9, 7]);
});

test("dupes seed once", () => {
  assert.deepEqual(pickLikeSeeds([9, 9, 7, 7, 5], isLocal), [9, 7, 5]);
});

test("garbage ids are skipped", () => {
  assert.deepEqual(pickLikeSeeds([0, -3, NaN, 1.5, 9, Number.MAX_SAFE_INTEGER + 1], isLocal), [9]);
});

test("a short list seeds what survives", () => {
  assert.deepEqual(pickLikeSeeds([9], isLocal), [9]);
  assert.deepEqual(pickLikeSeeds([], isLocal), []);
});

test("the default takes six; a garbage count falls back to it", () => {
  const ids = [1, 2, 3, 4, 5, 6, 7, 8];
  assert.equal(pickLikeSeeds(ids, isLocal).length, DJ_SOURCE_SEEDS);
  assert.equal(DJ_SOURCE_SEEDS, 6);
  assert.equal(pickLikeSeeds(ids, isLocal, NaN).length, DJ_SOURCE_SEEDS);
  assert.deepEqual(pickLikeSeeds(ids, isLocal, 0), []);
});

test("track seeds keep the page order and carry their titles", () => {
  const seeds = pickTrackSeeds([makeTrack(9), makeTrack(7), makeTrack(5)], isLocal, 2);
  assert.deepEqual(seeds, [
    { id: 9, title: "Track 9" },
    { id: 7, title: "Track 7" },
  ]);
});

test("track seeds skip local files, dupes and garbage", () => {
  const tracks = [makeTrack(LOCAL_BASE + 1), makeTrack(9), makeTrack(9), makeTrack(0), makeTrack(-2), null, undefined, makeTrack(7)];
  assert.deepEqual(pickTrackSeeds(tracks as Track[], isLocal), [
    { id: 9, title: "Track 9" },
    { id: 7, title: "Track 7" },
  ]);
});

test("an all-local page seeds nothing", () => {
  assert.deepEqual(pickTrackSeeds([makeTrack(LOCAL_BASE + 1), makeTrack(LOCAL_BASE + 2)], isLocal), []);
});

test("track seeds default to six and survive a garbage count", () => {
  const tracks = [1, 2, 3, 4, 5, 6, 7, 8].map((id) => makeTrack(id));
  assert.equal(pickTrackSeeds(tracks, isLocal).length, DJ_SOURCE_SEEDS);
  assert.equal(pickTrackSeeds(tracks, isLocal, NaN).length, DJ_SOURCE_SEEDS);
  assert.deepEqual(pickTrackSeeds(tracks, isLocal, 0), []);
});
