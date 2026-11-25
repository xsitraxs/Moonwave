import Icon from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/Buttons";
import { useT } from "@/i18n";
import { djReasonText } from "@/lib/djReason";
import { DJ_MIN_SEEDS } from "@/lib/djSources";
import { dj, useDj } from "@/state/dj";
import { useCanLike, useLikes } from "@/state/likes";
import { useCurrentTrack } from "@/state/player";
import { useRoom } from "@/state/room";
import { useUi } from "@/state/ui";

/** One line for the session state; nothing while idle. Shared by the page, the queue strip and the home card. */
export function DjStatusText({ className = "" }: { className?: string }) {
  const t = useT();
  const status = useDj((s) => s.status);
  const seed = useDj((s) => s.seeds[0] ?? null);
  const origin = useDj((s) => s.origin);
  const refilling = useDj((s) => s.refilling);
  if (status === "idle") return null;
  // the session in its own words: the origin names the source, the seed only when the source is one track
  const originWords =
    origin?.kind === "likes"
      ? t.djFromLikes
      : origin?.kind === "artist"
        ? t.djFromArtist(origin.name)
        : origin?.kind === "playlist"
          ? t.djFromPlaylist(origin.title)
          : origin?.kind === "genre"
            ? t.djFromGenre(origin.name)
            : origin?.kind === "mood"
              ? t.djFromMood(origin.name)
              : seed?.title
                ? t.djSeed(seed.title)
                : t.dj;
  const emptyWords =
    origin?.kind === "likes"
      ? t.djLikesEmpty
      : origin?.kind === "artist"
        ? t.djArtistEmpty(origin.name)
        : origin?.kind === "playlist"
          ? t.djPlaylistEmpty(origin.title)
          : origin?.kind === "genre"
            ? t.djGenreEmpty(origin.name)
            : origin?.kind === "mood"
              ? t.djMoodEmpty(origin.name)
              : t.djEmpty;
  const text =
    status === "loading"
      ? t.djLoading
      : status === "ready"
        ? `${originWords}${refilling ? ` · ${t.loadingMore}` : ""}`
        : status === "error"
          ? t.djError
          : status === "empty"
            ? emptyWords
            : status === "exhausted"
              ? t.djExhausted
              : t.djStopped;
  return <span className={`truncate ${className}`}>{text}</span>;
}

/** The session's main switch: starts from the current track, or stops a running session. */
export function DjToggle({ primary = false, className = "" }: { primary?: boolean; className?: string }) {
  const t = useT();
  const active = useDj((s) => s.active);
  const current = useCurrentTrack();
  const room = useRoom((s) => !!s.room);
  const disabled = room || (!active && !current);
  return (
    <button
      type="button"
      disabled={disabled}
      title={!active && !current && !room ? t.djNeedTrack : undefined}
      onClick={() => (active ? dj.stop() : dj.start())}
      className={`s-btn ${primary ? "pri" : ""} ${className}`}
    >
      {active ? t.djStop : t.djStart}
    </button>
  );
}

/** Starts a session from a named source (likes, an artist, a playlist). Gated with a spoken reason when it can't seed one. */
export function DjSourceButton({ label, reason, title, start, onDone, className = "" }: { label: string; reason?: string; title?: string; start: () => Promise<unknown>; onDone?: (active: boolean) => void; className?: string }) {
  const active = useDj((s) => s.active);
  const room = useRoom((s) => !!s.room);
  const showToast = useUi((s) => s.showToast);
  return (
    <button
      type="button"
      disabled={room || active}
      aria-disabled={reason !== undefined || undefined}
      title={reason ?? title}
      aria-label={reason ? `${label}. ${reason}` : (title ?? label)}
      onClick={() => {
        // fresh state, not the render's: a second click in the same frame (before `disabled` lands) must not start twice
        if (useRoom.getState().room || useDj.getState().active) return;
        // gated but focusable: a tap says why instead of doing nothing
        if (reason) {
          showToast(reason);
          return;
        }
        void start().then(() => onDone?.(useDj.getState().active));
      }}
      className={`s-btn ${className}`}
    >
      {label}
    </button>
  );
}

