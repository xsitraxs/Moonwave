import { artwork, type Track } from "@shared/types";
import Icon from "@/components/ui/Icon";
import { useT, numberLocale } from "@/i18n";
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
 * The first screenful of Home: H1 time-of-day greeting with a date subtitle, and a compact now-playing strip
 * (cover, title, progress, play — the full player is the bar below, not a second copy). The strip's right side
 * shows what's next in the queue. Guests get three tiles instead of a dead hero.
 */
export function HomeStart({ name, signedIn }: { name?: string; signedIn: boolean }) {
  const t = useT();
  const goTo = useNav((s) => s.open);
  const go = useNav((s) => s.go);
  const current = useCurrentTrack();
  const status = usePlayer((s) => s.status);
  const history = useSettings((s) => s.history);
  const progress = useSettings((s) => s.trackProgress);
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const openFull = useUi((s) => s.openFull);

  const heroTrack: Track | null = current ?? history[0] ?? null;
  const isCurrent = !!current && heroTrack?.id === current.id;
  const playing = isCurrent && (status === "playing" || status === "loading");
  const coverSrc = heroTrack?.artworkUrl ? artwork(heroTrack.artworkUrl, "t300x300") : null;
  const hello = formatGreeting(t[greetingKey(new Date().getHours())], name);
  const dateLine = new Intl.DateTimeFormat(numberLocale(), { weekday: "long", day: "numeric", month: "long" }).format(new Date());
  const nextTrack = isCurrent ? (queue[index + 1] ?? null) : null;

  const onPlay = () => {
    if (isCurrent) player.toggle();
    else if (history.length) player.playFrom(history, 0, STATIC, progress[`t:${history[0]!.id}`]);
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
        <p className="home-start-sub">{dateLine}</p>
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
              <Icon name="disc" size={28} className="text-muted" />
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

          {nextTrack && (
            <div className="home-hero-next">
              <span className="block h-10 w-10 shrink-0 overflow-hidden rounded-[var(--r2)] bg-white/[0.06]">
                {nextTrack.artworkUrl ? (
                  <img src={artwork(nextTrack.artworkUrl, "large") ?? undefined} alt="" loading="lazy" draggable={false} className="h-full w-full object-cover" />
                ) : (
                  <span className="stipple-night block h-full w-full" />
                )}
              </span>
              <span className="min-w-0">
                <span className="block text-[12px] font-semibold uppercase tracking-wider text-[var(--s-dim)]">{t.nextInQueue}</span>
                <span className="block truncate text-[13px] font-medium text-text" title={nextTrack.title}>
                  {nextTrack.title}
                </span>
                <span className="block truncate text-[12px] text-muted">{nextTrack.artist}</span>
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="home-hero">
          <div className="home-hero-cover">
            <Icon name="search" size={28} className="text-muted" />
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

      {!signedIn && (
        <div className="home-guest-tiles">
          <button type="button" onClick={() => goTo("signin", { name: "signin" })} className="home-guest-tile">
            <Icon name="user" size={22} className="shrink-0 text-[var(--accent)]" />
            <span className="min-w-0">
              <span className="block break-words text-[14px] font-semibold text-text">{t.guestSignInTitle}</span>
              <span className="block break-words text-[12px] text-muted">{t.guestSignInText}</span>
            </span>
          </button>
          <button type="button" onClick={() => goTo("search", { name: "search" })} className="home-guest-tile">
            <Icon name="sparkle" size={22} className="shrink-0 text-[var(--accent)]" />
            <span className="min-w-0">
              <span className="block break-words text-[14px] font-semibold text-text">{t.guestPopularTitle}</span>
              <span className="block break-words text-[12px] text-muted">{t.guestPopularText}</span>
            </span>
          </button>
          <button type="button" onClick={() => go({ name: "import" })} className="home-guest-tile">
            <Icon name="copy" size={22} className="shrink-0 text-[var(--accent)]" />
            <span className="min-w-0">
              <span className="block break-words text-[14px] font-semibold text-text">{t.guestImportTitle}</span>
              <span className="block break-words text-[12px] text-muted">{t.guestImportText}</span>
            </span>
          </button>
        </div>
      )}
    </section>
  );
}
