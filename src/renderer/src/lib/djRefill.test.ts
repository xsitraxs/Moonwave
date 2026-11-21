import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDjExclude, chainSeedId, decideDjNext, feedbackArtists, type DjSessionView } from "./djRefill.ts";

// queue: [manual, seed, dj×6, manual-tail]; index points at the seed
const SEED = 100;
const DJ = [201, 202, 203, 204, 205, 206];
const queueIds = [50, SEED, ...DJ, 300];
const session = (over: Partial<DjSessionView> = {}): DjSessionView => ({ seedId: SEED, appendedIds: DJ, busy: false, failures: 0, ...over });

test("plenty of suggestions: wait", () => {
  assert.deepEqual(decideDjNext({ queueIds, index: 1 }, session()), { action: "wait" });
});

test("tail below five: refill", () => {
  assert.deepEqual(decideDjNext({ queueIds, index: 3 }, session()), { action: "refill" });
});

test("no unplayed suggestions while the seed is around: stop (cleared)", () => {
  // the person removed every suggestion (clearUpcoming, one-by-one)
  assert.deepEqual(decideDjNext({ queueIds: [50, SEED], index: 1 }, session()), { action: "stop", reason: "cleared" });
});

test("the seed left the queue: stop (context)", () => {
  // another list started, or a room took the player
  assert.deepEqual(decideDjNext({ queueIds: [1, 2, 3], index: 0 }, session()), { action: "stop", reason: "context" });
});

test("jumping back to an older track idles the session", () => {
  assert.deepEqual(decideDjNext({ queueIds, index: 0 }, session()), { action: "wait" });
});

test("a flight in progress, or repeated failures: wait", () => {
  assert.deepEqual(decideDjNext({ queueIds, index: 3 }, session({ busy: true })), { action: "wait" });
  assert.deepEqual(decideDjNext({ queueIds, index: 3 }, session({ failures: 2 })), { action: "wait" });
  assert.deepEqual(decideDjNext({ queueIds, index: 3 }, session({ failures: 1 })), { action: "refill" });
});

test("exclude list dedupes", () => {
  assert.deepEqual(buildDjExclude([[1, 2], [2, 3], [], [1]]), [1, 2, 3]);
});

test("votes become artist ratings, unknown artists drop out", () => {
  const artistOf = (id: number) => ({ 201: 11, 202: 11, 203: 12 })[id as 201 | 202 | 203];
  assert.deepEqual(feedbackArtists({ 201: "more", 202: "more", 203: "less", 999: "more" }, artistOf), { moreArtists: [11], lessArtists: [12] });
});

test("chaining goes from the newest surviving suggestion", () => {
  assert.equal(chainSeedId([201, 202, 203], SEED), 203);
  assert.equal(chainSeedId([], SEED), SEED);
});
