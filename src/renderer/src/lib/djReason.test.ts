import assert from "node:assert/strict";
import { test } from "node:test";
import { djReasonText } from "./djReason.ts";

const fmt = { seed: (t: string) => `related to ${t}`, seeds: (n: number) => `from ${n}`, likes: (n: number) => `like ${n}`, generic: "pick" };

test("reasons name the real seed, the count, or stay neutral", () => {
  assert.equal(djReasonText({ kind: "seed", seedId: 1, seedTitle: "Song" }, fmt), "related to Song");
  assert.equal(djReasonText({ kind: "seeds", count: 3 }, fmt), "from 3");
  assert.equal(djReasonText({ kind: "likes", count: 2 }, fmt), "like 2");
  assert.equal(djReasonText({ kind: "generic" }, fmt), "pick");
});
