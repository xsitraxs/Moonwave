import type { BrowserWindow } from "electron";
import type { MusicProvider } from "../../shared/provider";
import { log } from "../system/log";
import { send } from "../windows/main-window";
import { scSession } from "./session";

/** a follow/unfollow write, whatever the verb the site used, on either api host: /me/followings/{id} or /users/{id}/followings/{id} */
const WRITE = /^\/(me|users\/\d+)\/followings\/\d+\/?$/;

/** logs must never carry a URL (it holds the client_id) nor a token-like run */
const brief = (s: string) => s.replace(/https?:\/\/\S+/g, "…").replace(/[A-Za-z0-9_-]{20,}/g, "…").slice(0, 160);

/**
 * The check window («В окне приложения») shares the app's SoundCloud session with the site, so a person may follow an
 * artist there — on soundcloud.com itself — instead of pressing the app's button. The app would not know: the sidebar
 * counter, the «Подписки» screen and every follow button would show the old state until a reload. The site's own write
 * goes through the same session, so it can be heard here; after a quiet moment the app asks the site for the truth
 * again and pushes the followed ids to the page. The direction and the counter are never guessed from the request —
 * the page diffs the fresh list against what it has. Gentle on the API: a write is rare, half a second is given for
 * the rest of the site's traffic to land, and the read is one paged call after the caches are cleared.
 */
export function initFollowsWatch(data: MusicProvider, window: () => BrowserWindow | null) {
  let timer: NodeJS.Timeout | null = null;
  let syncing = false;
  let again = false;
  const sync = async () => {
    if (syncing) {
      again = true;
      return;
    }
    syncing = true;
    try {
      const ids = await data.getFollowedIds(true);
      send(window(), "follows:synced", { ids });
      log("main", `follows: heard a write on the site — the list was read again (${ids.length} followed)`);
    } catch (err) {
      log("main", `follows: could not re-read the list after a write on the site: ${brief((err as Error).message)}`);
    } finally {
      syncing = false;
      if (again) {
        again = false;
        void sync();
      }
    }
  };
  scSession().webRequest.onCompleted({ urls: ["https://api-v2.soundcloud.com/*", "https://api.soundcloud.com/*"] }, (details) => {
    if (details.statusCode < 200 || details.statusCode >= 300) return;
    if (details.method !== "POST" && details.method !== "PUT" && details.method !== "DELETE") return;
    try {
      if (!WRITE.test(new URL(details.url).pathname)) return;
    } catch {
      return;
    }
    // the site fires more than one request around a follow (the write and its own counters): let them land, then read once
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void sync(), 900);
  });
}
