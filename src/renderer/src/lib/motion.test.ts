import assert from "node:assert/strict";
import { test } from "node:test";
import { parseBezier, parseDurationMs, parseDurationSeconds } from "./motion.ts";

test("parseDurationMs handles ms, s, zero, and invalid inputs", () => {
  assert.equal(parseDurationMs("90ms"), 90);
  assert.equal(parseDurationMs("160ms"), 160);
  assert.equal(parseDurationMs("0.24s"), 240);
  assert.equal(parseDurationMs("0s"), 0);
  assert.equal(parseDurationMs("0ms"), 0);
  assert.equal(parseDurationMs(" 1.2s "), 1200);
  assert.equal(parseDurationMs(""), 0);
  assert.equal(parseDurationMs("-10ms"), 0);
});

test("parseDurationSeconds converts ms and s to Framer Motion seconds", () => {
  assert.equal(parseDurationSeconds("90ms"), 0.09);
  assert.equal(parseDurationSeconds("160ms"), 0.16);
  assert.equal(parseDurationSeconds("240ms"), 0.24);
  assert.equal(parseDurationSeconds("0.16s"), 0.16);
  assert.equal(parseDurationSeconds("0s"), 0);
});

test("parseBezier extracts 4-number cubic-bezier tuples and falls back to linear", () => {
  assert.deepEqual(parseBezier("cubic-bezier(0.16, 1, 0.3, 1)"), [0.16, 1, 0.3, 1]);
  assert.deepEqual(parseBezier("cubic-bezier(0.4, 0, 0.2, 1)"), [0.4, 0, 0.2, 1]);
  assert.deepEqual(parseBezier("linear"), [0, 0, 1, 1]);
  assert.deepEqual(parseBezier(""), [0, 0, 1, 1]);
});
