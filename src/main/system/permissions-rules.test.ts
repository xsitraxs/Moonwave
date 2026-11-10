import assert from "node:assert/strict";
import { test } from "node:test";
import { allowPermission } from "./permissions-rules.ts";

const APP = "file:///app/out/renderer/index.html";
const isApp = (url: string) => url === APP || url.startsWith(`${APP}?`) || url.startsWith(`${APP}#`);

test("the app's own page gets full screen and sanitized clipboard writes", () => {
  assert.equal(allowPermission(APP, "fullscreen", isApp), true);
  assert.equal(allowPermission(`${APP}?sc-debug`, "fullscreen", isApp), true);
  assert.equal(allowPermission(APP, "clipboard-sanitized-write", isApp), true);
  assert.equal(allowPermission(APP, "automatic-fullscreen", isApp), true);
});

test("the output device picker's speaker-selection is the one other thing the app gets", () => {
  assert.equal(allowPermission(APP, "speaker-selection", isApp), true);
});

test("every other permission is refused, even for the app", () => {
  for (const permission of ["notifications", "media", "geolocation", "clipboard-read", "openExternal", "hid", "serial", "usb", "display-capture", "midi", "unknown"]) {
    assert.equal(allowPermission(APP, permission, isApp), false, permission);
  }
});

test("the app's permissions are not given to any other page", () => {
  for (const url of ["https://soundcloud.com/", "https://vk.com/audio", "about:blank", "data:text/html,x", "", "file:///etc/passwd"]) {
    assert.equal(allowPermission(url, "fullscreen", isApp), false, url);
    assert.equal(allowPermission(url, "clipboard-sanitized-write", isApp), false, url);
    assert.equal(allowPermission(url, "speaker-selection", isApp), false, url);
  }
});

test("a lookalike app address is not the app", () => {
  assert.equal(allowPermission(`${APP}.evil`, "fullscreen", isApp), false);
  assert.equal(allowPermission("file:///app/out/renderer/index2.html", "fullscreen", isApp), false);
});
