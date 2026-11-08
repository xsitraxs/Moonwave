import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { RELEASES_URL, UPDATE_REPO } from "./ipc.ts";

/**
 * The update feed is named in three places — this constant, `package.json` → build.publish (electron-builder's own
 * metadata) and the releases page the app opens. They drifted once, and the result was a build that checked one
 * repository and pointed its users at another; a constant nobody compares to the rest is how that happens again.
 */
const publish = () => (JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { build: { publish: { owner: string; repo: string } } }).build.publish;

test("the update repository is the one the build publishes to", () => {
  const p = publish();
  assert.equal(UPDATE_REPO.owner, p.owner);
  assert.equal(UPDATE_REPO.repo, p.repo);
});

test("the releases button and the update feed name the same repository", () => {
  assert.equal(RELEASES_URL, `https://github.com/${UPDATE_REPO.owner}/${UPDATE_REPO.repo}/releases/latest`);
  // and not the project this one was forked from: pointing users at someone else's releases is how a fork goes stale
  assert.ok(!RELEASES_URL.includes("waterlilo"));
});
