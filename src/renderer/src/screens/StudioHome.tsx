import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { artwork, type Track } from "@shared/types";
import { useFeed, usePlaylists, useRelated } from "@/api/queries";
import { DjStatusText, DjToggle } from "@/components/dj/bits";
import { HomeStart } from "@/components/home/HomeStart";
import { Avatar, when } from "@/components/social/bits";
import Icon from "@/components/ui/Icon";
import { Screen } from "@/components/ui/Screen";
import { ErrorState } from "@/components/ui/States";
import { useT } from "@/i18n";
import { dedupeRecentByAlbum } from "@/lib/homeHelpers";
import { useVisibleTracks } from "@/lib/hidden";
import { call } from "@/lib/sky";
import { useAuth } from "@/state/auth";
import { useDj } from "@/state/dj";
import { useCanLike, useLiked, toggleLike } from "@/state/likes";
import { useNav } from "@/state/nav";
import { inRoom, useCurrentTrack, player, usePlayer, usePosition } from "@/state/player";
import { useSettings } from "@/state/settings";
import { playShared, playSharedPlaylist, useSocial } from "@/state/social";
import { useUi } from "@/state/ui";
import { startStation } from "./Library";
import { localKey } from "./Local";

const STATIC = { kind: "static" } as const;

function Cover({ url, size }: { url: string | null; size: number }) {
  const src = artwork(url, size <= 60 ? "large" : "t300x300");
  return (
    <span className="block shrink-0 overflow-hidden bg-white/[0.06]" style={{ width: size, height: size }}>
      {src ? <img src={src} alt="" loading="lazy" decoding="async" draggable={false} className="h-full w-full object-cover" /> : <span className="stipple-night block h-full w-full" />}
    </span>
  );
}

function Heading({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <div className="mb-3.5 flex items-baseline gap-4">
      <h2 className="text-[20px] font-semibold leading-[1.25] tracking-[-0.015em] text-text">{title}</h2>
      {action && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="group ml-auto inline-flex items-center gap-1 text-[13px] font-medium text-muted transition-colors motion-color hover:text-text"
        >
          <span>{action}</span>
          <Icon name="forward" size={16} className="transition-transform motion-color group-hover:translate-x-0.5" />
        </button>
      )}
    </div>
  );
}

/** Playback progress on the card of the track that is playing now. */
function CardProgress() {
  const position = usePosition((s) => s.position);
  const durationS = usePlayer((s) => s.duration);
  const pct = durationS > 0 ? Math.max(0, Math.min(100, (position / durationS) * 100)) : 0;
  return (
    <span className="home-card-progress" aria-hidden="true">
      <i style={{ width: `${pct}%` }} />
    </span>
  );
}

