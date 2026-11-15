import { create } from "zustand";
import { queryClient } from "@/api/queries";
import { tr as t } from "@/i18n";
import { call, errorCode, on } from "@/lib/sky";
import { askCheck } from "./check";
import { useAuth } from "./auth";
import { useUi } from "./ui";

/**
 * The people the signed-in user follows, for the follow buttons. Unlike likes there is no local fallback: following
 * happens on SoundCloud itself, so without a session the buttons stay hidden. Read once after sign-in; a click
 * changes the set right away, and a failure puts it back.
 */
export const useFollows = create<{ ids: Set<number>; ready: boolean }>(() => ({ ids: new Set(), ready: false }));

let loading: Promise<void> | null = null;

function load() {
  loading ??= call("data:followedIds")
    .then((ids) => useFollows.setState({ ids: new Set(ids), ready: true }))
    .catch(() => undefined)
    .finally(() => (loading = null));
  return loading;
}

const canFollow = () => useAuth.getState().status?.mode === "session";

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
  // a follow written on soundcloud.com itself (in the app's check window): main heard the write and re-read the list.
  // The counter moves by the set diff, so it stays exact whatever the site did; the lists re-fetch; the buttons follow
  on("follows:synced", ({ ids }) => {
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
  });
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

/** Follow / unfollow the account on SoundCloud, optimistically. The check dialog comes up when bot protection refuses. */
export async function toggleFollow(user: { id: number; permalinkUrl: string }) {
  const before = useFollows.getState().ids;
  const followed = !before.has(user.id);
  const ids = new Set(before);
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

/**
 * After the check: try the write again. Unlike likes there is no refresh channel for the followed ids, so a success
 * on the site that the app never saw can't be confirmed — the write itself is the source of truth.
 */
async function retryFollow(user: { id: number }, followed: boolean): Promise<boolean> {
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
