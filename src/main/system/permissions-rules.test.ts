import assert from "node:assert/strict";
import { test } from "node:test";
import { allowPermission, allowPermissionCheck, permissionUrl } from "./permissions-rules.ts";

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

test("packaged file:// permission checks read details.requestingUrl instead of bare file:/// origin", () => {
  const url = permissionUrl({
    requestingUrl: APP,
    isMainFrame: true,
    mainUrl: APP,
    requestingOrigin: "file:///",
  });
  assert.equal(allowPermission(url, "speaker-selection", isApp), true);
  assert.equal(allowPermission(url, "clipboard-sanitized-write", isApp), true);
});

test("a subframe never borrows the main window's URL when its own requestingUrl is empty or another site", () => {
  const blankSubframe = permissionUrl({
    requestingUrl: "",
    isMainFrame: false,
    mainUrl: APP,
    requestingOrigin: "null",
  });
  assert.equal(allowPermission(blankSubframe, "fullscreen", isApp), false);

  const crossSiteSubframe = permissionUrl({
    requestingUrl: "https://captcha-delivery.com/frame",
    isMainFrame: false,
    mainUrl: APP,
    requestingOrigin: "https://captcha-delivery.com",
  });
  assert.equal(allowPermission(crossSiteSubframe, "fullscreen", isApp), false);
});

test("a worker check without webContents falls back to requestingOrigin", () => {
  const devApp = (u: string) => u.startsWith("http://localhost:5173");
  const workerUrl = permissionUrl({ requestingOrigin: "http://localhost:5173/" });
  assert.equal(allowPermission(workerUrl, "clipboard-sanitized-write", devApp), true);
});

test("the audio media check (enumerateDevices naming the outputs) passes for the app's page only", () => {
  assert.equal(allowPermissionCheck(APP, "media", "audio", isApp), true);
  for (const url of ["https://soundcloud.com/", "https://vk.com/audio", "about:blank", "", "file:///etc/passwd"]) {
    assert.equal(allowPermissionCheck(url, "media", "audio", isApp), false, url);
  }
});

test("the media check stays closed for video and unknown media, and a request never gets media", () => {
  assert.equal(allowPermissionCheck(APP, "media", "video", isApp), false);
  assert.equal(allowPermissionCheck(APP, "media", "unknown", isApp), false);
  assert.equal(allowPermissionCheck(APP, "media", undefined, isApp), false);
  assert.equal(allowPermission(APP, "media", isApp), false);
});

test("other checks follow the request rules", () => {
  assert.equal(allowPermissionCheck(APP, "speaker-selection", undefined, isApp), true);
  assert.equal(allowPermissionCheck(APP, "notifications", undefined, isApp), false);
  assert.equal(allowPermissionCheck("https://soundcloud.com/", "fullscreen", undefined, isApp), false);
});
