import { useEffect, useMemo, useRef, useState } from "react";
import { artwork, type Playlist, type QueueSource, type User } from "@shared/types";
import { useSearchPlaylists, useSearchSuggestions, useSearchTracks, useSearchUsers } from "@/api/queries";
import { DjStartGenreButton } from "@/components/dj/bits";
import TrackList from "@/components/tracks/TrackList";
import Icon from "@/components/ui/Icon";
import { Screen, ScreenTitle } from "@/components/ui/Screen";
import { EmptyState, ErrorState, Loading } from "@/components/ui/States";
import { errorText, numberLocale, useT } from "@/i18n";
import { useVisibleTracks } from "@/lib/hidden";
import { looksLikeLink, openLink } from "@/lib/links";
import { removeFromSearchHistory } from "@/lib/searchHistory";
import { errorCode } from "@/lib/sky";
import { useDj } from "@/state/dj";
import { useNav } from "@/state/nav";
import { player, usePlayer } from "@/state/player";
import { useSettings } from "@/state/settings";
import { useUi } from "@/state/ui";
import { useViewState } from "@/state/viewState";

type SearchTab = "all" | "tracks" | "playlists" | "users";

const QUICK_GENRES = ["Electronic", "Hip-Hop", "Lo-Fi", "Phonk", "Ambient", "Indie", "Rock", "House"] as const;
const ONE_ROW = "grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] grid-rows-[auto] [grid-auto-rows:0] gap-x-3.5 overflow-hidden";

