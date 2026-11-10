/**
 * What a page in one of the app's sessions may ask Chromium for.
 *
 * Before this, no session had a permission handler at all, so Electron's default applied: some things were turned
 * down, but the decision was Chromium's, not the app's, and it said nothing where it could be checked. Two rules now:
 * everything is refused unless it is needed and named here, and nothing is granted to a page that is not the app's
 * own — an address on the SoundCloud session or in the VK window must never get the app's allowlist by accident.
 *
 * `permissions.ts` (main) is the thin Electron adapter; this file is free of imports so it can be unit-tested.
 */

/**
 * The permissions the app's own page uses, and only in its own window.
 *
 * `speaker-selection` is here because of Settings → App's output device picker: choosing an audio *output* with
 * setSinkId is gated by Chromium's speaker-selection permission. Refusing it would undo the picker, which is a real
 * feature — and the permission only ever unlocks audio outputs inside the app's own page.
 */
const APP_PERMISSIONS: ReadonlySet<string> = new Set([
  // the full screen player asks the page to go full screen (and Chromium asks for this while doing so)
  "fullscreen",
  "automatic-fullscreen",
  // copying a link to the clipboard happens in main over IPC, but a sanitized write is what Chromium checks first
  "clipboard-sanitized-write",
  // the output device picker (Settings → App, the player's bar)
  "speaker-selection",
]);

/** True when `url` is one of the app's own pages (the built index.html, or the dev server's origin). */
export type AppUrlCheck = (url: string) => boolean;

/**
 * Resolves the document URL a permission check or request actually came from.
 *
 * In a packaged build the app's page is `file:///.../out/renderer/index.html`, whose Chromium origin in
 * `setPermissionCheckHandler` is just `file:///` (or empty) without the file path — `isAppUrl` needs the full URL,
 * which Electron puts on `details.requestingUrl`. Falling back to `mainUrl` (`webContents.getURL()`) is safe only for
 * the main frame itself (`isMainFrame !== false`), so a subframe can never borrow the app window's URL.
 */
export function permissionUrl(source: {
  requestingUrl?: string;
  isMainFrame?: boolean;
  mainUrl?: string;
  requestingOrigin?: string;
}): string {
  if (source.requestingUrl) return source.requestingUrl;
  if (source.isMainFrame !== false && source.mainUrl) return source.mainUrl;
  return source.requestingOrigin || "";
}

/**
 * Whether one permission, asked for by a page at `url`, is granted. The rule: a known app permission, from a page that
 * is the app itself — never from about:blank, a data: page, or any site the app happens to show in another window.
 */
export function allowPermission(url: string, permission: string, isAppUrl: AppUrlCheck): boolean {
  if (!APP_PERMISSIONS.has(permission)) return false;
  if (!url) return false;
  return isAppUrl(url);
}

/**
 * Whether a permission *check* (not a request) is answered yes. The same rule as allowPermission, plus one thing only a
 * check needs: `media` for audio, on the app's own page.
 *
 * Chromium hides the output devices' ids and names from navigator.mediaDevices.enumerateDevices() unless the page
 * passes the microphone's permission check, and Electron asks setPermissionCheckHandler that as "media" with
 * mediaType "audio". Answering no there left the output device picker (Settings → App, the player's bar) with one
 * nameless entry in a packaged build. A check never opens the microphone: getUserMedia goes through the request
 * handler, which still refuses `media` for everyone (allowPermission).
 */
export function allowPermissionCheck(url: string, permission: string, mediaType: string | undefined, isAppUrl: AppUrlCheck): boolean {
  if (permission === "media") return mediaType === "audio" && !!url && isAppUrl(url);
  return allowPermission(url, permission, isAppUrl);
}
