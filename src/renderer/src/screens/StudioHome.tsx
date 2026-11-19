import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { artwork, isLocalTrack, type Track } from "@shared/types";
import { useFeed, usePlaylists } from "@/api/queries";
import { useHomeActions, HomeStart } from "@/components/home/HomeStart";
import { Avatar, when } from "@/components/social/bits";
import Icon from "@/components/ui/Icon";
import { Screen } from "@/components/ui/Screen";
import { useT } from "@/i18n";
import { duration } from "@/lib/format";
import { useVisibleTracks } from "@/lib/hidden";
import { call } from "@/lib/sky";
import { useAuth } from "@/state/auth";
import { toggleLike, useCanLike, useLiked } from "@/state/likes";
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
    <div className="mb-2.5 flex items-baseline">
      <h2 className="text-[14px] font-semibold text-text">{title}</h2>
      {action && (
        <button type="button" onClick={onAction} className="ml-auto text-[12.5px] text-[var(--s-dim)] hover:text-text">
          {action}
        </button>
      )}
    </div>
  );
}

function Card({ cover, title, sub, on, playing, onClick }: { cover: string | null; title: string; sub: string; on?: boolean; playing?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} title={`${title} — ${sub}`} className="group min-w-0 text-left">
      <span className="relative block aspect-square overflow-hidden rounded-[var(--r2)] bg-white/[0.06] ring-1 ring-inset ring-white/[0.06] transition-all duration-200 group-hover:ring-white/20">
        {cover ? <img src={artwork(cover, "t300x300") ?? undefined} alt="" loading="lazy" decoding="async" draggable={false} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" /> : <span className="stipple-night block h-full w-full" />}
        <span aria-hidden="true" className="absolute inset-0 bg-black/25 opacity-0 transition-opacity motion-color group-hover:opacity-100 group-focus-visible:opacity-100" />
        <span className={`s-pp absolute bottom-2 right-2 h-8 w-8 shadow-md transition-all duration-200 ${on ? "opacity-100" : "translate-y-1 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100"}`}>
          <Icon name={on && playing ? "pause" : "play"} size={14} />
        </span>
      </span>
      <span className={`mt-2 block truncate text-[12.5px] font-semibold transition-colors motion-color ${on ? "text-[var(--accent)]" : "text-text group-hover:text-white"}`}>{title}</span>
      <span className="mt-px block truncate text-[12px] text-[var(--s-dim)]">{sub}</span>
    </button>
  );
}

/** a grid that keeps one row: as many as fit */
const ONE_ROW = "grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] grid-rows-[auto] [grid-auto-rows:0] gap-x-3.5 overflow-hidden";

function Recent({ tracks }: { tracks: Track[] }) {
  const currentId = usePlayer((s) => s.queue[s.index]?.id ?? null);
  const playing = usePlayer((s) => s.status === "playing" || s.status === "loading");
  return (
    <div className={ONE_ROW}>
      {tracks.map((tr, i) => (
        <Card key={tr.id} cover={tr.artworkUrl} title={tr.title} sub={tr.artist} on={tr.id === currentId} playing={playing} onClick={() => (tr.id === currentId ? player.toggle() : player.playFrom(tracks, i, STATIC))} />
      ))}
    </div>
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
    <section className="mb-6">
      <Heading title={t.friendsListening} />
      <div className={ONE_ROW}>
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
      </div>
    </section>
  );
}

/**
 * What was played in Moonwave lately, by anyone who shares it anonymously: the server keeps only SoundCloud ids, so
 * titles and covers come from SoundCloud (and hidden artists and words stay hidden).
 */
