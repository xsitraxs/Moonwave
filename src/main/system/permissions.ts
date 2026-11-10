import type { Session } from "electron";
import { log } from "./log";
import { allowPermission } from "./permissions-rules";

/**
 * Permission handlers for every session the app uses.
 *
 * Electron gives no handler by default and leaves decisions to Chromium, which means the app neither knows what was
 * granted nor can say no to a page it did not write. With these handlers every request is refused unless
 * permissions-rules.ts names it, and only for the app's own page. Checks (not just requests) are answered the same way,
 * because Chromium asks those too — a site would otherwise still get a permission it was refused at request time.
 *
 * The check window and the VK import window keep their sites working: neither needs a permission the app grants
 * (the app page's few are its own), so they get a plain "no" like everything else. The one to watch when touching
 * that window is speaker-selection: a page that switched its sound to another output device would lose it.
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
 * Sets both permission handlers on a session: requests are answered through `isAppUrl`, and checks answer "no" for
 * anything that is not the app's own page.
 */
export function lockPermissions(ses: Session, name: string, isAppUrl: (url: string) => boolean) {
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    // details.requestingUrl is where the permission is asked from; the frame's own address is the fallback when
    // Electron leaves it empty (a popup about to be shown, an about:blank frame in between)
    const url = details?.requestingUrl || wc?.getURL() || "";
    const allowed = !!wc && !wc.isDestroyed() && allowPermission(url, permission, isAppUrl);
    if (!allowed) note(name, permission, url);
    callback(allowed);
  });
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    // a check may come without webContents (a worker, a service worker): only the origin is known then
    return allowPermission(requestingOrigin, permission, isAppUrl);
  });
}
