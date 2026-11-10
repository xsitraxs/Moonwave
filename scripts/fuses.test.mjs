import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { electronBinaryIn, FUSES, fuseWireMatches } from "./fuses.mjs";

test("the fuses match what the task asks for: no Node mode, no NODE_OPTIONS, no inspector, integrity on, asar only", () => {
  // FuseV1Options: RunAsNode 0, EnableNodeOptionsEnvironmentVariable 2, EnableNodeCliInspectArguments 3,
  // EnableEmbeddedAsarIntegrityValidation 4, OnlyLoadAppFromAsar 5
  assert.equal(FUSES[0], false);
  assert.equal(FUSES[2], false);
  assert.equal(FUSES[3], false);
  assert.equal(FUSES[4], true);
  assert.equal(FUSES[5], true);
  // the cookie-encryption fuse is a one-way door for existing installs: not touched here
  assert.equal(1 in FUSES, false);
});

test("the packed executable is found where each platform puts it", () => {
  const names = { productFilename: "Moonwave", executableName: "moonwave", platform: "linux" };
  assert.equal(electronBinaryIn("/out/mac-arm64", { ...names, platform: "darwin" }), join("/out/mac-arm64", "Moonwave.app"));
  assert.equal(electronBinaryIn("/out/win-unpacked", { ...names, platform: "win32" }), join("/out/win-unpacked", "Moonwave.exe"));
  // Linux: build.linux.executableName, not the product name with its space
  assert.equal(electronBinaryIn("/out/linux-unpacked", names), join("/out/linux-unpacked", "moonwave"));
});

test("a wire is only accepted when every fuse has its expected state", () => {
  // 49 = on, 48 = off, as @electron/fuses reports them
  const wire = { 0: 48, 2: 48, 3: 48, 4: 49, 5: 49 };
  assert.equal(fuseWireMatches(wire, FUSES), true);
  assert.equal(fuseWireMatches({ ...wire, 0: 49 }, FUSES), false, "RunAsNode left on");
  assert.equal(fuseWireMatches({ ...wire, 4: 48 }, FUSES), false, "asar integrity left off");
  assert.equal(fuseWireMatches({ ...wire, 5: undefined }, FUSES), false, "ascii-only fuse missing");
});

test("electron-builder's afterPack hook is wired to this file, and the hook reads the fuses back", () => {
  const { build } = JSON.parse(readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8"));
  assert.equal(build.afterPack, "scripts/fuses.mjs");
  const source = readFileSync(join(import.meta.dirname, "fuses.mjs"), "utf8");
  assert.match(source, /getCurrentFuseWire\(binary\)/);
  // a failure has to stop the build, not be printed and forgotten
  assert.match(source, /throw new Error\(`fuses:/);
});
