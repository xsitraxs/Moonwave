import assert from "node:assert/strict";
import { test } from "node:test";
import type { DjSeed } from "./djRank.ts";
import { buildDjExclude, buildRoundSeeds, chainSeedId, decideDjNext, feedbackArtists, isRoundFailed, type DjQueueView, type DjSessionView } from "./djRefill.ts";

// queue: [manual, seed, dj×6, manual-tail]; index points at the seed; the session started on generation 7
const SEED = 100;
const DJ = [201, 202, 203, 204, 205, 206];
const GEN = 7;
const queueIds = [50, SEED, ...DJ, 300];
const view = (over: Partial<DjQueueView> = {}): DjQueueView => ({ queueIds, index: 1, queueGen: GEN, ...over });
const session = (over: Partial<DjSessionView> = {}): DjSessionView => ({ expectedGen: GEN, appendedIds: DJ, busy: false, failures: 0, ...over });

test("plenty of suggestions: wait", () => {
  assert.deepEqual(decideDjNext(view(), session()), { action: "wait" });
});

test("tail below five: refill", () => {
  assert.deepEqual(decideDjNext(view({ index: 3 }), session()), { action: "refill" });
});

test("no unplayed suggestions on the session's queue: stop (cleared)", () => {
  // the person removed every suggestion (clearUpcoming, one-by-one)
  assert.deepEqual(decideDjNext(view({ queueIds: [50, SEED], index: 1 }), session()), { action: "stop", reason: "cleared" });
});

test("the queue turned over: stop (context)", () => {
  // another list started, or a room took the player
  assert.deepEqual(decideDjNext(view({ queueIds: [1, 2, 3], index: 0, queueGen: GEN + 1 }), session()), { action: "stop", reason: "context" });
});

test("a new generation stops the session even with the seed still queued", () => {
  assert.deepEqual(decideDjNext(view({ queueGen: GEN + 1 }), session()), { action: "stop", reason: "context" });
});

test("the seed leaving alone no longer stops anything", () => {
  // the seed was removed by hand, but the queue is the session's own: it carries on
  const noSeed = [50, ...DJ, 300];
  assert.deepEqual(decideDjNext(view({ queueIds: noSeed, index: 0 }), session()), { action: "wait" });
  assert.deepEqual(decideDjNext(view({ queueIds: noSeed, index: 4 }), session()), { action: "refill" });
});

test("jumping back to an older track idles the session", () => {
  assert.deepEqual(decideDjNext(view({ index: 0 }), session()), { action: "wait" });
});

test("a flight in progress, or repeated failures: wait", () => {
  assert.deepEqual(decideDjNext(view({ index: 3 }), session({ busy: true })), { action: "wait" });
  assert.deepEqual(decideDjNext(view({ index: 3 }), session({ failures: 2 })), { action: "wait" });
  assert.deepEqual(decideDjNext(view({ index: 3 }), session({ failures: 1 })), { action: "refill" });
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

test("a round fails only when every seed failed", () => {
  assert.equal(isRoundFailed([], [1, 2]), false);
  assert.equal(isRoundFailed([1], [1, 2]), false);
  assert.equal(isRoundFailed([1, 2], [1, 2]), true);
  // a lone seed behaves as before
  assert.equal(isRoundFailed([1], [1]), true);
  assert.equal(isRoundFailed([], [1]), false);
  // nothing to rank is empty, not failed
  assert.equal(isRoundFailed([], []), false);
  // failures outside the round don't count
  assert.equal(isRoundFailed([9], [1]), false);
});

const titleOf = (id: number) => `T${id}`;

test("round seeds: chain first, then thumbs-up, then origins", () => {
  const origin: DjSeed[] = [
    { id: 1, title: "One" },
    { id: 2, title: "Two" },
  ];
  assert.deepEqual(buildRoundSeeds(origin, [11, 12], 9, titleOf), [
    { id: 9, title: "T9" },
    { id: 11, title: "T11" },
    { id: 12, title: "T12" },
    { id: 1, title: "T1" },
    { id: 2, title: "T2" },
  ]);
});

test("round seeds dedupe: chain wins over a vote over an origin", () => {
  assert.deepEqual(
    buildRoundSeeds([{ id: 1, title: "One" }], [1, 11], 1, titleOf).map((s) => s.id),
    [1, 11],
  );
});

test("round seeds keep two thumbs-up and cap the pool, oldest origins drop first", () => {
  const big: DjSeed[] = [1, 2, 3, 4, 5, 6, 7, 8].map((id) => ({ id, title: `T${id}` }));
  // chain + 2 votes + 5 origins = 8 (DJ_ROUND_SEEDS); origins 6, 7, 8 drop
  assert.deepEqual(buildRoundSeeds(big, [11, 12, 13], 9, titleOf).map((s) => s.id), [9, 11, 12, 1, 2, 3, 4, 5]);
});

test("round seeds without a chain are just votes and origins", () => {
  assert.deepEqual(buildRoundSeeds([{ id: 1, title: "One" }], [11], null, () => null), [
    { id: 11, title: null },
    { id: 1, title: null },
  ]);
});
