import type { Session } from "electron";
import { log } from "./log";
import { allowPermission, allowPermissionCheck, permissionUrl } from "./permissions-rules";

/**
 * Permission handlers for every session the app uses.
 *
 * Electron gives no handler by default and leaves decisions to Chromium, which means the app neither knows what was
 * granted nor can say no to a page it did not write. With these handlers every request is refused unless
 * permissions-rules.ts names it, and only for the app's own page. Checks (not just requests) are answered the same way,
 * because Chromium asks those too — a site would otherwise still get a permission it was refused at request time.
 *
 * The check window and the VK import window keep their sites working: neither needs a permission the app grants
 * (the app page's few are its own), so they get a plain "no" like everything else. Every refusal is logged once per
 * session, permission and URL so a manual run shows immediately in `main.log` if a site ever asks for one.
 */

/** One refusal line per permission and session, so the log stays readable when a site asks in a loop. */
const noted = new Set<string>();

function note(sessionName: string, permission: string, url: string) {
  const key = `${sessionName}:${permission}:${url}`;
  if (noted.has(key)) return;
  noted.add(key);
  log("main", `permissions: ${sessionName} refused ${permission} for ${url}`);
}

/**
 * Sets both permission handlers on a session: requests and checks are answered through `isAppUrl`, reading the
 * requesting frame's full URL from `details.requestingUrl` first so packaged `file://` builds (where `requestingOrigin`
 * carries no file path) still recognize the app's own `index.html`.
 */
export function lockPermissions(ses: Session, name: string, isAppUrl: (url: string) => boolean) {
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const alive = !!wc && !wc.isDestroyed();
    const url = permissionUrl({
      requestingUrl: details?.requestingUrl,
      isMainFrame: details?.isMainFrame,
      mainUrl: alive ? wc.getURL() : "",
    });
    const allowed = alive && allowPermission(url, permission, isAppUrl);
    if (!allowed) note(name, permission, url);
    callback(allowed);
  });
  ses.setPermissionCheckHandler((wc, permission, requestingOrigin, details) => {
    if (wc && wc.isDestroyed()) return false;
    const url = permissionUrl({
      requestingUrl: details?.requestingUrl,
      isMainFrame: details?.isMainFrame,
      mainUrl: wc ? wc.getURL() : "",
      requestingOrigin,
    });
    // checks have one extra: the audio "media" check enumerateDevices needs to name the outputs (permissions-rules.ts)
    return allowPermissionCheck(url, permission, details?.mediaType, isAppUrl);
  });
}
