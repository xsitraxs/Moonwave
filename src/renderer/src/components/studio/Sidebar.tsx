import type { ReactNode } from "react";
import { artwork } from "@shared/types";
import { useT, numberLocale } from "@/i18n";
import { shortVersion } from "@/lib/format";
import { unpin } from "@/lib/links";
import { useSystem } from "@/lib/system";
import { useAuth } from "@/state/auth";
import { useLikes } from "@/state/likes";
import { useNav, type Route, type Section } from "@/state/nav";
import { usePlayer } from "@/state/player";
import { useSettings } from "@/state/settings";
import { unreadTotal, useSocial } from "@/state/social";
import { useUi } from "@/state/ui";
import PlaylistCover from "../playlists/PlaylistCover";
import Icon, { type IconName } from "../ui/Icon";

function Nav({ section, route, icon, children, count, badge }: { section: Section; route: Route; icon: IconName; children: ReactNode; count?: number | null; badge?: number }) {
  const current = useNav((s) => s.section);
  const open = useNav((s) => s.open);
  const on = current === section;
  const label = typeof children === "string" ? children : undefined;
  return (
    <button type="button" onClick={() => open(section, route)} aria-current={on ? "page" : undefined} title={label} className={`s-nav ${on ? "on" : ""}`}>
      <Icon name={icon} size={20} />
      <span className="lbl truncate">{children}</span>
      {badge ? (
        <span className="u">{badge > 99 ? "99+" : badge}</span>
      ) : count ? (
        <span className="n">{count.toLocaleString(numberLocale())}</span>
      ) : null}
    </button>
  );
}

/** three bars that move while this list is the one playing */
function Playing({ paused }: { paused: boolean }) {
  return (
    <span className={`s-eq ${paused ? "paused" : ""}`} aria-hidden="true">
      <i style={{ height: "60%" }} />
      <i />
      <i style={{ height: "40%" }} />
    </span>
  );
}