function ScListening() {
  const t = useT();
  const available = useSocial((s) => !!s.status?.available);
  const q = useQuery({ queryKey: ["sc-listening"], queryFn: () => call("social:listening"), enabled: available, staleTime: 30_000, refetchInterval: 60_000 });
  const ids = (q.data ?? []).map((x) => x.id);
  const tq = useQuery({ queryKey: ["sc-listening-tracks", ids.join(",")], queryFn: () => call("data:tracks", ids), enabled: ids.length > 0, staleTime: 5 * 60_000 });
  const ordered = useMemo(() => {
    const byId = new Map((tq.data ?? []).map((tr) => [tr.id, tr]));
    // newest first, as the server sends them
    return (q.data ?? []).map((x) => byId.get(x.id)).filter((tr): tr is Track => !!tr);
  }, [tq.data, q.data]);
  const tracks = useVisibleTracks(ordered).slice(0, 12);
  if (!tracks.length) return null;
  return (
    <section className="mb-6">
      <Heading title={t.scListening} />
      <Recent tracks={tracks} />
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
    <section className="mb-6">
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
            className="flex h-11 w-full items-center gap-3 border-b border-[var(--s-line)] text-left text-[12.5px] hover:bg-[var(--s-hover)]"
          >
            <Cover url={m.track.artworkUrl} size={32} />
            <span className="min-w-0 flex-1">
              <span className={`block truncate font-semibold ${!m.playlist && m.track.id === currentId ? "text-[var(--accent)]" : "text-text"}`}>{m.playlist?.title ?? m.track.title}</span>
              <span className="block truncate text-[11.5px] text-[var(--s-dim)]">{m.playlist ? t.sharedPlaylist(m.playlist.ids.length) : m.track.artist}</span>
            </span>
            <span className="flex w-44 items-center gap-2 text-muted">
              <Avatar name={name(m.from)} code={m.from ?? ""} size={22} />
              <span className="truncate">{t.fromName(name(m.from))}</span>
            </span>
            <span className="w-14 pr-1 text-right text-[11.5px] tabular-nums text-[var(--s-dim)]">{when(m.sent)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function FeedRow({ track, index, tracks, current, playing }: { track: Track; index: number; tracks: Track[]; current: boolean; playing: boolean }) {
  const t = useT();
  const go = useNav((s) => s.go);
  const openMenu = useUi((s) => s.openMenu);
  const canLike = useCanLike();
  const localLikes = useSettings((s) => s.prefs.localLikes);
  const showLike = canLike && (!isLocalTrack(track.id) || localLikes);
  const liked = useLiked(track.id);
  const playOrToggle = () => (current ? player.toggle() : player.playFrom(tracks, index, STATIC));
  const actionBtn = "grid h-7 w-7 place-items-center rounded-full text-muted transition-colors motion-color hover:bg-white/[0.08] hover:text-text";

  return (
    <div
      tabIndex={0}
      onDoubleClick={playOrToggle}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && e.key === "Enter") playOrToggle();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        openMenu(e.clientX, e.clientY, track);
      }}
      className="group flex h-12 w-full items-center gap-3 rounded-[var(--r2)] border-b border-[var(--s-line)] px-2 text-left text-[12.5px] transition-colors motion-color hover:bg-white/[0.06] focus-within:bg-white/[0.05] focus-visible:bg-white/[0.06]"
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label={current && playing ? t.pause : `${t.play}: ${track.title}`}
        onClick={playOrToggle}
        className="grid h-7 w-6 shrink-0 place-items-center text-[12px] tabular-nums text-[var(--s-dim)]"
      >
        {current ? (
          <>
            <span className={`text-sm text-[var(--accent)] group-hover:hidden ${playing ? "" : "opacity-70"}`} aria-hidden="true">
              ✦
            </span>
            <Icon name={playing ? "pause" : "play"} size={14} className="hidden text-[var(--accent)] group-hover:block" />
          </>
        ) : (
          <>
            <span className="group-hover:hidden">{index + 1}</span>
            <Icon name="play" size={14} className="hidden text-text group-hover:block" />
          </>
        )}
      </button>
      <button
        type="button"
        tabIndex={-1}
        aria-label={current && playing ? t.pause : `${t.play}: ${track.title}`}
        onClick={playOrToggle}
        className="relative shrink-0 overflow-hidden rounded-[4px] ring-1 ring-inset ring-white/[0.06] transition-all group-hover:ring-white/20"
      >
        <Cover url={track.artworkUrl} size={34} />
        <span aria-hidden="true" className="absolute inset-0 grid place-items-center bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100">
          <Icon name={current && playing ? "pause" : "play"} size={13} />
        </span>
      </button>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => go({ name: "track", id: track.id })}
          className={`block max-w-full truncate text-left font-semibold hover:underline ${current ? "text-[var(--accent)]" : "text-text"}`}
        >
          {track.title}
        </button>
        <button
          type="button"
          onClick={() => go({ name: "profile", userId: track.user.id })}
          className="block max-w-full truncate text-left text-[12px] text-[var(--s-dim)] hover:text-text hover:underline"
        >
          {track.artist}
        </button>
      </div>
      <div className="flex items-center gap-0.5 opacity-0 transition-opacity motion-color group-focus-within:opacity-100 group-hover:opacity-100">
        {showLike && (
          <button
            type="button"
            aria-label={liked ? t.unlike : t.like}
            title={liked ? t.unlike : t.like}
            aria-pressed={liked}
            onClick={() => void toggleLike(track)}
            className={`${actionBtn} ${liked ? "!text-[var(--accent)]" : ""}`}
          >
            <Icon name="heart" size={15} filled={liked} />
          </button>
        )}
        <button type="button" aria-label={t.playNext} title={t.playNext} onClick={() => player.playNext(track)} className={actionBtn}>
          <Icon name="playNext" size={15} />
        </button>
        <button type="button" aria-label={t.addToQueue} title={t.addToQueue} onClick={() => player.addToQueue(track)} className={actionBtn}>
          <Icon name="queue" size={15} />
        </button>
        <button
          type="button"
          aria-label={t.moreActions}
          title={t.moreActions}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            openMenu(r.right, r.bottom + 4, track);
          }}
          className={actionBtn}
        >
          <Icon name="more" size={15} />
        </button>
      </div>
      <span className="w-12 pr-1 text-right text-[12px] tabular-nums text-[var(--s-dim)]">{duration(track.durationMs)}</span>
    </div>
  );
}