function Card({ cover, title, sub, on, playing, badge, track, progress, onClick }: { cover: string | null; title: string; sub: string; on?: boolean; playing?: boolean; badge?: string; track?: Track; progress?: number; onClick: () => void }) {
  const t = useT();
  const liked = useLiked(track?.id);
  const canLike = useCanLike();
  const openMenu = useUi((s) => s.openMenu);
  return (
    <div className="home-card group min-w-0">
      <div className="relative block aspect-square overflow-hidden rounded-[var(--r2)] bg-white/[0.06] ring-1 ring-inset ring-white/[0.06] transition-all duration-200 group-hover:ring-white/20">
        <button type="button" onClick={onClick} aria-label={`${title} — ${sub}`} className="block h-full w-full cursor-pointer">
          {cover ? (
            <img
              src={artwork(cover, "t300x300") ?? undefined}
              alt=""
              loading="lazy"
              decoding="async"
              draggable={false}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <span className="stipple-night block h-full w-full" />
          )}
        </button>
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-black/25 opacity-0 transition-opacity motion-color group-hover:opacity-100 group-focus-within:opacity-100" />
        {badge && <span className="home-card-badge">{badge}</span>}
        {on ? <CardProgress /> : progress !== undefined && progress > 0 && <span className="home-card-progress" aria-hidden="true"><i style={{ width: `${Math.min(100, progress * 100)}%` }} /></span>}
        <span
          aria-hidden="true"
          className={`s-pp pointer-events-none absolute bottom-2.5 right-2.5 h-9 w-9 shadow-md transition-all duration-200 ${
            on ? "opacity-100" : "translate-y-1 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100"
          }`}
        >
          <Icon name={on && playing ? "pause" : "play"} size={18} />
        </span>
        {track && (
          <button
            type="button"
            aria-label={t.moreActions}
            title={t.moreActions}
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              openMenu(rect.left, rect.bottom, track);
            }}
            className="absolute bottom-2 left-2 grid h-9 w-9 place-items-center rounded-full bg-black/65 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
          >
            <span aria-hidden="true" className="text-xl leading-none">⋯</span>
          </button>
        )}
        {track && canLike && (
          <button
            type="button"
            onClick={() => void toggleLike(track)}
            aria-label={liked ? t.unlike : t.like}
            aria-pressed={liked}
            title={liked ? t.unlike : t.like}
            className={`absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full backdrop-blur-md transition-all duration-200 ${
              liked ? "bg-black/55 text-[var(--accent)] opacity-100" : "bg-black/55 text-white opacity-0 hover:text-[var(--accent)] group-hover:opacity-100 group-focus-within:opacity-100"
            }`}
          >
            <Icon name="heart" size={16} filled={liked} />
          </button>
        )}
      </div>
      <button type="button" onClick={onClick} title={`${title} — ${sub}`} className="mt-2.5 block w-full text-left">
        <span className="home-card-title block text-[15px] font-semibold leading-[1.35] text-text transition-colors motion-color group-hover:text-white">
          {title}
        </span>
      </button>
      <span className="mt-0.5 block truncate text-[13px] font-normal leading-[1.4] text-muted">{sub}</span>
    </div>
  );
}

/**
 * A home row: heading with carousel arrows and an optional "show all" action, cards scrolling under it
 * (scroll-snap, fade mask, no native scrollbar — home.css).
 */
function Row({ title, action, onAction, children }: { title: string; action?: string; onAction?: () => void; children: ReactNode }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const sync = () => {
      setCanPrev(el.scrollLeft > 4);
      setCanNext(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
    };
    sync();
    el.addEventListener("scroll", sync, { passive: true });
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", sync);
      ro.disconnect();
    };
  }, [children]);

  const step = (dir: -1 | 1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(300, Math.round(el.clientWidth * 0.75)), behavior: "smooth" });
  };

  return (
    <section className="mb-7">
      <div className="mb-3.5 flex items-center gap-2">
        <h2 className="text-[20px] font-semibold leading-[1.25] tracking-[-0.015em] text-text">{title}</h2>
        <span className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => step(-1)}
            disabled={!canPrev}
            aria-label={t.previous}
            className="grid h-7 w-7 place-items-center rounded-full text-muted transition-colors motion-color hover:bg-white/[0.07] hover:text-text disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted"
          >
            <Icon name="back" size={16} />
          </button>
          <button
            type="button"
            onClick={() => step(1)}
            disabled={!canNext}
            aria-label={t.next}
            className="grid h-7 w-7 place-items-center rounded-full text-muted transition-colors motion-color hover:bg-white/[0.07] hover:text-text disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted"
          >
            <Icon name="forward" size={16} />
          </button>
          {action && onAction && (
            <button
              type="button"
              onClick={onAction}
              className="group ml-1 inline-flex items-center gap-1 text-[13px] font-medium text-muted transition-colors motion-color hover:text-text"
            >
              <span>{action}</span>
              <Icon name="forward" size={16} className="transition-transform motion-color group-hover:translate-x-0.5" />
            </button>
          )}
        </span>
      </div>
      <div ref={ref} className="home-carousel">
        {children}
      </div>
    </section>
  );
}

function RowLoading({ title }: { title: string }) {
  const t = useT();
  return (
    <section className="mb-7" aria-label={title} aria-busy="true">
      <Heading title={title} />
      <span className="sr-only">{t.loadingMore}</span>
      <div className="home-carousel" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => <div key={i}><div className="skeleton aspect-square rounded-[var(--r2)]" /><div className="skeleton mt-3 h-4 w-3/4 rounded" /></div>)}
      </div>
    </section>
  );
}

function RowError({ title, error, retry }: { title: string; error: unknown; retry: () => void }) {
  return <section className="mb-7"><Heading title={title} /><ErrorState compact error={error} onRetry={retry} /></section>;
}