/** Starts a session from recent likes. Gated with a spoken reason when likes can't seed one. */
export function DjStartLikesButton({ className = "", onDone }: { className?: string; onDone?: (active: boolean) => void }) {
  const t = useT();
  const can = useCanLike();
  const liked = useLikes((s) => (s.ready ? s.ids.size : null));
  const reason = !can ? t.djLikesUnavailable : liked !== null && liked < DJ_MIN_SEEDS ? t.djLikesShort : undefined;
  return <DjSourceButton label={t.djStartLikes} reason={reason} start={() => dj.startFromLikes()} onDone={onDone} className={className} />;
}

/** Starts a session from an artist's uploads (or a listener's public likes — the controller picks the source). */
export function DjStartArtistButton({ userId, name, className = "", onDone }: { userId: number; name: string; className?: string; onDone?: (active: boolean) => void }) {
  const t = useT();
  return <DjSourceButton label={t.djStartArtist} start={() => dj.startFromArtist(userId, name)} onDone={onDone} className={className} />;
}

/** Starts a session from a playlist's tracks in order. Short ones say so before burning a request (unless the count is unknown — then the controller judges). */
export function DjStartPlaylistButton({ id, title, trackCount, className = "", onDone }: { id: string; title: string; trackCount?: number; className?: string; onDone?: (active: boolean) => void }) {
  const t = useT();
  const reason = trackCount !== undefined && trackCount < DJ_MIN_SEEDS ? t.djPlaylistShort : undefined;
  return <DjSourceButton label={t.djStartPlaylist} reason={reason} start={() => dj.startFromPlaylist(id, title)} onDone={onDone} className={className} />;
}

/**
 * Starts a session from a genre wave (the query is the name). The seed count is unknown until the search
 * answers, so there is no pre-gate — the controller judges. A short `label` (spoken by `title`) fits tight rows.
 */
export function DjStartGenreButton({ query, name, label, title, className = "", onDone }: { query: string; name: string; label?: string; title?: string; className?: string; onDone?: (active: boolean) => void }) {
  return <DjSourceButton label={label ?? name} title={title} start={() => dj.startFromGenre(query, name)} onDone={onDone} className={className} />;
}

/** Starts a session from a mood wave: the mood's query seeds it, the mood's name is what it speaks. */
export function DjStartMoodButton({ query, name, className = "", onDone }: { query: string; name: string; className?: string; onDone?: (active: boolean) => void }) {
  return <DjSourceButton label={name} start={() => dj.startFromMood(query, name)} onDone={onDone} className={className} />;
}

/** Session-only thumbs up / down for one suggestion; hidden while no session runs. */
export function DjVotes({ trackId }: { trackId: number }) {
  const t = useT();
  const active = useDj((s) => s.active);
  const vote = useDj((s) => s.votes[trackId] ?? null);
  if (!active) return null;
  return (
    <>
      <IconButton
        icon="plus"
        label={t.djVoteMore}
        on={vote === "more"}
        aria-pressed={vote === "more"}
        size={16}
        className="!h-8 !w-8"
        onClick={() => dj.vote(trackId, vote === "more" ? null : "more")}
      />
      <IconButton
        icon="minimize"
        label={t.djVoteLess}
        on={vote === "less"}
        aria-pressed={vote === "less"}
        size={16}
        className="!h-8 !w-8"
        onClick={() => dj.vote(trackId, vote === "less" ? null : "less")}
      />
    </>
  );
}

/** Why this track was suggested, in the session's honest words; nothing for tracks outside the session. */
export function DjWhyLine({ trackId, className = "" }: { trackId: number; className?: string }) {
  const t = useT();
  const why = useDj((s) => s.reasons[trackId]);
  if (!why) return null;
  return (
    <span className={`flex min-w-0 items-center gap-1 ${className}`}>
      <Icon name="dj" size={12} className="shrink-0" />
      <span className="truncate">
        {djReasonText(why, { seed: t.djWhySeed, seeds: t.djWhySeeds, likes: t.djWhyLikes, artist: t.djWhyArtist, playlist: t.djWhyPlaylist, genre: t.djWhyGenre, mood: t.djWhyMood, generic: t.djWhyGeneric })}
      </span>
    </span>
  );
}