function FeedRows() {
  const t = useT();
  const q = useFeed(true);
  const all = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  const tracks = useVisibleTracks(all).slice(0, 8);
  const currentId = usePlayer((s) => s.queue[s.index]?.id ?? null);
  const playing = usePlayer((s) => s.status === "playing" || s.status === "loading");
  if (!tracks.length) return null;
  return (
    <div>
      {tracks.map((tr, i) => (
        <FeedRow key={tr.id} track={tr} index={i} tracks={tracks} current={tr.id === currentId} playing={playing} />
      ))}
      <p className="sr-only">{t.feed}</p>
    </div>
  );
}

/** Studio home: the start block answers "where am I / what can I do / what next"; the rest is browsable music. */
export default function StudioHome() {
  const t = useT();
  const open = useNav((s) => s.open);
  const go = useNav((s) => s.go);
  const auth = useAuth((s) => s.status);
  const signedIn = auth?.mode === "session";
  const [filter, setFilter] = useState<Filter>("all");
  const history = useSettings((s) => s.history);
  const current = useCurrentTrack();
  const recent = useVisibleTracks(history).slice(0, 12);
  const pq = usePlaylists("me", signedIn);
  const playlists = useMemo(() => pq.data?.pages.flatMap((p) => p.items) ?? [], [pq.data]);
  const seeds = useMemo(() => {
    const seen = new Set<number>();
    return [...(current ? [current] : []), ...history].filter((s) => !seen.has(s.id) && seen.add(s.id)).slice(0, 12);
  }, [current, history]);
  const toast = useUi((s) => s.showToast);
  const { primary, secondary, hasMusic } = useHomeActions();

  const filters: [Filter, string][] = [
    ["all", t.all],
    ["tracks", t.tracksTab],
    ["playlists", t.playlists],
    ["stations", t.stations],
  ];

  return (
    <Screen label={t.home}>
      <HomeStart name={auth?.mode === "session" ? auth.user?.username : undefined} signedIn={signedIn} hasMusic={hasMusic} primary={primary} secondary={secondary} />

      <div className="mb-4 flex items-center gap-3">
        <span className="s-lbl">{t.homeBrowse}</span>
        <div className="s-seg ml-auto" role="tablist">
          {filters.map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={filter === k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {(filter === "all" || filter === "tracks") && recent.length > 0 && (
        <section className="mb-6">
          <Heading title={t.jumpBackIn} action={t.showAll} onAction={() => open("history", { name: "history" })} />
          <Recent tracks={recent} />
        </section>
      )}

      {(filter === "all" || filter === "tracks") && (
        <>
          <FriendsListening />
          <ScListening />
        </>
      )}

      {filter === "all" && <FromFriends />}

      {(filter === "all" || filter === "tracks") && signedIn && (
        <section className="mb-6">
          <Heading title={t.newInFeed} action={t.showAll} onAction={() => open("feed", { name: "feed" })} />
          <FeedRows />
        </section>
      )}

      {filter === "playlists" && (
        <section className="mb-6">
          <Heading title={t.playlists} action={t.showAll} onAction={() => open("playlists", { name: "playlists" })} />
          <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-x-3.5 gap-y-5">
            {playlists.slice(0, 24).map((p) => (
              <Card key={`${p.id}-${p.relation}`} cover={p.artworkUrl} title={p.title} sub={t.tracks(p.trackCount)} onClick={() => go({ name: "playlist", id: p.id })} />
            ))}
          </div>
        </section>
      )}

      {filter === "stations" && (
        <section className="mb-6">
          <Heading title={t.stations} action={t.showAll} onAction={() => open("stations", { name: "stations" })} />
          <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-x-3.5 gap-y-5">
            {seeds.map((s) => (
              <Card key={s.id} cover={s.artworkUrl} title={t.stationOf(s.title)} sub={t.basedOnTrack} onClick={() => void startStation(s).catch(() => toast(t.stationFailed))} />
            ))}
          </div>
        </section>
      )}
    </Screen>
  );
}