function TrackCards({ tracks, resume = false }: { tracks: Track[]; resume?: boolean }) {
  const t = useT();
  const savedProgress = useSettings((s) => s.trackProgress);
  const currentId = usePlayer((s) => s.queue[s.index]?.id ?? null);
  const playing = usePlayer((s) => s.status === "playing" || s.status === "loading");
  return (
    <>
      {tracks.map((tr, i) => (
        <Card
          key={tr.id}
          cover={tr.artworkUrl}
          title={tr.title}
          sub={tr.artist}
          on={tr.id === currentId}
          playing={playing}
          badge={tr.id === currentId ? t.nowPlaying : undefined}
          track={tr}
          progress={resume && tr.durationMs > 0 ? (savedProgress[`t:${tr.id}`] ?? 0) / (tr.durationMs / 1000) : undefined}
          onClick={() => {
            if (tr.id === currentId) return player.toggle();
            const position = resume && !inRoom() ? savedProgress[`t:${tr.id}`] : undefined;
            const startAt = position && Number.isFinite(position) && position > 0 && position < tr.durationMs / 1000 - 5 ? position : undefined;
            player.playFrom(tracks, i, STATIC, startAt);
          }}
        />
      ))}
    </>
  );
}

/** Tracks like the one playing now: the row that fills the space under the hero. */
function SimilarRow({ current }: { current: Track }) {
  const t = useT();
  const q = useRelated(current.id);
  const tracks = useVisibleTracks(q.data ?? []).slice(0, 12);
  if (q.isPending) return <RowLoading title={t.similarToPlaying} />;
  if (q.isError && !q.data) return <RowError title={t.similarToPlaying} error={q.error} retry={() => void q.refetch()} />;
  if (!tracks.length) return null;
  return (
    <Row title={t.similarToPlaying}>
      <TrackCards tracks={tracks} />
    </Row>
  );
}

/** What friends are playing right now (those who share it): a click plays it here too. */
function FriendsListening() {
  const t = useT();
  const toast = useUi((s) => s.showToast);
  const now = useSocial((s) => s.now);
  const friends = useSocial((s) => s.friends?.friends);
  const currentId = usePlayer((s) => s.queue[s.index]?.id ?? null);
  const playing = usePlayer((s) => s.status === "playing" || s.status === "loading");
  const list = Object.entries(now);
  if (!list.length) return null;
  const name = (code: string) => friends?.find((f) => f.code === code)?.name || code;
  return (
    <Row title={t.friendsListening}>
      {list.map(([code, tr], i) => (
        <Card
          key={code}
          cover={tr.artworkUrl}
          title={tr.title}
          sub={name(code)}
          on={tr.id === currentId}
          playing={playing}
          onClick={() =>
            tr.id === currentId
              ? player.toggle()
              : void playShared(
                  list.map((x) => x[1]),
                  i,
                ).catch(() => toast(t.trackGone))
          }
        />
      ))}
    </Row>
  );
}

/**
 * What was played in Moonwave lately, by anyone who shares it anonymously.
 */
function ScListening() {
  const t = useT();
  const available = useSocial((s) => !!s.status?.available);
  const q = useQuery({ queryKey: ["sc-listening"], queryFn: () => call("social:listening"), enabled: available, staleTime: 30_000, refetchInterval: 60_000 });
  const ids = (q.data ?? []).map((x) => x.id);
  const tq = useQuery({ queryKey: ["sc-listening-tracks", ids.join(",")], queryFn: () => call("data:tracks", ids), enabled: ids.length > 0, staleTime: 5 * 60_000 });
  const ordered = useMemo(() => {
    const byId = new Map((tq.data ?? []).map((tr) => [tr.id, tr]));
    return (q.data ?? []).map((x) => byId.get(x.id)).filter((tr): tr is Track => !!tr);
  }, [tq.data, q.data]);
  const tracks = useVisibleTracks(ordered).slice(0, 12);
  if (!tracks.length) return null;
  return (
    <Row title={t.scListening}>
      <TrackCards tracks={tracks} />
    </Row>
  );
}

