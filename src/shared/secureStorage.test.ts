import assert from "node:assert/strict";
import { test } from "node:test";
import { SECRETS_DISABLED_SUFFIX, looksLikeSecretsFile, planForBackend, scPartitionFor, storageBackendForPlatform } from "./secureStorage.ts";

// ---- when nothing may be written at rest ----------------------------------------------------------------------

test("storage: basic_text (no keyring on this desktop) is ephemeral — the file is the only barrier there", () => {
  assert.equal(planForBackend("basic_text", true), "ephemeral");
  // and encryption reported as unavailable is ephemeral whatever the backend says
  assert.equal(planForBackend("gnome_libsecret", false), "ephemeral");
  assert.equal(planForBackend("basic_text", false), "ephemeral");
});

test("storage: an unknown or empty backend is never trusted as sealed", () => {
  assert.equal(planForBackend("", true), "ephemeral");
});

test("storage: the real sealed backends stay system", () => {
  assert.equal(planForBackend("keychain", true), "system");
  assert.equal(planForBackend("dpapi", true), "system");
  assert.equal(planForBackend("gnome_libsecret", true), "system");
  assert.equal(planForBackend("kwallet6", true), "system");
});

test("storage: Windows and macOS never call Linux-only getSelectedStorageBackend (undefined there in Electron)", () => {
  const mustNotRun = (): string => {
    throw new TypeError("safeStorage.getSelectedStorageBackend is not a function");
  };
  assert.equal(storageBackendForPlatform("win32", undefined), "dpapi");
  assert.equal(storageBackendForPlatform("win32", mustNotRun), "dpapi");
  assert.equal(storageBackendForPlatform("darwin", undefined), "keychain");
  assert.equal(storageBackendForPlatform("darwin", mustNotRun), "keychain");
  assert.equal(storageBackendForPlatform("linux", () => "gnome_libsecret"), "gnome_libsecret");
  assert.equal(storageBackendForPlatform("linux", () => "basic_text"), "basic_text");
  assert.equal(storageBackendForPlatform("linux", undefined), "");
});

// ---- the SoundCloud session matches the storage plan -----------------------------------------------------------

test("session: persistent cookies only when secrets may persist — a token in memory is not resurrected from disk", () => {
  assert.equal(scPartitionFor("system"), "persist:soundcloud");
  assert.equal(scPartitionFor("ephemeral"), "soundcloud-ephemeral");
  assert.ok(!scPartitionFor("ephemeral").startsWith("persist:"));
});

// ---- an old secrets.bin left behind by a less careful build ----------------------------------------------------

test("quarantine: a file this app could have written is recognized", () => {
  assert.equal(looksLikeSecretsFile({ sessionToken: "c2VhbGVk" }), true);
  assert.equal(looksLikeSecretsFile({ sessionToken: "c2VhbGVk", "sessionToken~old": ["b2xk", "d3JvbiBvbmNl"] }), true);
  assert.equal(looksLikeSecretsFile({}), true); // empty but our shape (all values valid, vacuously)
});

test("quarantine: anything that is not ours is rejected and left alone", () => {
  assert.equal(looksLikeSecretsFile(null), false);
  assert.equal(looksLikeSecretsFile("secrets"), false);
  assert.equal(looksLikeSecretsFile(["sessionToken"]), false);
  assert.equal(looksLikeSecretsFile({ "weird key with spaces": "c2VhbGVk" }), false);
  assert.equal(looksLikeSecretsFile({ sessionToken: "not base64 at all!!!" }), false);
  assert.equal(looksLikeSecretsFile({ sessionToken: 42 }), false);
  assert.equal(looksLikeSecretsFile({ sessionToken: { nested: true } }), false);
  // someone else's file that merely parses as JSON object
  assert.equal(looksLikeSecretsFile({ username: "bob", theme: "dark" }), false);
  assert.equal(looksLikeSecretsFile({ "sessionToken~old~old": ["eA=="] }), false);
});

test("quarantine: the suffix names the file next to the original, it is never a new location", () => {
  assert.equal(SECRETS_DISABLED_SUFFIX, ".disabled");
});
