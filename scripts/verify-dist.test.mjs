import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { fusesTarget, parseLatestYml, unpackedApp, verifyDist, verifyFuses } from "./verify-dist.mjs";

const cleanup = [];
afterEach(() => {
  while (cleanup.length) rmSync(cleanup.pop(), { recursive: true, force: true });
});

/** a dist/ with the files electron-builder would leave; call writeYml to control the metadata */
function fakeDist({ version = "2.3.2" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "verify-dist-"));
  cleanup.push(dir);
  const file = (name, size = 4096) => writeFileSync(join(dir, name), Buffer.alloc(size, 1));
  file("sc-player-setup-v2.3.exe");
  file("sc-player-setup-v2.3.exe.blockmap");
  file("sc-player-portable-v2.3.exe");
  file("sc-player-2.3.2-arm64.dmg");
  file("sc-player-2.3.2-x64.dmg");
  file("sc-player-2.3.2-arm64.zip");
  file("sc-player-2.3.2-x64.zip");
  file("sc-player-v2.3-x86_64.AppImage");
  file("sc-player-v2.3-amd64.deb");
  const writeYml = (name, text) => writeFileSync(join(dir, name), text);
  const yml = (versionOverride, entries) =>
    [
      `version: ${versionOverride ?? version}`,
      "files:",
      ...entries.map(([url, size]) => [`  - url: ${url}`, `    sha512: abc`, `    size: ${size}`].join("\n")),
      `path: ${entries[0][0]}`,
      "sha512: abc",
      "",
    ].join("\n");
  return { dir, version, writeYml, yml };
}

test("latest.yml parses: version, the files list, sizes", () => {
  const text = ["version: 2.3.2", "files:", "  - url: sc-player-setup-v2.3.2.exe", "    sha512: AAA", "    size: 12345", "  - url: other.exe", "    size: 67", "path: sc-player-setup-v2.3.2.exe", "sha512: AAA", ""].join("\n");
  const yml = parseLatestYml(text);
  assert.equal(yml.version, "2.3.2");
  assert.equal(yml.path, "sc-player-setup-v2.3.2.exe");
  assert.deepEqual(yml.files, [
    { url: "sc-player-setup-v2.3.2.exe", size: 12345 },
    { url: "other.exe", size: 67 },
  ]);
});

test("windows: a complete build passes", () => {
  const { dir, writeYml, yml } = fakeDist();
  writeYml("latest.yml", yml(undefined, [["sc-player-setup-v2.3.exe", 4096]]));
  assert.deepEqual(verifyDist({ dir, platform: "win32", expectVersion: "2.3.2" }), []);
});

test("windows: missing latest.yml fails, and says so", () => {
  const { dir } = fakeDist();
  const problems = verifyDist({ dir, platform: "win32", expectVersion: "2.3.2" });
  assert.ok(problems.some((p) => p.includes("latest.yml is missing")));
});

test("windows: a version that does not match package.json fails", () => {
  const { dir, writeYml, yml } = fakeDist({ version: "2.3.1" });
  writeYml("latest.yml", yml(undefined, [["sc-player-setup-v2.3.exe", 4096]]));
  const problems = verifyDist({ dir, platform: "win32", expectVersion: "2.3.2" });
  assert.ok(problems.some((p) => /version 2\.3\.1 != package\.json 2\.3\.2/.test(p)));
});

test("windows: the portable exe in latest.yml fails — it can never self-update", () => {
  const { dir, writeYml, yml } = fakeDist();
  writeYml("latest.yml", yml(undefined, [
    ["sc-player-setup-v2.3.exe", 4096],
    ["sc-player-portable-v2.3.exe", 4096],
  ]));
  const problems = verifyDist({ dir, platform: "win32", expectVersion: "2.3.2" });
  assert.ok(problems.some((p) => /portable/i.test(p)));
});

