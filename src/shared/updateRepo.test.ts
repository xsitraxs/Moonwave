import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import { RELEASES_URL, UPDATE_REPO } from "./ipc.ts";

/**
 * The update feed is named in three places — this constant, `package.json` → build.publish (electron-builder's own
 * metadata) and the releases page the app opens. They drifted once, and the result was a build that checked one
 * repository and pointed its users at another; a constant nobody compares to the rest is how that happens again.
 */
const root = fileURLToPath(new URL("../..", import.meta.url));
const publish = () => (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { build: { publish: { owner: string; repo: string } } }).build.publish;

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

/**
 * Any link to the project this was forked from, in anything that ships or documents this project — the code under
 * src/, the server under server/, the scripts, the workflows, the readme. The first audit checked only src/ and
 * missed the standalone server's invite page, which sent people to the upstream releases for a fork build.
 *
 * The one deliberate exception is `package.json` → build.maintainer (upstream attribution in the .deb metadata, kept
 * by decision in this PR); and the iOS app is a different project (waterlilo/sc-player-ios), credited in the readme —
 * it is not this repository's release feed. Both are matched by exact text below, nothing else is allowed.
 */
const FORBIDDEN = /github\.com\/waterlilo\/sc-player(?!-ios)/g;
const ALLOWED: { file: RegExp; text: string }[] = [
  { file: /^package\.json$/, text: "waterlilo <https://github.com/waterlilo/sc-player>" },
];
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "out", "release"]);
const SCANNED_EXT = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".yml", ".yaml", ".md", ".html", ".css", ".vue", ".py", ".sh"]);

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) {
      const dot = entry.name.lastIndexOf(".");
      if (dot > 0 && SCANNED_EXT.has(entry.name.slice(dot))) yield full;
    }
  }
}

test("no link anywhere in the project sends anyone to the project this was forked from", () => {
  const files = [
    ...["src", "server", "scripts", ".github"].filter((d) => existsSync(join(root, d))).flatMap((d) => [...walk(join(root, d))]),
    ...["package.json", "README.md", "SECURITY.md", "AGENTS.md", "CLAUDE.md"].map((f) => join(root, f)).filter(existsSync),
  ];
  const offenders: string[] = [];
  for (const file of files) {
    if (file.includes(".test.")) continue; // the tests name the old project on purpose (this file is the guard)
    const rel = relative(root, file);
    const text = readFileSync(file, "utf8");
    if (!FORBIDDEN.test(text)) {
      FORBIDDEN.lastIndex = 0;
      continue;
    }
    FORBIDDEN.lastIndex = 0;
    // report the offending lines, minus the documented exceptions
    for (const line of text.split("\n")) {
      if (!FORBIDDEN.test(line)) {
        FORBIDDEN.lastIndex = 0;
        continue;
      }
      FORBIDDEN.lastIndex = 0;
      const allowed = ALLOWED.some((a) => a.file.test(rel) && line.includes(a.text));
      if (!allowed) offenders.push(`${rel}: ${line.trim().slice(0, 140)}`);
    }
  }
  assert.deepEqual(offenders, []);
});