function SectionHead({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <div className="mb-3 flex items-baseline gap-3">
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

function Sentinel({ count, hasMore, loading, onMore }: { count: number; hasMore: boolean; loading: boolean; onMore: () => void }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !hasMore || loading) return;
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && onMore(), { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [count, hasMore, loading, onMore]);
  return (
    <>
      <div ref={ref} className="h-px" />
      {loading && <p className="py-4 text-center font-type text-sm text-muted">{t.loadingMore}</p>}
    </>
  );
}

function ArtistCard({ user, onOpen }: { user: User; onOpen: () => void }) {
  const t = useT();
  return (
    <button type="button" onClick={onOpen} title={user.username} className="group min-w-0 text-center">
      <span className="mx-auto block aspect-square w-full overflow-hidden rounded-full bg-white/[0.06] shadow-[0_8px_20px_rgba(0,0,0,0.3)] transition-transform motion-color group-hover:-translate-y-0.5 motion-reduce:group-hover:translate-y-0">
        {user.avatarUrl ? (
          <img src={artwork(user.avatarUrl, "t300x300") ?? undefined} alt="" loading="lazy" decoding="async" draggable={false} className="h-full w-full object-cover" />
        ) : (
          <span className="stipple-night block h-full w-full" />
        )}
      </span>
      <span className="mt-2 block truncate text-[12.5px] font-semibold text-text">{user.username}</span>
      {user.followers !== null && <span className="mt-px block truncate text-[11.5px] text-[var(--s-dim)]">{t.followers(user.followers.toLocaleString(numberLocale()))}</span>}
    </button>
  );
}

function PlaylistTile({ playlist, onOpen }: { playlist: Playlist; onOpen: () => void }) {
  const t = useT();
  return (
    <button type="button" onClick={onOpen} title={`${playlist.title} — ${playlist.user.username}`} className="group min-w-0 text-left">
      <span className="relative block aspect-square overflow-hidden rounded-[var(--r2)] bg-white/[0.06]">
        {playlist.artworkUrl ? (
          <img src={artwork(playlist.artworkUrl, "t300x300") ?? undefined} alt="" loading="lazy" decoding="async" draggable={false} className="h-full w-full object-cover" />
        ) : (
          <span className="stipple-night block h-full w-full" />
        )}
        <span aria-hidden="true" className="absolute inset-0 bg-black/20 opacity-0 transition-opacity motion-color group-hover:opacity-100 group-focus-visible:opacity-100" />
      </span>
      <span className="mt-2 block truncate text-[12.5px] font-semibold text-text">{playlist.title}</span>
      <span className="mt-px block truncate text-[12px] text-[var(--s-dim)]">
        {playlist.user.username} · {t.tracks(playlist.trackCount)}
      </span>
    </button>
  );
}

/** Search across tracks, playlists and artists, with live suggestions and clean explicit history. */
export default function Search() {
  const t = useT();
  const go = useNav((s) => s.go);
  const open = useNav((s) => s.open);
  const toast = useUi((s) => s.showToast);
  const [text, setText] = useViewState("text", "");
  const [query, setQuery] = useViewState("query", "");
  const [tab, setTab] = useViewState<SearchTab>("tab", "all");
  const [suggestQuery, setSuggestQuery] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const studio = useSettings((s) => s.prefs.look.design === "studio");
  const input = useRef<HTMLInputElement>(null);

  const history = useSettings((s) => s.searchHistory);
  const playHistory = useSettings((s) => s.history);
  const saveSettings = useSettings((s) => s.save);
  const recordSearch = useSettings((s) => s.recordSearch);
  const recentTracks = useVisibleTracks(playHistory).slice(0, 12);
  const currentId = usePlayer((s) => s.queue[s.index]?.id ?? null);
  const playing = usePlayer((s) => s.status === "playing" || s.status === "loading");

  const trimmedText = text.trim();
  const isLink = looksLikeLink(text);
  const activeQuery = query.trim();
  const hasQuery = !isLink && activeQuery.length >= 2;

  const tracksQ = useSearchTracks(activeQuery, hasQuery && (tab === "all" || tab === "tracks"));
  const playlistsQ = useSearchPlaylists(activeQuery, hasQuery && (tab === "all" || tab === "playlists"));
  const usersQ = useSearchUsers(activeQuery, hasQuery && (tab === "all" || tab === "users"));
  const suggestQ = useSearchSuggestions(suggestQuery, !isLink && trimmedText.length >= 2 && suggestQuery.length >= 2);

  const tracks = useMemo(() => tracksQ.data?.pages.flatMap((p) => p.items) ?? [], [tracksQ.data]);
  const playlists = useMemo(() => playlistsQ.data?.pages.flatMap((p) => p.items) ?? [], [playlistsQ.data]);
  const users = useMemo(() => usersQ.data?.pages.flatMap((p) => p.items) ?? [], [usersQ.data]);
  const suggestions = useMemo(
    () => (suggestQ.data ?? []).filter((s) => s.trim() && s.toLowerCase() !== activeQuery.toLowerCase()).slice(0, 6),
    [suggestQ.data, activeQuery],
  );

  const cursor = tracksQ.data?.pages[tracksQ.data.pages.length - 1]?.next ?? null;
  const source = useMemo<QueueSource>(() => ({ kind: "search", query: activeQuery, cursor }), [activeQuery, cursor]);

  const idle = !hasQuery && !trimmedText;

  const commit = (term: string) => {
    const clean = term.trim();
    if (idle) setTab("all");
    setText(clean);
    setQuery(clean);
    recordSearch(clean);
  };

  useEffect(() => {
    if (text.trim()) return;
    if (!studio) input.current?.focus();
    else document.querySelector<HTMLInputElement>("[data-titlebar-search] input")?.focus();
    // focus only on initial entry when empty
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studio]);

  useEffect(() => {
    if (isLink) return;
    const trimmed = text.trim();
    const suggestTimer = window.setTimeout(() => setSuggestQuery(trimmed), trimmed ? 200 : 0);
    const queryTimer = window.setTimeout(() => setQuery(trimmed), trimmed ? 350 : 0);
    return () => {
      window.clearTimeout(suggestTimer);
      window.clearTimeout(queryTimer);
    };
  }, [text, isLink, setQuery]);

  const onSubmit = async () => {
    if (!looksLikeLink(text)) {
      const clean = text.trim();
      setQuery(clean);
      recordSearch(clean);
      return;
    }
    setLinkError(null);
    try {
      await openLink(text);
    } catch (err) {
      setLinkError(errorText(t, errorCode(err)));
    }
  };

  const tabs: [SearchTab, string][] = [
    ["all", t.all],
    ["tracks", t.tracksTab],
    ["playlists", t.playlists],
    ["users", t.artists],
  ];

  const anyPending = tracksQ.isPending || playlistsQ.isPending || usersQ.isPending;
  const hasAnyResult = tracks.length > 0 || playlists.length > 0 || users.length > 0;
  const anyError = tracksQ.isError || playlistsQ.isError || usersQ.isError;

  return (
    <Screen label={t.search}>
      <div className="min-w-0">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <ScreenTitle>{t.search.toLowerCase()}</ScreenTitle>
          {hasQuery && (
            <div className="s-seg mb-3 ml-auto" role="tablist">
              {tabs.map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

        {idle && <p className="-mt-3 mb-6 text-[13px] text-[var(--s-dim)]">{t.searchLead}</p>}

        <form
          className={`mb-6 max-w-xl items-center gap-3 ${studio ? "hidden" : "flex"}`}
          onSubmit={(e) => {
            e.preventDefault();
            void onSubmit();
          }}
        >
          <label className="field sketch sketch-thin paper-fill flex flex-1 items-center gap-2 rounded-md px-3">
            <Icon name="search" size={18} className="text-muted" />
            <input
              ref={input}
              type="search"
              value={text}
              onChange={(e) => {
                const v = e.target.value;
                setText(v);
                if (!v.trim()) setQuery("");
              }}
              placeholder={t.searchPlaceholder}
              aria-label={t.searchPlaceholder}
              className="min-w-0 flex-1 bg-transparent py-2.5 text-text outline-none placeholder:text-muted/70"
            />
          </label>
        </form>

        {linkError && (
          <p role="alert" className="mb-4 font-type text-sm text-text">
            <span className="mr-1 text-blood">✖</span>
            {linkError}
          </p>
        )}

        {trimmedText.length >= 2 && !isLink && suggestions.length > 0 && (
          <section aria-label={t.searchSuggestions} className="mb-5 flex flex-wrap items-center gap-1.5">
            <span className="s-lbl mr-1">{t.searchSuggestions}</span>
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => commit(s)}
                className="inline-flex max-w-[240px] items-center gap-1.5 rounded-full border border-[var(--s-line)] bg-white/[0.04] px-3 py-1 text-[12px] text-muted transition-colors motion-color hover:border-[var(--s-line2)] hover:bg-white/[0.08] hover:text-text"
              >
                <Icon name="search" size={11} className="shrink-0 opacity-70" />
                <span className="truncate">{s}</span>
              </button>
            ))}
          </section>
        )}

        {idle ? (
          <div className="space-y-7">
            {history.length > 0 && (
              <section aria-label={t.recentSearches}>
                <SectionHead title={t.recentSearches} action={t.clearHistory} onAction={() => saveSettings({ searchHistory: [] })} />
                <div className="flex flex-wrap gap-2">
                  {history.map((h) => (
                    <div
                      key={h}
                      className="group inline-flex max-w-full items-center rounded-full border border-[var(--s-line2)] bg-white/[0.04] transition-colors motion-color hover:border-white/25 hover:bg-white/[0.08]"
                    >
                      <button
                        type="button"
                        onClick={() => commit(h)}
                        className="flex min-w-0 items-center gap-2 py-1.5 pl-3 pr-1.5 text-[12.5px] text-text"
                      >
                        <Icon name="history" size={13} className="shrink-0 text-[var(--s-dim)]" />
                        <span className="max-w-[240px] truncate">{h}</span>
                      </button>
                      <button
                        type="button"
                        aria-label={`${t.removeFromHistory}: ${h}`}
                        title={t.removeFromHistory}
                        onClick={() => saveSettings({ searchHistory: removeFromSearchHistory(history, h) })}
                        className="mr-1 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[var(--s-dim)] transition-colors motion-color hover:bg-white/[0.1] hover:text-text"
                      >
                        <Icon name="close" size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section aria-label={t.searchQuickGenres}>
              <SectionHead title={t.searchQuickGenres} />
              <div className="flex flex-wrap gap-2">
                {QUICK_GENRES.map((genre) => (
                  <span key={genre} className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => commit(genre)}
                      className="rounded-full border border-[var(--s-line)] bg-white/[0.03] px-3.5 py-1.5 text-[12.5px] font-medium text-muted transition-colors motion-color hover:border-[var(--s-line2)] hover:bg-white/[0.08] hover:text-text"
                    >
                      {genre}
                    </button>
                    <DjStartGenreButton
                      query={genre}
                      name={genre}
                      label={t.dj}
                      title={t.djPlayGenre(genre)}
                      onDone={(ok) => {
                        if (ok) {
                          open("dj", { name: "dj" });
                          return;
                        }
                        // the start failed here (not stopped elsewhere): say so where the person is
                        const st = useDj.getState().status;
                        if (st === "error") toast(t.djError);
                        else if (st === "empty") toast(t.djGenreEmpty(genre));
                      }}
                      className="!h-7 !px-2.5 !text-[12px]"
                    />
                  </span>
                ))}
              </div>
            </section>

            {recentTracks.length > 0 && (
              <section aria-label={t.jumpBackIn}>
                <SectionHead title={t.jumpBackIn} action={t.showAll} onAction={() => open("history", { name: "history" })} />
                <div className={ONE_ROW}>
                  {recentTracks.map((tr, i) => {
                    const on = tr.id === currentId;
                    return (
                      <button
                        key={tr.id}
                        type="button"
                        onClick={() => (on ? player.toggle() : player.playFrom(recentTracks, i, { kind: "static" }))}
                        title={`${tr.title} — ${tr.artist}`}
                        className="group min-w-0 text-left"
                      >
                        <span className="relative block aspect-square overflow-hidden rounded-[var(--r2)] bg-white/[0.06]">
                          {tr.artworkUrl ? (
                            <img src={artwork(tr.artworkUrl, "t300x300") ?? undefined} alt="" loading="lazy" decoding="async" draggable={false} className="h-full w-full object-cover" />
                          ) : (
                            <span className="stipple-night block h-full w-full" />
                          )}
                          <span aria-hidden="true" className="absolute inset-0 bg-black/20 opacity-0 transition-opacity motion-color group-hover:opacity-100 group-focus-visible:opacity-100" />
                          <span className={`s-pp absolute bottom-2 right-2 h-8 w-8 transition-opacity motion-color ${on ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"}`}>
                            <Icon name={on && playing ? "pause" : "play"} size={16} />
                          </span>
                        </span>
                        <span className="mt-2 block truncate text-[15px] font-semibold leading-[1.35] text-text">{tr.title}</span>
                        <span className="mt-px block truncate text-[13px] font-normal leading-[1.4] text-muted">{tr.artist}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}
          </div>
        ) : isLink ? (
          <div className="flex max-w-xl items-center gap-3 rounded-[var(--r2)] border border-[var(--s-line2)] bg-white/[0.04] px-4 py-3">
            <Icon name="link" size={16} className="shrink-0 text-[var(--accent)]" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium text-text">{trimmedText}</div>
              <div className="mt-0.5 text-[12px] text-[var(--s-dim)]">{t.searchLinkReady}</div>
            </div>
            <button type="button" onClick={() => void onSubmit()} className="s-btn pri shrink-0">
              {t.open}
            </button>
          </div>
        ) : !hasQuery ? (
          <EmptyState caption={t.searchEmptyTip} />
        ) : tab === "all" ? (
          !hasAnyResult && anyPending ? (
            <Loading />
          ) : !hasAnyResult && anyError ? (
            <ErrorState
              error={tracksQ.error ?? playlistsQ.error ?? usersQ.error}
              onRetry={() => {
                void tracksQ.refetch();
                void playlistsQ.refetch();
                void usersQ.refetch();
              }}
            />
          ) : !hasAnyResult ? (
            <EmptyState caption={t.noResults} />
          ) : (
            <div className="space-y-6">
              {users.length > 0 && (
                <section aria-label={t.artists}>
                  <SectionHead title={t.artists} action={users.length > 3 || usersQ.hasNextPage ? t.showAll : undefined} onAction={() => setTab("users")} />
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] grid-rows-[auto] [grid-auto-rows:0] gap-x-4 overflow-hidden">
                    {users.slice(0, 8).map((u) => (
                      <ArtistCard
                        key={u.id}
                        user={u}
                        onOpen={() => {
                          recordSearch(activeQuery);
                          go({ name: "profile", userId: u.id });
                        }}
                      />
                    ))}
                  </div>
                </section>
              )}

              {playlists.length > 0 && (
                <section aria-label={t.playlists}>
                  <SectionHead title={t.playlists} action={playlists.length > 3 || playlistsQ.hasNextPage ? t.showAll : undefined} onAction={() => setTab("playlists")} />
                  <div className={ONE_ROW}>
                    {playlists.slice(0, 8).map((p) => (
                      <PlaylistTile
                        key={p.id}
                        playlist={p}
                        onOpen={() => {
                          recordSearch(activeQuery);
                          go({ name: "playlist", id: p.id });
                        }}
                      />
                    ))}
                  </div>
                </section>
              )}

              {tracksQ.isError && !tracks.length ? (
                <ErrorState compact error={tracksQ.error} onRetry={() => void tracksQ.refetch()} />
              ) : (
                tracks.length > 0 && (
                  <section aria-label={t.tracksTab}>
                    <SectionHead title={t.tracksTab} />
                    <div
                      onClickCapture={() => recordSearch(activeQuery)}
                      onDoubleClickCapture={() => recordSearch(activeQuery)}
                      onKeyDownCapture={(e) => e.key === "Enter" && recordSearch(activeQuery)}
                    >
                      <TrackList tracks={tracks} source={source} hasMore={tracksQ.hasNextPage} loadingMore={tracksQ.isFetchingNextPage} onLoadMore={() => void tracksQ.fetchNextPage()} label={t.search} />
                    </div>
                  </section>
                )
              )}
            </div>
          )
        ) : tab === "tracks" ? (
          tracksQ.isPending ? (
            <Loading />
          ) : tracksQ.isError && !tracks.length ? (
            <ErrorState error={tracksQ.error} onRetry={() => void tracksQ.refetch()} />
          ) : !tracks.length ? (
            <EmptyState caption={t.noResults} />
          ) : (
            <div
              onClickCapture={() => recordSearch(activeQuery)}
              onDoubleClickCapture={() => recordSearch(activeQuery)}
              onKeyDownCapture={(e) => e.key === "Enter" && recordSearch(activeQuery)}
            >
              <TrackList tracks={tracks} source={source} hasMore={tracksQ.hasNextPage} loadingMore={tracksQ.isFetchingNextPage} onLoadMore={() => void tracksQ.fetchNextPage()} label={t.search} />
            </div>
          )
        ) : tab === "playlists" ? (
          playlistsQ.isPending ? (
            <Loading />
          ) : playlistsQ.isError && !playlists.length ? (
            <ErrorState error={playlistsQ.error} onRetry={() => void playlistsQ.refetch()} />
          ) : !playlists.length ? (
            <EmptyState caption={t.noResults} />
          ) : (
            <>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-x-4 gap-y-6">
                {playlists.map((p) => (
                  <PlaylistTile
                    key={p.id}
                    playlist={p}
                    onOpen={() => {
                      recordSearch(activeQuery);
                      go({ name: "playlist", id: p.id });
                    }}
                  />
                ))}
              </div>
              <Sentinel count={playlists.length} hasMore={!!playlistsQ.hasNextPage} loading={playlistsQ.isFetchingNextPage} onMore={() => void playlistsQ.fetchNextPage()} />
            </>
          )
        ) : usersQ.isPending ? (
          <Loading />
        ) : usersQ.isError && !users.length ? (
          <ErrorState error={usersQ.error} onRetry={() => void usersQ.refetch()} />
        ) : !users.length ? (
          <EmptyState caption={t.noResults} />
        ) : (
          <>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-x-4 gap-y-6">
              {users.map((u) => (
                <ArtistCard
                  key={u.id}
                  user={u}
                  onOpen={() => {
                    recordSearch(activeQuery);
                    go({ name: "profile", userId: u.id });
                  }}
                />
              ))}
            </div>
            <Sentinel count={users.length} hasMore={!!usersQ.hasNextPage} loading={usersQ.isFetchingNextPage} onMore={() => void usersQ.fetchNextPage()} />
          </>
        )}
      </div>
    </Screen>
  );
}
