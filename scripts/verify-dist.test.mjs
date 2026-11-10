import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { createPackage, getRawHeader } from "@electron/asar";
import { flipFuses, FuseVersion } from "@electron/fuses";
import { FUSES } from "./fuses.mjs";
import { fusesTarget, parseLatestYml, unpackedApp, unpackedApps, verifyDist, verifyFuses } from "./verify-dist.mjs";

const require = createRequire(import.meta.url);
const plist = require("plist");
const resedit = require("resedit");

/** Writes the same INTEGRITY/ELECTRONASAR PE resource entry that electron-builder embeds in a Windows build. */
function writePeAsarIntegrity(exeBytes, hash) {
  const exe = resedit.NtExecutable.from(exeBytes);
  const res = resedit.NtExecutableResource.from(exe);
  const payload = Buffer.from(JSON.stringify([{ file: "resources\\app.asar", alg: "SHA256", value: hash }]), "utf8");
  res.entries.push({ type: "INTEGRITY", id: "ELECTRONASAR", bin: payload, lang: 1033, codepage: 1200 });
  res.outputResource(exe);
  return Buffer.from(exe.generate());
}

const SENTINEL = "dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX";

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
  file("sc-player-2.3.2-arm64.zip.blockmap");
  file("sc-player-2.3.2-x64.zip");
  file("sc-player-2.3.2-x64.zip.blockmap");
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

/** Builds a small real app.asar with @electron/asar and returns its raw header sha256. */
async function writeSampleAsar(asarPath) {
  const src = mkdtempSync(join(tmpdir(), "asar-src-"));
  cleanup.push(src);
  writeFileSync(join(src, "index.js"), "console.log('ok');\n");
  mkdirSync(join(asarPath, ".."), { recursive: true });
  await createPackage(src, asarPath);
  return createHash("sha256").update(getRawHeader(asarPath).headerString).digest("hex");
}

/** A raw fuse-wire carrier binary that @electron/fuses can flip and read. */
function writeFuseCarrier(filePath) {
  const wire = Buffer.concat([Buffer.from(SENTINEL), Buffer.from([1, 9, 49, 48, 49, 49, 48, 48, 48, 49, 49])]);
  mkdirSync(join(filePath, ".."), { recursive: true });
  writeFileSync(filePath, Buffer.concat([Buffer.alloc(256), wire, Buffer.alloc(256)]));
}

test("latest.yml parses: version, the files list, sizes and optional blockMapSize", () => {
  const text = [
    "version: 2.3.2",
    "files:",
    "  - url: sc-player-setup-v2.3.2.exe",
    "    sha512: AAA",
    "    size: 12345",
    "    blockMapSize: 321",
    "  - url: other.exe",
    "    size: 67",
    "path: sc-player-setup-v2.3.2.exe",
    "sha512: AAA",
    "",
  ].join("\n");
  const yml = parseLatestYml(text);
  assert.equal(yml.version, "2.3.2");
  assert.equal(yml.path, "sc-player-setup-v2.3.2.exe");
  assert.deepEqual(yml.files, [
    { url: "sc-player-setup-v2.3.2.exe", size: 12345, blockMapSize: 321 },
    { url: "other.exe", size: 67, blockMapSize: null },
  ]);
});

