import assert from "node:assert/strict";
import { test } from "node:test";
import { updateTrackProgress } from "./track-progress.ts";

test("stores unfinished positions and removes started or completed tracks", () => {
  const saved = updateTrackProgress({}, 42, 35.8, 120);
  assert.deepEqual(saved, { "t:42": 35 });
  assert.deepEqual(updateTrackProgress(saved, 42, 119, 120), {});
  assert.deepEqual(updateTrackProgress(saved, 42, 0, 120), {});
  assert.deepEqual(updateTrackProgress(saved, 42, NaN, 120), {});
});

test("keeps at most the 100 most recently updated tracks", () => {
  let saved: Record<string, number> = {};
  for (let i = 0; i < 100; i++) saved = updateTrackProgress(saved, i, 10, 100);
  saved = updateTrackProgress(saved, 0, 20, 100);
  saved = updateTrackProgress(saved, 100, 10, 100);
  assert.equal(Object.keys(saved).length, 100);
  assert.equal(saved["t:0"], 20);
  assert.equal(saved["t:1"], undefined);
});
