import assert from "node:assert/strict";
import { test } from "node:test";
import { fastLines, lineIndexAt, sweep, wordProgress } from "./lyricsTiming.ts";

const lines = (ts: number[]) => ts.map((t) => ({ t }));

test("lineIndexAt picks the last line that started, -1 before the first", () => {
  const l = lines([10, 20, 30.5, 40]);
  assert.equal(lineIndexAt(l, 0), -1);
  assert.equal(lineIndexAt(l, 9.99), -1);
  assert.equal(lineIndexAt(l, 10), 0);
  assert.equal(lineIndexAt(l, 19.999), 0);
  assert.equal(lineIndexAt(l, 20), 1);
  assert.equal(lineIndexAt(l, 30.5), 2);
  assert.equal(lineIndexAt(l, 9999), 3);
  assert.equal(lineIndexAt([], 5), -1);
  // duplicate times: the later of the duplicates is the one lit
  assert.equal(lineIndexAt(lines([10, 10, 20]), 10), 1);
});

test("fastLines: a dense verse of short gaps counts as fast, a ballad doesn't", () => {
  const rap = lines(Array.from({ length: 40 }, (_, i) => i * 1.2));
  const sparse = lines([0, 3, 5.5, 8, 12, 16, 20, 30, 40]);
  const few = lines([0, 0.5, 1, 1.5, 2]); // under 5 gaps: not judged fast by this signal
  assert.equal(fastLines(rap), true);
  assert.equal(fastLines(sparse), false);
  assert.equal(fastLines(few), false);
  assert.equal(fastLines([]), false);
});

test("sweep: empty and degenerate input never produce NaN", () => {
  assert.deepEqual(sweep([], 0, 5, 1), []);
  // duplicate line times (broken LRC): p was NaN before, now the words fill at once
  const k = sweep(["one", "two"], 10, 10, 10);
  assert.ok(k.every((v) => Number.isFinite(v)));
  // a line whose next line starts before it (unordered times): same guarantee
  assert.ok(sweep(["one", "two"], 10, 5, 10).every((v) => Number.isFinite(v)));
});

test("sweep: a word in the middle fills across the line's span", () => {
  const words = ["aaa", "bbb", "ccc"];
  const start = 100;
  const next = 103;
  assert.deepEqual(sweep(words, start, next, start - 1), [0, 0, 0]);
  const mid = sweep(words, start, next, start + 0.1);
  assert.ok(mid[0]! > 0 && mid[0]! < 1);
  assert.equal(mid[2], 0);
  // well past the end of the span every word is lit
  assert.deepEqual(sweep(words, start, next, start + 10), [1, 1, 1]);
});

test("sweep: order is left to right, earlier words finish first", () => {
  const words = ["short", "a much longer word here", "tiny"];
  const k = sweep(words, 0, 6, 1);
  assert.equal(k[0], 1);
  assert.ok(k[1]! > 0 && k[1]! < 1);
  assert.equal(k[2], 0);
});

test("wordProgress: clamps to 0..1 and tolerates zero-length words", () => {
  assert.equal(wordProgress(5, 6, 4), 0);
  assert.equal(wordProgress(5, 6, 5.5), 0.5);
  assert.equal(wordProgress(5, 6, 7), 1);
  // a zero-length word lights over the minimum span, never NaN
  assert.equal(wordProgress(5, 5, 5), 0);
  assert.equal(wordProgress(5, 5, 5.1), 1);
  assert.ok(Number.isFinite(wordProgress(5, NaN, 6)));
});
