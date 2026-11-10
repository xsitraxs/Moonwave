import assert from "node:assert/strict";
import { test } from "node:test";
import { withPrefDefaults, type Prefs } from "./ipc.ts";

const proxy = (p: Partial<Prefs["proxy"]>) => withPrefDefaults({ proxy: { mode: "system", url: "", username: "", ...p } }).proxy;

test("proxy: a new install starts on auto", () => {
  assert.equal(withPrefDefaults(undefined).proxy.mode, "auto");
});

test("proxy: the old default (system) moves to auto once", () => {
  assert.deepEqual(proxy({ mode: "system" }), { mode: "auto", url: "", username: "", v: 2 });
  // picked again after the move: stays
  assert.equal(proxy({ mode: "system", v: 2 }).mode, "system");
});

test("proxy: other choices stay as they were", () => {
  assert.equal(proxy({ mode: "custom", url: "socks5://127.0.0.1:1080" }).mode, "custom");
  assert.equal(proxy({ mode: "direct" }).mode, "direct");
  assert.equal(proxy({ mode: "builtin" }).mode, "builtin");
});

test("telemetry: a new install starts with both sharing switches off and the question unasked", () => {
  const p = withPrefDefaults(undefined);
  assert.equal(p.countMe, false);
  assert.equal(p.shareListening, false);
  assert.equal(p.telemetryAsked, false);
});

test("telemetry: an install that already ran keeps its choices and is not asked again", () => {
  // the old default was on for both: an upgrading user's saved settings must survive untouched
  const kept = withPrefDefaults({ countMe: true, shareListening: true });
  assert.equal(kept.countMe, true);
  assert.equal(kept.shareListening, true);
  assert.equal(kept.telemetryAsked, true, "an install with settings has already answered");

  // and someone who had turned them off stays off
  const off = withPrefDefaults({ countMe: false, shareListening: false });
  assert.equal(off.countMe, false);
  assert.equal(off.shareListening, false);
  assert.equal(off.telemetryAsked, true);
});

test("telemetry: a new install sees the question once, and the answer stops it", () => {
  // first start: nothing stored yet
  assert.equal(withPrefDefaults(undefined).telemetryAsked, false);
  // after the person answered "not now": the mark is stored and the question is gone
  assert.equal(withPrefDefaults({ telemetryAsked: true }).telemetryAsked, true);
  // they later turned the count on themselves: still not asked again
  assert.equal(withPrefDefaults({ telemetryAsked: true, countMe: true }).telemetryAsked, true);
});

test("discord: the short status names the app unless the user picks the artist or the track", () => {
  assert.equal(withPrefDefaults(undefined).discordStatus, "app");
  // settings saved by a version without the choice get the same default
  assert.equal(withPrefDefaults({ discordPresence: true }).discordStatus, "app");
  assert.equal(withPrefDefaults({ discordStatus: "track" }).discordStatus, "track");
});
