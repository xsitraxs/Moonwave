import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { publishedFiles, sumsFor } from "./checksums.mjs";

const cleanup = [];
afterEach(() => {
  while (cleanup.length) rmSync(cleanup.pop(), { recursive: true, force: true });
});

/** a dist/ shaped like a real packaging result, including the things a release must not list */
function fakeDist() {
  const dir = mkdtempSync(join(tmpdir(), "checksums-"));
  cleanup.push(dir);
  for (const name of [
    "sc-player-setup-v2.3.exe",
    "sc-player-setup-v2.3.exe.blockmap",
    "sc-player-2.3.2-arm64.dmg",
    "sc-player-2.3.2-arm64.zip",
    "sc-player-v2.3-x86_64.AppImage",
    "sc-player-v2.3-amd64.deb",
    "latest.yml",
    "latest-mac.yml",
    "latest-linux.yml",
  ]) {
    writeFileSync(join(dir, name), `payload of ${name}`);
  }
  // never published: the unpacked app, builder's own metadata, a log
  mkdirSync(join(dir, "linux-unpacked"));
  writeFileSync(join(dir, "builder-effective-config.yaml"), "x");
  writeFileSync(join(dir, "dist.log"), "x");
  return dir;
}

test("only the release-attached files are listed, sorted, and nothing else", () => {
  const dir = fakeDist();
  assert.deepEqual(publishedFiles(dir), [
    "latest-linux.yml",
    "latest-mac.yml",
    "latest.yml",
    "sc-player-2.3.2-arm64.dmg",
    "sc-player-2.3.2-arm64.zip",
    "sc-player-setup-v2.3.exe",
    "sc-player-setup-v2.3.exe.blockmap",
    "sc-player-v2.3-amd64.deb",
    "sc-player-v2.3-x86_64.AppImage",
  ]);
});

test("each line is the sha256 of the file, in sha256sum's `hash  name` shape", () => {
  const dir = fakeDist();
  const lines = sumsFor(dir, ["sc-player-setup-v2.3.exe"]);
  const expected = createHash("sha256").update(readFileSync(join(dir, "sc-player-setup-v2.3.exe"))).digest("hex");
  assert.deepEqual(lines, [`${expected}  sc-player-setup-v2.3.exe`]);
  assert.match(lines[0], /^[0-9a-f]{64} {2}\S/);
});

test("a missing or empty dist has nothing to sum", () => {
  assert.deepEqual(publishedFiles(join(tmpdir(), "checksums-does-not-exist-xyz")), []);
  const empty = mkdtempSync(join(tmpdir(), "checksums-empty-"));
  cleanup.push(empty);
  assert.deepEqual(publishedFiles(empty), []);
});
