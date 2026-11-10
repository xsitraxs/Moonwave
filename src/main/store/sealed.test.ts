import assert from "node:assert/strict";
import { test } from "node:test";
import { dropOrphans, forgetAll, keepOld, KEEP_OLD, olds, type Sealed } from "./sealed.ts";

test("a replaced account value is kept, newest first, at most KEEP_OLD of them", () => {
  const all: Sealed = {};
  for (let n = 1; n <= KEEP_OLD + 2; n++) keepOld(all, "sessionToken", `v${n}`);
  assert.deepEqual(olds(all, "sessionToken"), ["v6", "v5", "v4", "v3"]);
  keepOld(all, "sessionToken", "v4");
  assert.deepEqual(olds(all, "sessionToken"), ["v4", "v6", "v5", "v3"], "kept once, moved to the front");
});

test("signing out forgets the value and every earlier copy, and nothing else", () => {
  const all: Sealed = { sessionToken: "now", "sessionToken~old": ["a", "b"], socialSecret: "s", "socialSecret~old": ["c"] };
  assert.equal(forgetAll(all, "sessionToken"), true);
  assert.deepEqual(all, { socialSecret: "s", "socialSecret~old": ["c"] });
  // only the old copies left (the value was removed earlier, the way 2.5.0 signed out): they go too
  const before: Sealed = { "sessionToken~old": ["a"] };
  assert.equal(forgetAll(before, "sessionToken"), true);
  assert.deepEqual(before, {});
  assert.equal(forgetAll({}, "sessionToken"), false);
});

test("a malformed ~old entry reads as no earlier values", () => {
  assert.deepEqual(olds({ "sessionToken~old": "not a list" }, "sessionToken"), []);
  assert.deepEqual(olds({ "sessionToken~old": ["ok", "", 5 as unknown as string] }, "sessionToken"), ["ok"]);
});

test("copies left behind by an earlier sign-out are dropped; copies next to a current value stay", () => {
  const all: Sealed = { "sessionToken~old": ["signed-out"], socialSecret: "s", "socialSecret~old": ["older"], backupKey: "k" };
  assert.equal(dropOrphans(all, ["sessionToken", "socialSecret", "backupKey"]), true);
  assert.deepEqual(all, { socialSecret: "s", "socialSecret~old": ["older"], backupKey: "k" });
  assert.equal(dropOrphans(all, ["sessionToken", "socialSecret", "backupKey"]), false, "nothing more to do");
});
