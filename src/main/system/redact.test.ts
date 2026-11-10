import assert from "node:assert/strict";
import { test } from "node:test";
import { redact } from "./redact.ts";

test("query strings and fragments are dropped, the address stays", () => {
  assert.equal(
    redact("page didn't load: ERR_FAILED (-2) https://api-v2.soundcloud.com/search?q=my%20ex&client_id=abc#x"),
    "page didn't load: ERR_FAILED (-2) https://api-v2.soundcloud.com/search?…",
  );
  assert.equal(redact("permissions: sc refused media for https://soundcloud.com/you/sets/x"), "permissions: sc refused media for https://soundcloud.com/you/sets/x");
  assert.equal(redact("open moonwave://signin?code=12345#state"), "open moonwave://signin?…");
});

test("tokens, sign-in headers, friend codes and emails are blanked", () => {
  assert.equal(redact("authorization: OAuth 2-294817-112233-AbCdEfGhIj failed"), "authorization: OAuth … failed");
  assert.equal(redact("Bearer abc.def"), "Bearer …");
  assert.equal(redact("client id a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6 rejected"), "client id … rejected");
  assert.equal(redact("403 not friends with SKY-7KQ2M"), "403 not friends with SKY-…");
  assert.equal(redact("signed in as anna.k+sc@example.co.uk"), "signed in as …@…");
});

test("ordinary words, long numbers and short ids stay readable", () => {
  const line = "at SoundCloudWebSessionProvider.fetchStreamUrl (track 1987654321098) lyrics-sync loaded whisper-base with electron@44.4.1";
  assert.equal(redact(line), line);
});

test("the home folder becomes ~ (both slashes, any case on Windows)", () => {
  assert.equal(redact("ENOENT: open '/home/anna/Music/x.flac'", "/home/anna"), "ENOENT: open '~/Music/x.flac'");
  assert.equal(
    redact("at file:///C:/Users/Anna/AppData/x.js and c:\\users\\anna\\Music\\y.mp3", "C:\\Users\\Anna"),
    "at file:///~/AppData/x.js and ~\\Music\\y.mp3",
  );
  assert.equal(redact("nothing to do", ""), "nothing to do");
});