/** Tracks friends sent lately: a click plays from there on. */
function FromFriends() {
  const t = useT();
  const open = useNav((s) => s.open);
  const toast = useUi((s) => s.showToast);
  const joined = useSocial((s) => !!s.status?.profile);
  const arrived = useSocial((s) => s.arrived.length);
  const friends = useSocial((s) => s.friends?.friends);
  const currentId = usePlayer((s) => s.queue[s.index]?.id ?? null);
  const q = useQuery({ queryKey: ["social-recent", arrived], queryFn: () => call("social:recent"), enabled: joined, staleTime: 30_000 });
  const list = (q.data ?? []).slice(0, 5);
  if (!joined || !list.length) return null;
  const name = (code?: string) => friends?.find((f) => f.code === code)?.name || code || "";
  return (
    <section className="mb-7">
      <Heading title={t.fromFriends} action={t.openInbox} onAction={() => open("inbox", { name: "inbox" })} />
      <div>
        {list.map((m, i) => (
          <button
            key={m.id}
            type="button"
            onClick={() =>
              void (
                m.playlist
                  ? playSharedPlaylist(m)
                  : playShared(
                      list
                        .slice(i)
                        .filter((x) => !x.playlist)
                        .map((x) => x.track),
                      0,
                      [m.id],
                    )
              ).catch(() => toast(t.trackGone))
            }
            className="flex h-12 w-full items-center gap-3 rounded-[var(--r2)] border-b border-[var(--s-line)] px-2 text-left hover:bg-[var(--s-hover)]"
          >
            <Cover url={m.track.artworkUrl} size={36} />
            <span className="min-w-0 flex-1">
              <span className={`block truncate text-[15px] font-semibold ${!m.playlist && m.track.id === currentId ? "text-white" : "text-text"}`}>
                {m.playlist?.title ?? m.track.title}
              </span>
              <span className="block truncate text-[13px] font-normal text-muted">
                {m.playlist ? t.sharedPlaylist(m.playlist.ids.length) : m.track.artist}
              </span>
            </span>
            <span className="flex w-44 items-center gap-2 text-[13px] text-muted">
              <Avatar name={name(m.from)} code={m.from ?? ""} size={22} />
              <span className="truncate">{t.fromName(name(m.from))}</span>
            </span>
            <span className="w-14 pr-1 text-right text-[13px] tabular-nums text-[var(--s-dim)]">{when(m.sent)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function NewInFeed({ onShowAll }: { onShowAll: () => void }) {
  const t = useT();
  const q = useFeed(true);
  const all = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  const tracks = useVisibleTracks(all).slice(0, 14);
  if (q.isPending) return <RowLoading title={t.newInFeed} />;
  if (q.isError && !q.data) return <RowError title={t.newInFeed} error={q.error} retry={() => void q.refetch()} />;
  if (!tracks.length) return null;
  return (
    <Row title={t.newInFeed} action={t.showAll} onAction={onShowAll}>
      <TrackCards tracks={tracks} />
    </Row>
  );
}

/** Local library is already sorted by date added, newest first. */
function RecentlyAddedLocal() {
  const t = useT();
  const open = useNav((s) => s.open);
  const q = useQuery({ queryKey: localKey, queryFn: () => call("local:list") });
  const tracks = useVisibleTracks(q.data ?? []).slice(0, 12);
  if (q.isPending) return <RowLoading title={t.recentlyAddedLocal} />;
  if (q.isError && !q.data) return <RowError title={t.recentlyAddedLocal} error={q.error} retry={() => void q.refetch()} />;
  if (!tracks.length) return null;
  return <Row title={t.recentlyAddedLocal} action={t.showAll} onAction={() => open("local", { name: "local" })}><TrackCards tracks={tracks} /></Row>;
}

/** The DJ's card on Home: one line of state, start/stop, a way to the page. */
function DjBanner() {
  const t = useT();
  const open = useNav((s) => s.open);
  const active = useDj((s) => s.active);
  const status = useDj((s) => s.status);
  const seed = useDj((s) => s.seeds[0] ?? null);
  const origin = useDj((s) => s.origin);
  const current = useCurrentTrack();
  const live = active || status === "error" || status === "empty" || status === "exhausted";
  return (
    <section aria-label={t.dj} className="mb-7 flex items-center gap-3 rounded-[var(--r2)] bg-white/[0.04] px-4 py-3 ring-1 ring-inset ring-white/[0.06]">
      <Icon name="dj" size={22} className={`shrink-0 ${active ? "text-[var(--accent)]" : "text-muted"}`} />
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-semibold text-text">{t.dj}</div>
        {active && status === "loading" ? (
          <div className="truncate text-[13px] text-muted">{t.djLoading}</div>
        ) : active && origin?.kind === "likes" ? (
          <div className="truncate text-[13px] text-muted">{t.djLeadsLikes(current?.title ?? null)}</div>
        ) : active && origin?.kind === "artist" ? (
          <div className="truncate text-[13px] text-muted">{t.djLeadsArtist(origin.name, current?.title ?? null)}</div>
        ) : active && origin?.kind === "playlist" ? (
          <div className="truncate text-[13px] text-muted">{t.djLeadsPlaylist(origin.title, current?.title ?? null)}</div>
        ) : active && seed?.title ? (
          <div className="truncate text-[13px] text-muted">{t.djLeads(seed.title, current?.title ?? null)}</div>
        ) : live ? (
          <DjStatusText className="block text-[13px] text-muted" />
        ) : (
          <div className="truncate text-[13px] text-muted">{t.djHint}</div>
        )}
      </div>
      <DjToggle />
      <button type="button" onClick={() => open("dj", { name: "dj" })} className="shrink-0 text-[13px] font-medium text-muted transition-colors motion-color hover:text-text">
        {t.djOpenPage}
      </button>
    </section>
  );
}

/** Studio home: compact hero on top, rows of carousels below — no filter chips, no dead space. */
export default function StudioHome() {
  const t = useT();
  const open = useNav((s) => s.open);
  const go = useNav((s) => s.go);
  const auth = useAuth((s) => s.status);
  const signedIn = auth?.mode === "session";
  const history = useSettings((s) => s.history);
  const current = useCurrentTrack();
  const visibleHistory = useVisibleTracks(history);
  const heroTrack = current ?? history[0] ?? null;
  const recent = useMemo(() => dedupeRecentByAlbum(visibleHistory, heroTrack).slice(0, 12), [visibleHistory, heroTrack]);
  const pq = usePlaylists("me", signedIn);
  const playlists = useMemo(() => pq.data?.pages.flatMap((p) => p.items) ?? [], [pq.data]);
  const seeds = useMemo(() => {
    const seen = new Set<number>();
    return [...(current ? [current] : []), ...history].filter((s) => !seen.has(s.id) && seen.add(s.id)).slice(0, 12);
  }, [current, history]);
  const toast = useUi((s) => s.showToast);

  return (
    <Screen label={t.home}>
      <HomeStart name={auth?.mode === "session" ? auth.user?.username : undefined} signedIn={signedIn} />

      <DjBanner />

      {recent.length > 0 && (
        <Row title={t.jumpBackIn} action={t.showAll} onAction={() => open("history", { name: "history" })}>
          <TrackCards tracks={recent} resume />
        </Row>
      )}

      {current && <SimilarRow current={current} />}

      {signedIn && <NewInFeed onShowAll={() => open("feed", { name: "feed" })} />}

      <RecentlyAddedLocal />

      {signedIn && pq.isPending && <RowLoading title={t.playlists} />}
      {signedIn && pq.isError && !pq.data && <RowError title={t.playlists} error={pq.error} retry={() => void pq.refetch()} />}
      {playlists.length > 0 && (
        <Row title={t.playlists} action={t.showAll} onAction={() => open("playlists", { name: "playlists" })}>
          {playlists.slice(0, 12).map((p) => (
            <Card key={`${p.id}-${p.relation}`} cover={p.artworkUrl} title={p.title} sub={t.tracks(p.trackCount)} onClick={() => go({ name: "playlist", id: p.id })} />
          ))}
        </Row>
      )}

      {seeds.length > 0 && (
        <Row title={t.stations} action={t.showAll} onAction={() => open("stations", { name: "stations" })}>
          {seeds.map((s) => (
            <Card key={s.id} cover={s.artworkUrl} title={t.stationOf(s.title)} sub={t.basedOnTrack} onClick={() => void startStation(s).catch(() => toast(t.stationFailed))} />
          ))}
        </Row>
      )}

      <FriendsListening />
      <ScListening />
      <FromFriends />
    </Screen>
  );
}
