import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bringOverOldData, skipOnCopy } from "./data-move.ts";

test("the library and settings come over on every platform", () => {
  for (const platform of ["win32", "darwin", "linux"]) {
    for (const p of ["settings.json", "local-playlists.json", "local-likes.json", "lyrics-own.json", "backgrounds/bg-1.mp4", "models/whisper/model.onnx", "logs/main.log"]) {
      assert.equal(skipOnCopy(p, platform), false, `${platform} ${p}`);
    }
  }
});

test("Chromium's caches and locks stay behind wherever they are", () => {
  for (const p of ["Cache", "Code Cache/js/index", "GPUCache/data_0", "Partitions/soundcloud/Cache/x", "SingletonLock", "SingletonSocket", "Crashpad/reports"]) {
    assert.equal(skipOnCopy(p, "win32"), true, p);
  }
});

test("the sign-in comes along only on Windows, where the key is the user's and not the app's", () => {
  for (const p of ["secrets.bin", "Partitions/soundcloud/Cookies", "Local State"]) {
    assert.equal(skipOnCopy(p, "win32"), false, `win32 ${p}`);
    assert.equal(skipOnCopy(p, "darwin"), true, `darwin ${p}`);
    assert.equal(skipOnCopy(p, "linux"), true, `linux ${p}`);
  }
});

/** an "sc player" data folder as the old app leaves it, in a fresh appData */
function oldFolder() {
  const appData = mkdtempSync(join(tmpdir(), "moonwave-move-"));
  const old = join(appData, "sc player");
  const put = (rel: string, text = rel) => {
    mkdirSync(join(old, rel, ".."), { recursive: true });
    writeFileSync(join(old, rel), text);
  };
  put("settings.json", '{"renderer":{"volume":0.5}}');
  put("local-playlists.json");
  put("backgrounds/bg-1.mp4");
  put("secrets.bin");
  put("Local State");
  put("key-restart");
  put("Partitions/soundcloud/Cookies");
  put("Cache/data_0");
  put("SingletonLock");
  return { appData, old, current: join(appData, "Moonwave") };
}

test("the old folder is copied into the new one and stays as it was", () => {
  const { appData, old, current } = oldFolder();
  const lines: string[] = [];
  bringOverOldData(appData, current, "win32", (l) => lines.push(l));
  assert.equal(readFileSync(join(current, "settings.json"), "utf8"), '{"renderer":{"volume":0.5}}');
  assert.ok(existsSync(join(current, "local-playlists.json")));
  assert.ok(existsSync(join(current, "backgrounds", "bg-1.mp4")));
  // Windows: the sign-in comes along (Local State holds the key)
  assert.ok(existsSync(join(current, "secrets.bin")));
  assert.ok(existsSync(join(current, "Local State")));
  assert.ok(existsSync(join(current, "Partitions", "soundcloud", "Cookies")));
  for (const gone of ["Cache", "SingletonLock", "key-restart"]) assert.ok(!existsSync(join(current, gone)), gone);
  // copied, not moved: the original sc player still has everything
  assert.deepEqual(readdirSync(old).sort(), ["Cache", "Local State", "Partitions", "SingletonLock", "backgrounds", "key-restart", "local-playlists.json", "secrets.bin", "settings.json"]);
  assert.equal(lines.length, 1);
});

test("on macOS and Linux the secrets stay behind", () => {
  for (const platform of ["darwin", "linux"] as const) {
    const { appData, current } = oldFolder();
    bringOverOldData(appData, current, platform, () => undefined);
    assert.ok(existsSync(join(current, "settings.json")));
    for (const gone of ["secrets.bin", "Local State", "Partitions"]) assert.ok(!existsSync(join(current, gone)), `${platform} ${gone}`);
  }
});

test("nothing is copied over settings Moonwave already has", () => {
  const { appData, current } = oldFolder();
  mkdirSync(current, { recursive: true });
  writeFileSync(join(current, "settings.json"), "mine");
  bringOverOldData(appData, current, "win32", () => assert.fail("nothing to log"));
  assert.equal(readFileSync(join(current, "settings.json"), "utf8"), "mine");
  assert.ok(!existsSync(join(current, "local-playlists.json")));
});

test("no old folder: nothing happens", () => {
  const appData = mkdtempSync(join(tmpdir(), "moonwave-move-"));
  bringOverOldData(appData, join(appData, "Moonwave"), "linux", () => assert.fail("nothing to log"));
  assert.ok(!existsSync(join(appData, "Moonwave")));
});