function Pinned() {
  const t = useT();
  const route = useNav((s) => s.route);
  const go = useNav((s) => s.go);
  const playlists = useSettings((s) => s.pinnedPlaylists);
  const source = usePlayer((s) => s.source);
  const paused = usePlayer((s) => s.status !== "playing");

  if (!playlists.length) {
    return (
      <>
        <div className="s-sep" aria-hidden="true" />
        <div className="s-pin-hint" role="note">
          <Icon name="plus" size={16} className="shrink-0" />
          <span className="hint-text">{t.pinnedEmpty}</span>
        </div>
      </>
    );
  }
  return (
    <>
      <div className="s-sep" aria-hidden="true" />
      <div className="min-h-0 overflow-y-auto" aria-label={t.pinned}>
        {playlists.map((p) => {
          const on = route.name === "playlist" && route.id === p.id;
          const playing = source.kind === "playlist" && source.playlistId === p.id;
          return (
            <div key={p.id} className="group relative">
              <button type="button" onClick={() => go({ name: "playlist", id: p.id })} title={p.title} className={`s-pin ${on ? "on" : ""}`}>
                <span className="cv">
                  <PlaylistCover playlist={p} size="large" />
                </span>
                <span className="meta min-w-0 flex-1">
                  <span className="t block">{p.title}</span>
                  <span className="s block">{t.playlistCount(p.trackCount)}</span>
                </span>
                {playing && <Playing paused={paused} />}
              </button>
              <button
                type="button"
                aria-label={`${t.unpin}: ${p.title}`}
                title={t.unpin}
                onClick={() => unpin(p.id)}
                className="absolute right-1.5 top-1/2 hidden h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-[var(--s-dim)] hover:text-text group-hover:grid"
              >
                <Icon name="close" size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}

function Me() {
  const t = useT();
  const status = useAuth((s) => s.status);
  const code = useSocial((s) => s.status?.profile?.code);
  const appearance = useUi((s) => s.appearance);
  const setAppearance = useUi((s) => s.setAppearance);
  const open = useNav((s) => s.open);
  const user = status?.mode === "session" ? status.user : null;
  if (!user) {
    return (
      <div className="s-me">
        <button type="button" onClick={() => open("signin", { name: "signin" })} className="s-signin" aria-label={t.signIn}>
          <Icon name="user" size={18} />
          <span className="lbl">{t.signIn}</span>
        </button>
        <button
          type="button"
          className={`s-ib !h-8 !w-8 ${appearance === "side" ? "on" : ""}`}
          onClick={() => setAppearance(appearance === "side" ? null : "side")}
          aria-label={t.secAppearance}
          title={t.secAppearance}
          aria-expanded={appearance === "side"}
          data-appearance-toggle
        >
          <Icon name="image" size={20} />
        </button>
      </div>
    );
  }
  return (
    <div className="s-me">
      <button
        type="button"
        onClick={() => open(`profile:${user.id}`, { name: "profile", userId: user.id })}
        title={user.username}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-[var(--r2)] py-0.5 text-left transition-colors motion-color hover:bg-[var(--s-hover)]"
      >
        <span className="grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-full bg-white/[0.12] text-[12px] font-semibold text-text">
          {user?.avatarUrl ? <img src={artwork(user.avatarUrl, "t67x67") ?? undefined} alt="" className="h-full w-full object-cover" draggable={false} /> : (user?.username ?? "?").charAt(0).toUpperCase()}
        </span>
        <span className="meta min-w-0 flex-1">
          <span className="t block truncate">{user.username}</span>
          <span className="s block truncate">{code ?? "SoundCloud"}</span>
        </span>
      </button>
      <button
        type="button"
        className={`s-ib !h-8 !w-8 ${appearance === "side" ? "on" : ""}`}
        onClick={() => setAppearance(appearance === "side" ? null : "side")}
        aria-label={t.secAppearance}
        title={t.secAppearance}
        aria-expanded={appearance === "side"}
        data-appearance-toggle
      >
        <Icon name="image" size={20} />
      </button>
    </div>
  );
}

/** Studio sidebar: grouped places (Overview / Library / Local), pinned playlists, account footer, collapsible. */
export default function StudioSidebar() {
  const t = useT();
  const status = useAuth((s) => s.status);
  const user = status?.mode === "session" ? status.user : null;
  const localLikes = useSettings((s) => s.prefs.localLikes);
  const likedCount = useLikes((s) => (s.ready ? s.ids.size : null));
  const historyCount = useSettings((s) => s.history.length);
  const social = useSocial((s) => !!s.status?.available);
  const unread = useSocial((s) => unreadTotal(s.unread) + (s.friends?.incoming.length ?? 0));
  const update = useSystem((s) => s.update);
  const open = useNav((s) => s.open);
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const toggleSidebar = useUi((s) => s.toggleSidebar);

  return (
    <nav aria-label={t.appName} className="s-side s-glass">
      <div className="s-group" aria-hidden="true">
        {t.overview}
      </div>
      <Nav section="home" route={{ name: "home" }} icon="home">
        {t.home}
      </Nav>
      <Nav section="feed" route={{ name: "feed" }} icon="feed">
        {t.feed}
      </Nav>
      <Nav section="stations" route={{ name: "stations" }} icon="radio">
        {t.stations}
      </Nav>
      <Nav section="dj" route={{ name: "dj" }} icon="dj">
        {t.dj}
      </Nav>
      {social && (
        <>
          <Nav section="inbox" route={{ name: "inbox" }} icon="inbox" badge={unread}>
            {t.inbox}
          </Nav>
          <Nav section="workshop" route={{ name: "workshop" }} icon="brush">
            {t.workshop}
          </Nav>
        </>
      )}

      <div className="s-group" aria-hidden="true">
        {t.library}
      </div>
      <Nav section="likes" route={{ name: "likes" }} icon="heart" count={localLikes ? likedCount : user?.likesCount}>
        {t.likedTracks}
      </Nav>
      <Nav section="playlists" route={{ name: "playlists" }} icon="list" count={user?.playlistCount}>
        {t.playlists}
      </Nav>
      <Nav section="albums" route={{ name: "albums" }} icon="disc">
        {t.albums}
      </Nav>
      <Nav section="following" route={{ name: "following" }} icon="users" count={user?.followingsCount}>
        {t.following}
      </Nav>
      <Nav section="history" route={{ name: "history" }} icon="history" count={historyCount || null}>
        {t.history}
      </Nav>

      <div className="s-group" aria-hidden="true">
        {t.localSection}
      </div>
      <Nav section="local" route={{ name: "local" }} icon="device">
        {t.localMusic}
      </Nav>

      <Pinned />

      {(update.state === "available" || update.state === "ready") && (
        <button type="button" onClick={() => open("settings", { name: "settings" })} className="s-btn pri mx-1 mt-3">
          {t.updateBanner(shortVersion(update.version))}
        </button>
      )}
      <div className="mt-auto pt-2">
        <div className="mb-2">
          <Nav section="settings" route={{ name: "settings" }} icon="settings">
            {t.settings}
          </Nav>
        </div>
        <button
          type="button"
          onClick={toggleSidebar}
          aria-expanded={!collapsed}
          aria-label={collapsed ? t.expandSidebar : t.collapseSidebar}
          title={collapsed ? t.expandSidebar : t.collapseSidebar}
          className="s-collapse mb-1"
        >
          <Icon name={collapsed ? "forward" : "back"} size={16} />
          <span className="lbl">{collapsed ? t.expandSidebar : t.collapseSidebar}</span>
        </button>
        <Me />
      </div>
    </nav>
  );
}
