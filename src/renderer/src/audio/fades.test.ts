import assert from "node:assert/strict";
import { test } from "node:test";
import { crossfadeDue, fadeLength, fadeLevels, prefetchDue } from "./fades.ts";

test("the fade starts within the chosen crossfade, and not in the last half second of the track", () => {
  assert.equal(crossfadeDue(6, 8), true, "6 s left, an 8 s crossfade");
  assert.equal(crossfadeDue(8, 8), true, "exactly at the edge");
  assert.equal(crossfadeDue(8.1, 8), false, "not yet");
  assert.equal(crossfadeDue(0.4, 8), false, "too close to the end to start one");
  assert.equal(crossfadeDue(0, 8), false);
});

test("a track whose length isn't known never starts a fade", () => {
  assert.equal(crossfadeDue(Number.NaN, 8), false);
  assert.equal(crossfadeDue(Number.POSITIVE_INFINITY, 8), false);
});

test("the fade lasts the chosen crossfade, or what is left of the track, and at least half a second", () => {
  assert.equal(fadeLength(60, 8), 8, "a long track: the whole crossfade");
  assert.equal(fadeLength(3, 8), 3, "the track ends in 3 s: the fade does too");
  assert.equal(fadeLength(0.2, 8), 0.5, "never shorter than half a second");
  assert.equal(fadeLength(Number.NaN, 8), 0.5, "no duration reported: a short fade anyway");
});

test("the decks' levels move from one to the other across the fade", () => {
  assert.deepEqual(fadeLevels(0, 4), { from: 1, to: 0 }, "the start: only the old deck");
  assert.deepEqual(fadeLevels(2000, 4), { from: 0.5, to: 0.5 }, "halfway: both at half");
  assert.deepEqual(fadeLevels(4000, 4), { from: 0, to: 1 }, "the end: only the new deck");
  assert.deepEqual(fadeLevels(9000, 4), { from: 0, to: 1 }, "late 50 ms ticks past the end are clamped");
  assert.deepEqual(fadeLevels(500, 1), { from: 0.5, to: 0.5 }, "a shorter fade runs faster");
});

test("the next stream is asked for while the track is still within reach of its end", () => {
  assert.equal(prefetchDue(25, 20), false, "too early");
  assert.equal(prefetchDue(20, 20), true, "exactly at the mark");
  assert.equal(prefetchDue(3, 20), true);
  assert.equal(prefetchDue(-1, 20), true, "already past the end: ask at once");
  assert.equal(prefetchDue(Number.NaN, 20), false, "no position to reason about");
});
