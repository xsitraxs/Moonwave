import { artwork } from "@shared/types";
import Icon, { type IconName } from "@/components/ui/Icon";
import { useT } from "@/i18n";
import { useAuth } from "@/state/auth";
import { useNav } from "@/state/nav";
import { player, useCurrentTrack, usePlayer } from "@/state/player";
import { useSettings } from "@/state/settings";
import { useUi } from "@/state/ui";

const STATIC = { kind: "static" } as const;

export interface HomeAction {
  icon: IconName;
  title: string;
  note: string;
  /** A cover makes "keep listening" unmistakable; an icon stands for the actions without one. */
  coverUrl?: string | null;
  onClick: () => void;
}

function greeting(t: ReturnType<typeof useT>, name: string | undefined) {
  const h = new Date().getHours();
  const hello = h >= 5 && h < 12 ? t.goodMorning : h >= 12 && h < 17 ? t.goodAfternoon : h >= 17 && h < 23 ? t.goodEvening : t.lateNight;
  return name ? `${hello}, ${name}` : hello;
}

/**
 * The first screenful of Home, in both designs. Reading order: where I am (the breadcrumb and greeting), what I can do
 * here (one dominant action plus three labelled ones), and only then the browseable content below it. No unlabelled
 * tiles and no filter tabs competing with the greeting for the first look.
 */
export function HomeStart({ name, signedIn, hasMusic, primary, secondary }: { name?: string; signedIn: boolean; hasMusic: boolean; primary: HomeAction; secondary: HomeAction[] }) {
  const t = useT();
  const src = primary.coverUrl ? artwork(primary.coverUrl, "t300x300") : null;
  const lead = !signedIn ? t.homeLeadOut : hasMusic ? t.homeLeadIn : t.homeLeadNew;
  return (
    <section className="home-start" aria-label={t.homeStartLabel}>
      <header className="home-start-head">
        <p className="home-start-place">
          <Icon name="home" size={12} />
          <span>{t.appName} · {t.home}</span>
        </p>
        <h1 className="home-start-title">{greeting(t, name)}</h1>
        <p className="home-start-lead">{lead}</p>
      </header>

      <div className="home-start-grid">
        <button type="button" className="home-start-main" onClick={primary.onClick}>
          <span className="home-start-visual">
            {src ? (
              <img src={src} alt="" draggable={false} className="h-full w-full object-cover" />
            ) : (
              <Icon name={primary.icon} size={22} filled={primary.icon === "heart"} />
            )}
          </span>
          <span className="home-start-copy">
            <span className="home-start-main-title">{primary.title}</span>
            <span className="home-start-main-note">{primary.note}</span>
          </span>
          <span className="home-start-arrow" aria-hidden="true">→</span>
        </button>

        <div className="home-start-more">
          {secondary.map((a) => (
            <button key={a.title} type="button" className="home-start-mini" onClick={a.onClick}>
              <Icon name={a.icon} size={17} filled={a.icon === "heart"} />
              <span className="home-start-mini-copy">
                <span className="home-start-mini-title">{a.title}</span>
                <span className="home-start-mini-note">{a.note}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * The same actions on both Home designs: continue what is playing (or what was played last), otherwise find music;
 * then the two or three ways into the library. Kept in one place so the hierarchy can't drift between designs.
 */
export function useHomeActions() {
  const t = useT();
  const goTo = useNav((s) => s.open);
  const current = useCurrentTrack();
  const status = usePlayer((s) => s.status);
  const history = useSettings((s) => s.history);
  const signedIn = useAuth((s) => s.status?.mode === "session");
  const openFull = useUi((s) => s.openFull);

  const last = history[0];
  const playing = !!current && (status === "playing" || status === "loading");
  const primary: HomeAction = current
    ? {
        icon: "play",
        title: playing ? t.homeBackToPlayer : t.homeContinueListening,
        note: `${current.title} · ${current.artist}`,
        coverUrl: current.artworkUrl,
        onClick: () => (playing ? openFull() : player.toggle()),
      }
    : last
      ? {
          icon: "play",
          title: t.homeContinueListening,
          note: `${last.title} · ${last.artist}`,
          coverUrl: last.artworkUrl,
          onClick: () => player.playFrom(history, 0, STATIC),
        }
      : {
          icon: "search",
          title: t.homeFindMusic,
          note: t.homeFindMusicNote,
          onClick: () => goTo("search", { name: "search" }),
        };

  const more: HomeAction[] = [];
  if (primary.icon !== "search") more.push({ icon: "search", title: t.search, note: t.searchHint, onClick: () => goTo("search", { name: "search" }) });
  if (signedIn) {
    more.push({ icon: "heart", title: t.likedTracks, note: t.homeLikesNote, onClick: () => goTo("likes", { name: "likes" }) });
    more.push({ icon: "playlists", title: t.playlists, note: t.homePlaylistsNote, onClick: () => goTo("playlists", { name: "playlists" }) });
  } else {
    more.push({ icon: "user", title: t.signIn, note: t.homeSignInNote, onClick: () => goTo("signin", { name: "signin" }) });
  }
  if (history.length) more.push({ icon: "history", title: t.history, note: t.homeHistoryNote, onClick: () => goTo("history", { name: "history" }) });
  more.push({ icon: "disc", title: t.localMusic, note: t.homeLocalNote, onClick: () => goTo("local", { name: "local" }) });

  return { primary, secondary: more.slice(0, 3), hasMusic: !!current || history.length > 0 };
}
