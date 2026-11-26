import assert from "node:assert/strict";
import { test } from "node:test";
import { needsTopUp, nextPlayableIndex, shuffled } from "./queue.ts";

/** A queue of ids, with the ones that can't play listed: the player's `playable` predicate in miniature. */
const queueOf = (...ids: number[]) => ids;
const canPlay = (dead: number[]) => (id: number) => !dead.includes(id);

test("the next index skips what can't play", () => {
  const q = queueOf(1, 2, 3, 4);
  assert.equal(nextPlayableIndex(q, 0, false, canPlay([2])), 2);
  assert.equal(nextPlayableIndex(q, 2, false, canPlay([])), 3);
  assert.equal(nextPlayableIndex(q, 3, false, canPlay([])), -1, "nothing after the last one");
});

test("with a wrap the list starts over — and repeats a one-track list", () => {
  const q = queueOf(1, 2, 3);
  assert.equal(nextPlayableIndex(q, 2, true, canPlay([])), 0, "from the end back to the start");
  assert.equal(nextPlayableIndex(q, 1, true, canPlay([2, 3])), 0, "past the end, on to the first that plays");
  assert.equal(nextPlayableIndex(queueOf(7), 0, true, canPlay([])), 0, "one track, repeat all: the same track again");
  assert.equal(nextPlayableIndex(q, 2, false, canPlay([])), -1, "without repeat the queue just ends");
});

test("nothing playable means -1, wrapped or not", () => {
  const q = queueOf(1, 2, 3);
  assert.equal(nextPlayableIndex(q, 0, true, canPlay([1, 2, 3])), -1);
  assert.equal(nextPlayableIndex([], 0, true, canPlay([])), -1, "an empty queue");
});

test("from -1 (nothing loaded yet) the first playable track is next", () => {
  assert.equal(nextPlayableIndex(queueOf(5, 6, 7), -1, false, canPlay([5])), 1);
  assert.equal(nextPlayableIndex(queueOf(5), -1, true, canPlay([])), 0);
});

test("a shuffle keeps every track once and leaves the list it was given alone", () => {
  const list = [1, 2, 3, 4, 5, 6, 7, 8];
  const out = shuffled(list);
  assert.deepEqual([...out].sort((a, b) => a - b), list);
  assert.deepEqual(list, [1, 2, 3, 4, 5, 6, 7, 8], "the original is untouched");
  assert.deepEqual(shuffled([]), []);
  assert.deepEqual(shuffled(["only"]), ["only"]);
});

test("the same random numbers shuffle the same way (Fisher–Yates, last to first)", () => {
  // always the first of the remaining ones: each step swaps the last one with the first
  const first = () => 0;
  assert.deepEqual(shuffled([1, 2, 3, 4], first), [2, 3, 4, 1]);
  // always pick the last one: nothing moves
  const last = () => 0.999999;
  assert.deepEqual(shuffled([1, 2, 3, 4], last), [1, 2, 3, 4]);
});

test("the queue is filled while fewer than `ahead` tracks are left after the current one", () => {
  assert.equal(needsTopUp(0, -1, 3), true, "nothing loaded");
  assert.equal(needsTopUp(4, 0, 3), false, "three left: not yet");
  assert.equal(needsTopUp(4, 1, 3), true, "two left: fill");
  assert.equal(needsTopUp(1, 0, 3), true, "the last track: fill");
  assert.equal(needsTopUp(10, 9, 3), true, "at the end");
});
