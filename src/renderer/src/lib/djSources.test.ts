import assert from "node:assert/strict";
import { test } from "node:test";
import { isLocalTrack as isLocal, LOCAL_TRACK_BASE } from "../../../shared/types.ts";
import { DJ_LIKE_SEEDS, pickLikeSeeds } from "./djSources.ts";

const LOCAL_BASE = LOCAL_TRACK_BASE;

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
  assert.equal(pickLikeSeeds(ids, isLocal).length, DJ_LIKE_SEEDS);
  assert.equal(DJ_LIKE_SEEDS, 6);
  assert.equal(pickLikeSeeds(ids, isLocal, NaN).length, DJ_LIKE_SEEDS);
  assert.deepEqual(pickLikeSeeds(ids, isLocal, 0), []);
});
