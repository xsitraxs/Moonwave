import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
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

test("no link in the app's own code sends anyone to the project this was forked from", () => {
  // The releases button was fixed first and four other links stayed behind — including "Report a problem", which would
  // have filed a bug for a fork in the upstream project's tracker. The check reads the sources, so it cannot pass by
  // accident of where a constant happens to live.
  const root = new URL("../../src/", import.meta.url);
  const files: string[] = [];
  const walk = (dir: URL) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const next = new URL(`${e.name}${e.isDirectory() ? "/" : ""}`, dir);
      if (e.isDirectory()) walk(next);
      // the tests name the old project on purpose (this file is the guard), the shipped code must not
      else if ((e.name.endsWith(".ts") || e.name.endsWith(".tsx")) && !e.name.includes(".test.")) files.push(next.pathname);
    }
  };
  walk(root);
  const offenders = files.filter((f) => readFileSync(f, "utf8").includes("github.com/waterlilo"));
  assert.deepEqual(offenders, []);
});