test("windows: a listed file that does not exist fails; a wrong size fails", () => {
  const { dir, writeYml, yml } = fakeDist();
  writeYml("latest.yml", yml(undefined, [["sc-player-setup-v2.3.exe", 1]]));
  const problems = verifyDist({ dir, platform: "win32", expectVersion: "2.3.2" });
  assert.ok(problems.some((p) => /size 4096 != latest\.yml size 1/.test(p)));

  writeYml("latest.yml", yml(undefined, [["sc-player-setup-v9.9.exe", 1]]));
  const missing = verifyDist({ dir, platform: "win32", expectVersion: "2.3.2" });
  assert.ok(missing.some((p) => /lists sc-player-setup-v9\.9\.exe but it is not in/.test(p)));
});

test("macOS: a complete build passes; zip missing from the metadata fails", () => {
  const { dir, writeYml, yml } = fakeDist();
  writeYml("latest-mac.yml", yml(undefined, [["sc-player-2.3.2-arm64.zip", 4096]]));
  assert.deepEqual(verifyDist({ dir, platform: "darwin", expectVersion: "2.3.2" }), []);

  writeYml("latest-mac.yml", yml(undefined, [["sc-player-2.3.2-arm64.dmg", 4096]]));
  const problems = verifyDist({ dir, platform: "darwin", expectVersion: "2.3.2" });
  assert.ok(problems.some((p) => /does not list a .zip/.test(p)));
});

test("linux: a complete build passes; AppImage not listed fails", () => {
  const { dir, writeYml, yml } = fakeDist();
  writeYml("latest-linux.yml", yml(undefined, [["sc-player-v2.3-x86_64.AppImage", 4096]]));
  assert.deepEqual(verifyDist({ dir, platform: "linux", expectVersion: "2.3.2" }), []);

  writeYml("latest-linux.yml", yml(undefined, [["sc-player-v2.3-amd64.deb", 4096]]));
  const problems = verifyDist({ dir, platform: "linux", expectVersion: "2.3.2" });
  assert.ok(problems.some((p) => /does not list the AppImage/.test(p)));
});

test("a tag like v2.4 matches package.json 2.4.0", () => {
  const { dir, writeYml, yml } = fakeDist({ version: "2.4.0" });
  writeYml("latest-linux.yml", yml("2.4.0", [["sc-player-v2.3-x86_64.AppImage", 4096]]));
  assert.deepEqual(verifyDist({ dir, platform: "linux", expectVersion: "2.4" }), []);
});

// ---- fuses -----------------------------------------------------------------------------------------------------------

test("fuses: a dist/ with only installers left has no unpacked app to read, and that is not a problem", async () => {
  const { dir } = fakeDist();
  assert.equal(unpackedApp(dir, "linux"), null);
  assert.equal(unpackedApp(dir, "win32"), null);
  assert.deepEqual(await verifyFuses({ dir, platform: "linux" }), []);
});

test("fuses: the unpacked app is found in each platform's folder", () => {
  const { dir } = fakeDist();
  mkdirSync(join(dir, "linux-unpacked"));
  mkdirSync(join(dir, "win-unpacked"));
  mkdirSync(join(dir, "mac-arm64", "sc player.app"), { recursive: true });
  writeFileSync(join(dir, "linux-unpacked", "sc-player"), "x");
  writeFileSync(join(dir, "win-unpacked", "sc player.exe"), "x");
  assert.equal(unpackedApp(dir, "linux"), join(dir, "linux-unpacked"));
  assert.equal(unpackedApp(dir, "win32"), join(dir, "win-unpacked"));
  assert.equal(unpackedApp(dir, "darwin"), join(dir, "mac-arm64", "sc player.app"));
  assert.equal(fusesTarget(join(dir, "linux-unpacked"), "linux"), join(dir, "linux-unpacked", "sc-player"));
  assert.equal(fusesTarget(join(dir, "win-unpacked"), "win32"), join(dir, "win-unpacked", "sc player.exe"));
});

test("fuses: an app whose binary has no fuse wire fails, and says the hook did not run", async () => {
  const { dir } = fakeDist();
  mkdirSync(join(dir, "linux-unpacked"));
  // a file that is not an Electron binary at all
  writeFileSync(join(dir, "linux-unpacked", "sc-player"), "not an electron binary");
  const problems = await verifyFuses({ dir, platform: "linux" });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /fuses\.mjs did not run/);
});
