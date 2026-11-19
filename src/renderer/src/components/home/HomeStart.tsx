import { artwork, type Track } from "@shared/types";
import Icon from "@/components/ui/Icon";
import { useT } from "@/i18n";
import { formatGreeting, greetingKey } from "@/lib/homeHelpers";
import { duration } from "@/lib/format";
import { useNav } from "@/state/nav";
import { player, useCurrentTrack, usePlayer, usePosition } from "@/state/player";
import { useSettings } from "@/state/settings";
import { useUi } from "@/state/ui";

const STATIC = { kind: "static" } as const;

function HeroProgress({ active, durationMs }: { active: boolean; durationMs: number }) {
  const position = usePosition((s) => s.position);
  const playerDuration = usePlayer((s) => s.duration);
  const totalS = active && playerDuration > 0 ? playerDuration : durationMs / 1000;
  const elapsedS = active ? Math.min(position, totalS || position) : 0;
  const pct = totalS > 0 ? Math.max(0, Math.min(100, (elapsedS / totalS) * 100)) : 0;

  return (
    <div className="home-hero-progress">
      <span className="home-hero-time">{duration(elapsedS * 1000)}</span>
      <div className="home-hero-track" aria-hidden="true">
        <div className="home-hero-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="home-hero-time">{duration(totalS * 1000)}</span>
    </div>
  );
}

/**
 * The first screenful of Home: H1 time-of-day greeting and a single prominent hero card for continuing playback
 * (or starting with search when history is empty). No duplicate sidebar quick-access tiles.
 */
export function HomeStart({ name, signedIn }: { name?: string; signedIn: boolean }) {
  const t = useT();
  const goTo = useNav((s) => s.open);
  const go = useNav((s) => s.go);
  const current = useCurrentTrack();
  const status = usePlayer((s) => s.status);
  const history = useSettings((s) => s.history);
  const openFull = useUi((s) => s.openFull);

  const heroTrack: Track | null = current ?? history[0] ?? null;
  const isCurrent = !!current && heroTrack?.id === current.id;
  const playing = isCurrent && (status === "playing" || status === "loading");
  const coverSrc = heroTrack?.artworkUrl ? artwork(heroTrack.artworkUrl, "t300x300") : null;
  const hello = formatGreeting(t[greetingKey(new Date().getHours())], name);

  const onPlay = () => {
    if (isCurrent) player.toggle();
    else if (history.length) player.playFrom(history, 0, STATIC);
    else goTo("search", { name: "search" });
  };

  const eyebrow = !heroTrack
    ? t.homeStartLabel
    : playing
      ? t.nowPlaying
      : isCurrent
        ? t.paused
        : t.homeContinueListening;

  return (
    <section className="home-start" aria-label={t.homeStartLabel}>
      <header className="home-start-head">
        <h1 className="home-start-title">{hello}</h1>
      </header>

      {heroTrack ? (
        <div className="home-hero">
          <button
            type="button"
            onClick={onPlay}
            aria-label={`${playing ? t.pause : t.play}: ${heroTrack.title}`}
            className="home-hero-cover group cursor-pointer"
          >
            {coverSrc ? (
              <img
                src={coverSrc}
                alt=""
                draggable={false}
                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
              />
            ) : (
              <Icon name="disc" size={40} className="text-muted" />
            )}
          </button>

          <div className="home-hero-body">
            <div>
              <div className="home-hero-eyebrow">{eyebrow}</div>
              <button
                type="button"
                onClick={() => go({ name: "track", id: heroTrack.id })}
                className="home-hero-title block max-w-full text-left hover:underline"
                title={heroTrack.title}
              >
                {heroTrack.title}
              </button>
              <button
                type="button"
                onClick={() => go({ name: "profile", userId: heroTrack.user.id })}
                className="home-hero-artist block max-w-full text-left hover:text-text hover:underline"
              >
                {heroTrack.artist}
              </button>
            </div>

            <HeroProgress active={isCurrent} durationMs={heroTrack.durationMs} />

            <div className="home-hero-actions">
              <button type="button" onClick={onPlay} className="home-hero-play">
                <Icon name={playing ? "pause" : "play"} size={20} />
                <span>{playing ? t.pause : isCurrent ? t.play : t.homeContinueListening}</span>
              </button>
              {isCurrent && (
                <button type="button" onClick={openFull} className="home-hero-secondary">
                  <Icon name="expand" size={18} />
                  <span>{t.homeBackToPlayer}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="home-hero">
          <div className="home-hero-cover">
            <Icon name="search" size={36} className="text-muted" />
          </div>
          <div className="home-hero-body">
            <div>
              <div className="home-hero-eyebrow">{signedIn ? t.homeLeadNew : t.homeLeadOut}</div>
              <div className="home-hero-title">{t.homeFindMusic}</div>
              <div className="home-hero-artist">{t.homeFindMusicNote}</div>
            </div>
            <div className="home-hero-actions">
              <button type="button" onClick={() => goTo("search", { name: "search" })} className="home-hero-play">
                <Icon name="search" size={20} />
                <span>{t.search}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