test("windows: a complete build passes; missing NSIS blockmap fails", () => {
  const { dir, writeYml, yml } = fakeDist();
  writeYml("latest.yml", yml(undefined, [["sc-player-setup-v2.3.exe", 4096]]));
  assert.deepEqual(verifyDist({ dir, platform: "win32", expectVersion: "2.3.2" }), []);

  unlinkSync(join(dir, "sc-player-setup-v2.3.exe.blockmap"));
  const problems = verifyDist({ dir, platform: "win32", expectVersion: "2.3.2" });
  assert.ok(problems.some((p) => /missing blockmap sc-player-setup-v2\.3\.exe\.blockmap/.test(p)));
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

test("macOS: a complete build passes; zip or zip.blockmap missing fails", () => {
  const { dir, writeYml, yml } = fakeDist();
  writeYml("latest-mac.yml", yml(undefined, [["sc-player-2.3.2-arm64.zip", 4096]]));
  assert.deepEqual(verifyDist({ dir, platform: "darwin", expectVersion: "2.3.2" }), []);

  unlinkSync(join(dir, "sc-player-2.3.2-arm64.zip.blockmap"));
  const noBlockmap = verifyDist({ dir, platform: "darwin", expectVersion: "2.3.2" });
  assert.ok(noBlockmap.some((p) => /missing blockmap sc-player-2\.3\.2-arm64\.zip\.blockmap/.test(p)));

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

// ---- fuses & ASAR integrity -----------------------------------------------------------------------------------------

test("fuses: a dist/ with only installers left has no unpacked app to read, and that is not a problem", async () => {
  const { dir } = fakeDist();
  assert.equal(unpackedApp(dir, "linux"), null);
  assert.equal(unpackedApp(dir, "win32"), null);
  assert.deepEqual(await verifyFuses({ dir, platform: "linux" }), []);
});

test("fuses: every unpacked app is found, including both mac (x64) and mac-arm64 on macOS", () => {
  const { dir } = fakeDist();
  mkdirSync(join(dir, "linux-unpacked"));
  mkdirSync(join(dir, "win-unpacked"));
  mkdirSync(join(dir, "mac", "sc player.app"), { recursive: true });
  mkdirSync(join(dir, "mac-arm64", "sc player.app"), { recursive: true });
  writeFileSync(join(dir, "linux-unpacked", "sc-player"), "x");
  writeFileSync(join(dir, "win-unpacked", "sc player.exe"), "x");
  assert.equal(unpackedApp(dir, "linux"), join(dir, "linux-unpacked"));
  assert.equal(unpackedApp(dir, "win32"), join(dir, "win-unpacked"));
  assert.deepEqual(unpackedApps(dir, "darwin"), [
    join(dir, "mac", "sc player.app"),
    join(dir, "mac-arm64", "sc player.app"),
  ]);
  assert.equal(fusesTarget(join(dir, "linux-unpacked"), "linux"), join(dir, "linux-unpacked", "sc-player"));
  assert.equal(fusesTarget(join(dir, "win-unpacked"), "win32"), join(dir, "win-unpacked", "sc player.exe"));
});

test("fuses: an app whose binary has no fuse wire fails, and says the hook did not run", async () => {
  const { dir } = fakeDist();
  mkdirSync(join(dir, "linux-unpacked"));
  writeFileSync(join(dir, "linux-unpacked", "sc-player"), "not an electron binary");
  const problems = await verifyFuses({ dir, platform: "linux" });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /fuses\.mjs did not run/);
});

test("fuses + ASAR integrity (macOS): checks both mac and mac-arm64 Info.plist hashes against app.asar", async () => {
  const { dir } = fakeDist();
  for (const folder of ["mac", "mac-arm64"]) {
    const appDir = join(dir, folder, "sc player.app");
    const fw = join(appDir, "Contents", "Frameworks", "Electron Framework.framework", "Electron Framework");
    writeFuseCarrier(fw);
    await flipFuses(appDir, { version: FuseVersion.V1, ...FUSES, resetAdHocDarwinSignature: false });
    const hash = await writeSampleAsar(join(appDir, "Contents", "Resources", "app.asar"));
    writeFileSync(
      join(appDir, "Contents", "Info.plist"),
      plist.build({ ElectronAsarIntegrity: { "Resources/app.asar": { algorithm: "SHA256", hash } } }),
    );
  }
  assert.deepEqual(await verifyFuses({ dir, platform: "darwin", checkCodesign: false }), []);

  // Tamper only mac-arm64's Info.plist hash: verifyFuses must catch the second bundle too
  writeFileSync(
    join(dir, "mac-arm64", "sc player.app", "Contents", "Info.plist"),
    plist.build({ ElectronAsarIntegrity: { "Resources/app.asar": { algorithm: "SHA256", hash: "0".repeat(64) } } }),
  );
  const bad = await verifyFuses({ dir, platform: "darwin", checkCodesign: false });
  assert.equal(bad.length, 1);
  assert.match(bad[0], /mac-arm64.*ElectronAsarIntegrity hash/);
});

test("fuses + ASAR integrity (Windows): checks the INTEGRITY/ELECTRONASAR PE resource against app.asar", async () => {
  const { dir } = fakeDist();
  const unpacked = join(dir, "win-unpacked");
  mkdirSync(unpacked, { recursive: true });
  const exePath = join(unpacked, "sc player.exe");
  const exe0 = resedit.NtExecutable.from(readFileSync("node_modules/electron-winstaller/vendor/rcedit.exe"));
  const rdata = exe0.getAllSections().find((s) => s.info.name.startsWith(".rdata"));
  const wire = Buffer.concat([Buffer.from(SENTINEL), Buffer.from([1, 9, 49, 48, 49, 49, 48, 48, 48, 49, 49])]);
  const data = Buffer.from(rdata.data);
  wire.copy(data, data.length - wire.length - 64);
  rdata.data = data;
  const baseExe = Buffer.from(exe0.generate());
  const hash = await writeSampleAsar(join(unpacked, "resources", "app.asar"));
  writeFileSync(exePath, writePeAsarIntegrity(baseExe, hash));
  await flipFuses(exePath, { version: FuseVersion.V1, ...FUSES });

  assert.deepEqual(await verifyFuses({ dir, platform: "win32" }), []);

  // Overwrite with a wrong hash: verifyFuses must catch the mismatch
  writeFileSync(exePath, writePeAsarIntegrity(baseExe, "f".repeat(64)));
  await flipFuses(exePath, { version: FuseVersion.V1, ...FUSES });
  const bad = await verifyFuses({ dir, platform: "win32" });
  assert.equal(bad.length, 1);
  assert.match(bad[0], /INTEGRITY hash/);
});
