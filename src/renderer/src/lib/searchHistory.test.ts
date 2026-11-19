import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeSearchHistory, removeFromSearchHistory } from "./searchHistory.ts";

test("mergeSearchHistory skips short queries and SoundCloud links", () => {
  assert.equal(mergeSearchHistory(["rock"], ""), null);
  assert.equal(mergeSearchHistory(["rock"], " "), null);
  assert.equal(mergeSearchHistory(["rock"], "a"), null);
  assert.equal(mergeSearchHistory(["rock"], "https://soundcloud.com/artist/track"), null);
  assert.equal(mergeSearchHistory(["rock"], "soundcloud.com/artist"), null);
});

test("mergeSearchHistory promotes case-insensitive matches without duplicates", () => {
  assert.deepEqual(mergeSearchHistory(["ambient", "rock", "lofi"], "Rock"), ["Rock", "ambient", "lofi"]);
  assert.equal(mergeSearchHistory(["ambient", "rock"], "ambient"), null);
  assert.deepEqual(mergeSearchHistory(["aa", "bb", "cc"], "dd", 3), ["dd", "aa", "bb"]);
});

test("removeFromSearchHistory removes only the targeted entry", () => {
  assert.deepEqual(removeFromSearchHistory(["ambient", "rock", "lofi"], "rock"), ["ambient", "lofi"]);
});
