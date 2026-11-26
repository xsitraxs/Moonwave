import assert from "node:assert/strict";
import { test } from "node:test";
import { BackupError, backupId, backupWriteToken, cleanKey, newBackupKey, openBackup, sealBackup } from "./backup-crypto.ts";

/** The copy a real one holds, at its plainest. */
const payload = {
  app: "Moonwave",
  kind: "backup",
  version: 1,
  at: 1730000000000,
  likes: { liked: [{ id: 42, at: 1720000000000 }], hidden: [] },
  playlists: '{"playlists":[]}',
  ownLyrics: {},
  friend: null,
};

const KEY = "ABCD-EFGH-JKMN-PQRS-TVWX-YZ23-4567-89AB";

test("a sealed copy opens with its key, and only with its key", () => {
  const sealed = sealBackup(KEY, payload);
  assert.equal(sealed.subarray(0, 4).toString(), "SCB1");
  assert.deepEqual(openBackup(KEY, sealed), payload);

  // dashes, spaces and lower case are as typed: the letters are what count
  assert.deepEqual(openBackup("abcd efgh jkmn pqrs tvwx yz23 4567 89ab", sealed), payload);

  const wrong = "ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ";
  assert.throws(
    () => openBackup(wrong, sealed),
    (e: unknown) => e instanceof BackupError && /doesn't open/.test(e.message),
  );
});

test("a changed ciphertext or auth tag is refused, not read as something else", () => {
  const sealed = sealBackup(KEY, payload);
  const body = Buffer.from(sealed);
  body[20] = body[20]! ^ 0x01; // one byte of the ciphertext
  assert.throws(
    () => openBackup(KEY, body),
    (e: unknown) => e instanceof BackupError && /doesn't open/.test(e.message),
  );

  const tag = Buffer.from(sealed);
  tag[tag.length - 1] = tag[tag.length - 1]! ^ 0x01; // the last byte of the GCM tag
  assert.throws(() => openBackup(KEY, tag));

  const cut = sealed.subarray(0, sealed.length - 4);
  assert.throws(() => openBackup(KEY, cut), "a cut copy is not a copy");
});

test("something that isn't a Moonwave backup says so, whatever the key", () => {
  for (const text of ["", "hello", '{"app":"Moonwave"}', "SCB2 and then some", Buffer.alloc(64).toString()]) {
    const bytes = Buffer.from(text);
    assert.throws(
      () => openBackup(KEY, bytes),
      (e: unknown) => e instanceof BackupError && /isn't a Moonwave backup/.test(e.message),
      JSON.stringify(text),
    );
  }
});

// Made by the version before the crypto was moved into this module: the bytes are base64 of a real seal() call. If this
// fails, the format changed and copies people already have on the server no longer open.
const OLD_COPY =
  "U0NCMfhSn2lPoroz6UmTXkVyQ4hdbnuA8KYNyjenrheOQwmsXTmoIuDPyJ8NfOWh1u3fQZEQttLqK608VR9qAiOsLncu9GJS7VsGTlcJI2K7TzsGBRUPLo5VVhSPhEqDO52SK8EEtoZVivhOsygYnfF6cDZ5EzchKqm3tj+KFpgD+1EnqyVdulyvxq4C8u0yT1ozkMFfMNG22nUeis4/Ic1WaIqQldSwuK9tu0Lla76hVieCXWwjJZBn4i0WVhYtXAGHTCffzYF6N5d4U/6Wov9NcgDA7saiUH1NUA==";

test("a copy made before this refactor still opens, and names the same server rows", () => {
  assert.deepEqual(openBackup(KEY, Buffer.from(OLD_COPY, "base64")), payload);
  // the id names the row and the write token guards it: both come from the key, unchanged by the move
  assert.equal(backupId(KEY), "49a8987cf2777ac437860c8e388389ee48c582f17f86677a9929ba01b6cf5020");
  assert.equal(backupWriteToken(KEY), "7b60d6c2222003fcfd08318e16dacd37fc8906a3a7933857b2d4bd00a87040e4");
});

test("a made key is 32 Crockford letters in eight groups, and no two are alike", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 50; i++) {
    const key = newBackupKey();
    assert.match(key, /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){7}$/, key);
    assert.equal(cleanKey(key).length, 32);
    assert.doesNotMatch(key, /[ILOU]/, "the letters that read as 1, 0 and each other stay out");
    seen.add(key);
  }
  assert.equal(seen.size, 50);
  assert.equal(backupId("X".repeat(32)).length, 64);
  assert.notEqual(backupId(KEY), backupWriteToken(KEY));
});
