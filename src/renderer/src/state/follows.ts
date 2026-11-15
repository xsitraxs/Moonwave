import { create } from "zustand";
import { queryClient } from "@/api/queries";
import { tr as t } from "@/i18n";
import { call, errorCode, on } from "@/lib/sky";
import { askCheck } from "./check";
import { useAuth } from "./auth";
import { useUi } from "./ui";

/**
 * The people the signed-in user follows, for the follow buttons. Unlike likes there is no local fallback: following
 * happens on SoundCloud itself, so without a session the buttons stay hidden. Read once after sign-in.
 *
 * The follow write is the site's, not the app's: SoundCloud answers this app's POST /me/followings/{id} with its own
 * check (403 + DataDome) every time it comes from here, while the same write from the site inside the check window
 * goes through. So «Подписаться» opens the artist's page in a window of the app's session, the site does the write,
 * and the app hears it (follows:synced, from main) or re-reads the list when the window closes. Nothing flips until
 * the site has actually written. «Вы подписаны» (unfollow) stays in the app: its DELETE passes every time.
 */
export const useFollows = create<{ ids: Set<number>; ready: boolean }>(() => ({ ids: new Set(), ready: false }));

/** whether this run is SKY_DEMO=1 (fake data): there is no site to send a person to, the demo provider answers instantly */
let demoFlag: Promise<boolean> | null = null;
const isDemo = () => (demoFlag ??= call("app:info").then((i) => i.demo === true).catch(() => false));

let loading: Promise<void> | null = null;

function load() {
  loading ??= call("data:followedIds")
    .then((ids) => useFollows.setState({ ids: new Set(ids), ready: true }))
    .catch(() => undefined)
    .finally(() => (loading = null));
  return loading;
}

const canFollow = () => useAuth.getState().status?.mode === "session";

/**
 * The followed ids read again from the site (main heard the site's write, or the check window just closed): the
 * counter moves by the set diff — never a guessed delta — the lists re-fetch, the buttons follow.
 */
function applySyncedIds(ids: number[]) {
  const prev = useFollows.getState();
  const next = new Set(ids);
  if (prev.ready) {
    let delta = 0;
    for (const id of next) if (!prev.ids.has(id)) delta++;
    for (const id of prev.ids) if (!next.has(id)) delta--;
    if (delta !== 0) bumpFollowingsCount(delta);
  }
  useFollows.setState({ ids: next, ready: true });
  void queryClient.invalidateQueries({ queryKey: ["followings"] });
}

export function initFollows() {
  let mode = useAuth.getState().status?.mode;
  const reload = () => {
    if (canFollow()) void load();
    else useFollows.setState({ ids: new Set(), ready: false });
  };
  reload();
  useAuth.subscribe((s) => {
    if (s.status?.mode === mode) return;
    mode = s.status?.mode;
    reload();
  });
  // a follow written on soundcloud.com itself (in the app's check window): main heard the write and re-read the list
  on("follows:synced", ({ ids }) => applySyncedIds(ids));
}

export const useFollowed = (id: number | undefined) => useFollows((s) => id !== undefined && s.ids.has(id));

/**
 * Keep the account's followings counter (the sidebar, the «Подписки» screen title) in step without asking SoundCloud
 * again: auth:status is a snapshot from sign-in, so it would show the old number until the next one. An unknown count
 * stays unknown — never invent a number.
 */
function bumpFollowingsCount(delta: number) {
  const st = useAuth.getState().status;
  if (st?.mode !== "session" || !st.user) return;
  const n = st.user.followingsCount;
  if (typeof n !== "number") return;
  useAuth.setState({ status: { ...st, user: { ...st.user, followingsCount: Math.max(0, n + delta) } } });
}

/** The demo build's follow: fake data answers instantly, nothing to hand to a site. */
async function applyAppFollow(user: { id: number; permalinkUrl: string }, followed: boolean) {
  const ids = new Set(useFollows.getState().ids);
  if (followed) ids.add(user.id);
  else ids.delete(user.id);
  useFollows.setState({ ids });
  try {
    await call("data:setFollowed", user.id, followed);
    bumpFollowingsCount(followed ? 1 : -1);
    void queryClient.invalidateQueries({ queryKey: ["followings", "me"] });
  } catch (err) {
    // put it back as it was
    const back = new Set(useFollows.getState().ids);
    if (followed) back.delete(user.id);
    else back.add(user.id);
    useFollows.setState({ ids: back });
    if (errorCode(err) === "verify") askCheck({ action: followed ? t.follow : t.unfollow, url: user.permalinkUrl, retry: () => retryFollow(user, followed) });
    else useUi.getState().showToast(followed ? t.followFailed : t.unfollowFailed);
  }
}

export async function toggleFollow(user: { id: number; permalinkUrl: string }) {
  const before = useFollows.getState().ids;
  const wantFollow = !before.has(user.id);

  if (await isDemo()) return applyAppFollow(user, wantFollow);

  if (wantFollow) {
    // The site does the write (see the note at the top of this file): the window opens on the artist's page, and when
    // it closes the list is re-read once more — in case the watcher never heard the site's write for some reason
    try {
      await call("auth:check", user.permalinkUrl);
    } catch {
      /* the window may already be open (the call only focuses it) — the same flow follows from there */
    }
    const ids = await call("data:followedIds", true).catch(() => null);
    if (ids) applySyncedIds(ids);
    const done = useFollows.getState().ids.has(user.id);
    if (!done) useUi.getState().showToast(t.followNotDone);
    else void queryClient.invalidateQueries({ queryKey: ["followings", "me"] });
    return;
  }

  // Unfollow goes straight through: the site lets the app's DELETE pass (2xx every time), so it is optimistic with a
  // rollback, exactly like a like — and it never needs the window.
  const ids = new Set(before);
  ids.delete(user.id);
  useFollows.setState({ ids });
  try {
    await call("data:setFollowed", user.id, false);
    bumpFollowingsCount(-1);
    void queryClient.invalidateQueries({ queryKey: ["followings", "me"] });
  } catch (err) {
    const back = new Set(useFollows.getState().ids);
    back.add(user.id);
    useFollows.setState({ ids: back });
    if (errorCode(err) === "verify") askCheck({ action: t.unfollow, url: user.permalinkUrl, retry: () => retryFollow(user, false) });
    else useUi.getState().showToast(t.unfollowFailed);
  }
}

/**
 * After the check: try the write again. The site itself is the source of truth, and since the app hears the site's
 * writes (follows:synced), the desired state may already hold by now — the person may have followed on soundcloud.com
 * in the check window and the app already re-read the list. Then there is nothing to retry and the answer is yes;
 * otherwise the write itself decides.
 */
async function retryFollow(user: { id: number }, followed: boolean): Promise<boolean> {
  if (useFollows.getState().ids.has(user.id) === followed) return true;
  try {
    await call("data:setFollowed", user.id, followed);
  } catch {
    return false;
  }
  const ids = new Set(useFollows.getState().ids);
  if (followed) ids.add(user.id);
  else ids.delete(user.id);
  useFollows.setState({ ids });
  bumpFollowingsCount(followed ? 1 : -1);
  void queryClient.invalidateQueries({ queryKey: ["followings", "me"] });
  return true;
}
