import assert from "node:assert/strict";
import { test } from "node:test";
import { djReasonText } from "./djReason.ts";

const fmt = {
  seed: (t: string) => `related to ${t}`,
  seeds: (n: number) => `from ${n}`,
  likes: (n: number) => `like ${n}`,
  artist: (n: number, name: string, via: string) => `artist ${n} ${name} ${via}`,
  playlist: (n: number, title: string) => `playlist ${n} ${title}`,
  genre: (n: number, name: string) => `genre ${n} ${name}`,
  mood: (n: number, name: string) => `mood ${n} ${name}`,
  generic: "pick",
};

test("reasons name the real seed, the count, or stay neutral", () => {
  assert.equal(djReasonText({ kind: "seed", seedId: 1, seedTitle: "Song" }, fmt), "related to Song");
  assert.equal(djReasonText({ kind: "seeds", count: 3 }, fmt), "from 3");
  assert.equal(djReasonText({ kind: "likes", count: 2 }, fmt), "like 2");
  assert.equal(djReasonText({ kind: "artist", count: 2, name: "X", via: "tracks" }, fmt), "artist 2 X tracks");
  assert.equal(djReasonText({ kind: "playlist", count: 1, title: "Y" }, fmt), "playlist 1 Y");
  assert.equal(djReasonText({ kind: "genre", count: 2, name: "Phonk" }, fmt), "genre 2 Phonk");
  assert.equal(djReasonText({ kind: "mood", count: 2, name: "Night" }, fmt), "mood 2 Night");
  assert.equal(djReasonText({ kind: "generic" }, fmt), "pick");
});
