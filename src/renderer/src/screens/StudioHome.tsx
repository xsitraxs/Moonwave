import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { artwork, type Track } from "@shared/types";
import { useFeed, usePlaylists } from "@/api/queries";
import { HomeStart } from "@/components/home/HomeStart";
import { Avatar, when } from "@/components/social/bits";
import Icon from "@/components/ui/Icon";
import { Screen } from "@/components/ui/Screen";
import { useT } from "@/i18n";
import { dedupeRecentByAlbum } from "@/lib/homeHelpers";
import { useVisibleTracks } from "@/lib/hidden";
import { call } from "@/lib/sky";
import { useAuth } from "@/state/auth";
import { useNav } from "@/state/nav";
import { useCurrentTrack, player, usePlayer } from "@/state/player";
import { useSettings } from "@/state/settings";
import { playShared, playSharedPlaylist, useSocial } from "@/state/social";
import { useUi } from "@/state/ui";
import { startStation } from "./Library";

type Filter = "all" | "tracks" | "playlists" | "stations";
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

function Card({ cover, title, sub, on, playing, onClick }: { cover: string | null; title: string; sub: string; on?: boolean; playing?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} title={`${title} — ${sub}`} className="group min-w-0 text-left">
      <span className="relative block aspect-square overflow-hidden rounded-[var(--r2)] bg-white/[0.06] ring-1 ring-inset ring-white/[0.06] transition-all duration-200 group-hover:ring-white/20">
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
        <span aria-hidden="true" className="absolute inset-0 bg-black/25 opacity-0 transition-opacity motion-color group-hover:opacity-100 group-focus-visible:opacity-100" />
        <span
          className={`s-pp absolute bottom-2.5 right-2.5 h-9 w-9 shadow-md transition-all duration-200 ${
            on ? "opacity-100" : "translate-y-1 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100"
          }`}
        >
          <Icon name={on && playing ? "pause" : "play"} size={18} />
        </span>
      </span>
      <span className="mt-2.5 block truncate text-[15px] font-semibold leading-[1.35] text-text transition-colors motion-color group-hover:text-white">
        {title}
      </span>
      <span className="mt-0.5 block truncate text-[13px] font-normal leading-[1.4] text-muted">{sub}</span>
    </button>
  );
}

function Carousel({ children }: { children: ReactNode }) {
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
    <div className="group/row relative">
      <div ref={ref} className="home-carousel">
        {children}
      </div>
      {canPrev && (
        <button
          type="button"
          onClick={() => step(-1)}
          aria-label={t.previous}
          className="absolute left-1.5 top-[calc(50%-26px)] z-10 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full border border-[var(--s-line2)] bg-black/75 text-text opacity-0 backdrop-blur-md transition-opacity motion-color hover:bg-black/90 focus-visible:opacity-100 group-hover/row:opacity-100"
        >
          <Icon name="back" size={16} />
        </button>
      )}
      {canNext && (
        <button
          type="button"
          onClick={() => step(1)}
          aria-label={t.next}
          className="absolute right-1.5 top-[calc(50%-26px)] z-10 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full border border-[var(--s-line2)] bg-black/75 text-text opacity-0 backdrop-blur-md transition-opacity motion-color hover:bg-black/90 focus-visible:opacity-100 group-hover/row:opacity-100"
        >
          <Icon name="forward" size={16} />
        </button>
      )}
    </div>
  );
}

function TrackCarousel({ tracks }: { tracks: Track[] }) {
  const currentId = usePlayer((s) => s.queue[s.index]?.id ?? null);
  const playing = usePlayer((s) => s.status === "playing" || s.status === "loading");
  return (
    <Carousel>
      {tracks.map((tr, i) => (
        <Card
          key={tr.id}
          cover={tr.artworkUrl}
          title={tr.title}
          sub={tr.artist}
          on={tr.id === currentId}
          playing={playing}
          onClick={() => (tr.id === currentId ? player.toggle() : player.playFrom(tracks, i, STATIC))}
        />
      ))}
    </Carousel>
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
    <section className="mb-7">
      <Heading title={t.friendsListening} />
      <Carousel>
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
      </Carousel>
    </section>
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
    <section className="mb-7">
      <Heading title={t.scListening} />
      <TrackCarousel tracks={tracks} />
    </section>
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
  if (!tracks.length) return null;
  return (
    <section className="mb-7">
      <Heading title={t.newInFeed} action={t.showAll} onAction={onShowAll} />
      <TrackCarousel tracks={tracks} />
    </section>
  );
}

/** Studio home: single hero block on top, consistent cover carousels below. */
export default function StudioHome() {
  const t = useT();
  const open = useNav((s) => s.open);
  const go = useNav((s) => s.go);
  const auth = useAuth((s) => s.status);
  const signedIn = auth?.mode === "session";
  const [filter, setFilter] = useState<Filter>("all");
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

  const filters: [Filter, string][] = [
    ["all", t.all],
    ["tracks", t.tracksTab],
    ["playlists", t.playlists],
    ["stations", t.stations],
  ];

  return (
    <Screen label={t.home}>
      <HomeStart name={auth?.mode === "session" ? auth.user?.username : undefined} signedIn={signedIn} />

      <div className="mb-5 flex items-center gap-3">
        <div className="s-seg" role="tablist">
          {filters.map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={filter === k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {(filter === "all" || filter === "tracks") && recent.length > 0 && (
        <section className="mb-7">
          <Heading title={t.jumpBackIn} action={t.showAll} onAction={() => open("history", { name: "history" })} />
          <TrackCarousel tracks={recent} />
        </section>
      )}

      {(filter === "all" || filter === "tracks") && (
        <>
          <FriendsListening />
          <ScListening />
        </>
      )}

      {filter === "all" && <FromFriends />}

      {(filter === "all" || filter === "tracks") && signedIn && <NewInFeed onShowAll={() => open("feed", { name: "feed" })} />}

      {filter === "playlists" && (
        <section className="mb-7">
          <Heading title={t.playlists} action={t.showAll} onAction={() => open("playlists", { name: "playlists" })} />
          <div className="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-x-4 gap-y-6">
            {playlists.slice(0, 24).map((p) => (
              <Card key={`${p.id}-${p.relation}`} cover={p.artworkUrl} title={p.title} sub={t.tracks(p.trackCount)} onClick={() => go({ name: "playlist", id: p.id })} />
            ))}
          </div>
        </section>
      )}

      {filter === "stations" && (
        <section className="mb-7">
          <Heading title={t.stations} action={t.showAll} onAction={() => open("stations", { name: "stations" })} />
          <div className="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-x-4 gap-y-6">
            {seeds.map((s) => (
              <Card key={s.id} cover={s.artworkUrl} title={t.stationOf(s.title)} sub={t.basedOnTrack} onClick={() => void startStation(s).catch(() => toast(t.stationFailed))} />
            ))}
          </div>
        </section>
      )}
    </Screen>
  );
}
