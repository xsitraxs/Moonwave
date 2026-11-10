import assert from "node:assert/strict";
import { test } from "node:test";
import { skipOnCopy } from "./dataMove.ts";

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
