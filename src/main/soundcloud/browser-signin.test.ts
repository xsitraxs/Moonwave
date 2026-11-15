import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseTokenFromArgs, parseFriendFromArgs, parseSignInLinkFromArgs, protocolHandlerArgs, relaunchOptions } from "./browser-signin-url.ts";

test("parseTokenFromArgs extracts clean token from moonwave://signin URL", () => {
  const url = "moonwave://signin?token=2-123456-7890abcdef";
  assert.equal(parseTokenFromArgs([url]), "2-123456-7890abcdef");
});

test("parseTokenFromArgs handles trailing slash in path", () => {
  const url = "moonwave://signin/?token=2-123456-7890abcdef";
  assert.equal(parseTokenFromArgs([url]), "2-123456-7890abcdef");
});

test("parseTokenFromArgs decodes percent-encoded token", () => {
  const raw = "2-123456-7890abcdef";
  const url = `moonwave://signin?token=${encodeURIComponent(raw)}`;
  assert.equal(parseTokenFromArgs([url]), raw);
});

test("parseTokenFromArgs removes quotes around cookie value", () => {
  const url = 'moonwave://signin?token="2-123456-7890abcdef"';
  assert.equal(parseTokenFromArgs([url]), "2-123456-7890abcdef");
});

test("parseTokenFromArgs returns null for invalid or missing URLs", () => {
  assert.equal(parseTokenFromArgs([]), null);
  assert.equal(parseTokenFromArgs(["https://soundcloud.com"]), null);
  assert.equal(parseTokenFromArgs(["moonwave://signin"]), null);
  assert.equal(parseTokenFromArgs(["moonwave://signin?token=short"]), null);
  assert.equal(parseTokenFromArgs(["moonwave://signin?token=bad token with spaces"]), null);
});

test("parseFriendFromArgs extracts valid friend code", () => {
  assert.equal(parseFriendFromArgs(["moonwave://friend/SKY-23456"]), "SKY-23456");
  assert.equal(parseFriendFromArgs(["moonwave://friend/sky-23456/"]), "SKY-23456");
});

test("parseFriendFromArgs rejects invalid friend codes", () => {
  assert.equal(parseFriendFromArgs([]), null);
  assert.equal(parseFriendFromArgs(["moonwave://friend/"]), null);
  assert.equal(parseFriendFromArgs(["moonwave://friend/INVALID"]), null);
  assert.equal(parseFriendFromArgs(["moonwave://friend/SKY-10000"]), null); // '0' and '1' are excluded
});

// ---- the one-time state ---------------------------------------------------------------------------------------------

test("a link from this session's helper page carries its state next to the token", () => {
  const state = "0123456789abcdef0123456789abcdef";
  const link = parseSignInLinkFromArgs([`moonwave://signin?token=2-123456-7890abcdef&state=${state}`]);
  assert.deepEqual(link, { token: "2-123456-7890abcdef", state });
});

test("a bookmark made before the state existed is still read, with no state to match", () => {
  assert.deepEqual(parseSignInLinkFromArgs(["moonwave://signin?token=2-123456-7890abcdef"]), { token: "2-123456-7890abcdef", state: null });
  // an empty state is the same as none: it can never match a real one
  assert.deepEqual(parseSignInLinkFromArgs(["moonwave://signin?token=2-123456-7890abcdef&state="]), { token: "2-123456-7890abcdef", state: null });
});

test("the state is read from the query only, wherever it sits among the parameters", () => {
  const link = parseSignInLinkFromArgs(["moonwave://signin?state=abc123&token=2-123456-7890abcdef"]);
  assert.deepEqual(link, { token: "2-123456-7890abcdef", state: "abc123" });
});

test("a link with a bad token is refused whatever state it claims", () => {
  assert.equal(parseSignInLinkFromArgs(["moonwave://signin?token=short&state=0123456789abcdef0123456789abcdef"]), null);
});

test("an old bookmark's link (no state) still parses — the app asks first, then signs in", () => {
  const link = parseSignInLinkFromArgs(["moonwave://signin?token=2-123456-7890abcdef"]);
  assert.ok(link, "old bookmarks must keep working");
  assert.equal(link.state, null);
});

// ---- the helper page's file -----------------------------------------------------------------------------------------

test("the helper page is written into a folder of its own, readable by its owner only", () => {
  // what startBrowserSignIn does: mkdtempSync under the temp path, then a file with mode 0o600
  const dir = mkdtempSync(join(tmpdir(), "moonwave-"));
  try {
    const file = join(dir, "sign-in.html");
    writeFileSync(file, "<html></html>", { encoding: "utf8", mode: 0o600 });
    assert.match(dir, /moonwave-[^/\\]+$/);
    if (process.platform !== "win32") {
      assert.equal(statSync(file).mode & 0o777, 0o600);
      assert.equal(statSync(dir).mode & 0o777, 0o700);
    }
    assert.equal(readFileSync(file, "utf8"), "<html></html>");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- portable protocol links and relaunch --------------------------------------------------------------------------

test("portable builds use the running unpacked exe during browser sign-in, and the outer portable exe otherwise", () => {
  const unpackedExe = "C:\\Users\\me\\AppData\\Local\\Temp\\nsA1B2.tmp\\app\\Moonwave.exe";
  const outerPortable = "D:\\Apps\\moonwave-portable-v2.5.2.exe";

  // idle / after sign-in: moonwave:// points at the outer portable .exe so links work after the app closes
  assert.deepEqual(
    protocolHandlerArgs({
      defaultApp: false,
      execPath: unpackedExe,
      appPath: "C:\\app.asar",
      portableExecutableFile: outerPortable,
    }),
    [outerPortable, []],
  );

  // while waiting for browser sign-in: moonwave:// points at the already-running unpacked Moonwave.exe
  assert.deepEqual(
    protocolHandlerArgs({
      defaultApp: false,
      execPath: unpackedExe,
      appPath: "C:\\app.asar",
      portableExecutableFile: outerPortable,
      preferRunning: true,
    }),
    [unpackedExe, []],
  );

  // development mode always passes the project path (and profile flag) regardless of preferRunning
  assert.deepEqual(
    protocolHandlerArgs({
      defaultApp: true,
      execPath: "/usr/bin/electron",
      appPath: "/workspace/Moonwave",
      skyProfile: "test-1",
      preferRunning: true,
    }),
    ["/usr/bin/electron", ["/workspace/Moonwave", "--sky-profile=test-1"]],
  );
});

test("relaunchOptions targets the outer portable .exe or AppImage instead of a temporary unpacked binary", () => {
  assert.deepEqual(
    relaunchOptions({
      argv: ["C:\\Temp\\ns1.tmp\\app\\Moonwave.exe", "--updated", "--foo"],
      portableExecutableFile: "D:\\moonwave-portable.exe",
    }),
    { execPath: "D:\\moonwave-portable.exe", args: ["--foo"] },
  );
  assert.deepEqual(
    relaunchOptions({
      argv: ["/tmp/.mount_moonwaXYZ/moonwave", "--updated"],
      appImage: "/home/me/Applications/moonwave.AppImage",
    }),
    { execPath: "/home/me/Applications/moonwave.AppImage", args: [] },
  );
  assert.deepEqual(
    relaunchOptions({
      argv: ["C:\\Program Files\\Moonwave\\Moonwave.exe", "--updated"],
    }),
    { args: [] },
  );
});

