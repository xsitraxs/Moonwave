import { artwork, type Track } from "@shared/types";
import { DjStartLikesButton, DjStatusText, DjToggle, DjVotes, DjWhyLine } from "@/components/dj/bits";
import { IconButton } from "@/components/ui/Buttons";
import Icon from "@/components/ui/Icon";
import { Screen, ScreenTitle } from "@/components/ui/Screen";
import { useT } from "@/i18n";
import type { DjWhy } from "@/lib/djRank";
import { duration } from "@/lib/format";
import { dj, useDj } from "@/state/dj";
import { player, useCurrentTrack, usePlayer } from "@/state/player";
import { useUi } from "@/state/ui";

/** When every shown suggestion names the same seed, its reason moves to one header line (rows stay clean). */
function commonSeedOf(upcoming: readonly { track: Track }[], reasons: Record<number, DjWhy>): { id: number; title: string } | null {
  // reasons only ever name titled seeds, so the common one always has a string title
  let seed: { id: number; title: string } | null = null;
  for (const { track } of upcoming) {
    const w = reasons[track.id];
    if (!w || w.kind !== "seed") return null;
    if (!seed) seed = { id: w.seedId, title: w.seedTitle };
    else if (seed.id !== w.seedId) return null;
  }
  return seed;
}

/** One upcoming suggestion: jumping plays it here in the queue (never restarts the session elsewhere). */
function Suggestion({ track, at, hideWhy }: { track: Track; at: number; hideWhy: boolean }) {
  const t = useT();
  const openMenu = useUi((s) => s.openMenu);
  const active = useDj((s) => s.active);
  return (
    <li className="s-qi s-qi-auto group">
      <button type="button" tabIndex={-1} aria-label={`${t.play}: ${track.title}`} onClick={() => player.jumpTo(at)} className="relative shrink-0 overflow-hidden rounded-[4px]">
        <span className="block h-10 w-10 overflow-hidden bg-white/[0.06]">
          {track.artworkUrl && <img src={artwork(track.artworkUrl, "large") ?? undefined} alt="" loading="lazy" decoding="async" draggable={false} className="h-full w-full object-cover" />}
        </span>
        <span aria-hidden="true" className="absolute inset-0 grid place-items-center bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100">
          <Icon name="play" size={14} />
        </span>
      </button>
      <span className="min-w-0 flex-1">
        <span className="t block truncate">{track.title}</span>
        <span className="s block truncate">{track.artist}</span>
        {!hideWhy && <DjWhyLine trackId={track.id} className="mt-0.5 text-[11.5px] text-[var(--s-dim)]" />}
      </span>
      <span className="flex shrink-0 items-center">
        <DjVotes trackId={track.id} />
        {active && (
          <IconButton
            icon="close"
            label={t.djDismiss}
            size={15}
            className="!h-8 !w-8"
            onClick={() => dj.dismiss(track.id)}
          />
        )}
        <IconButton
          icon="more"
          label={t.moreActions}
          size={17}
          className="!h-8 !w-8"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            openMenu(r.right, r.bottom + 4, track);
          }}
        />
      </span>
      <span className="d">{duration(track.durationMs)}</span>
    </li>
  );
}

/** The playing track in the DJ's words: its reason (or the session's starting point) and its votes. */
function NowRow({ track }: { track: Track }) {
  const t = useT();
  const openMenu = useUi((s) => s.openMenu);
  const seed = useDj((s) => s.seeds[0] ?? null);
  const origin = useDj((s) => s.origin);
  const isSeed = origin?.kind === "track" && seed !== null && track.id === seed.id;
  return (
    <div className="s-qi s-qi-auto group">
      <span className="block h-10 w-10 shrink-0 overflow-hidden rounded-[4px] bg-white/[0.06]">
        {track.artworkUrl && <img src={artwork(track.artworkUrl, "large") ?? undefined} alt="" loading="lazy" decoding="async" draggable={false} className="h-full w-full object-cover" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="t block truncate">{track.title}</span>
        <span className="s block truncate">{track.artist}</span>
        {isSeed ? (
          <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[11.5px] text-[var(--s-dim)]">
            <Icon name="dj" size={12} className="shrink-0" />
            <span className="truncate">{t.djNowSeed}</span>
          </span>
        ) : (
          <DjWhyLine trackId={track.id} className="mt-0.5 text-[11.5px] text-[var(--s-dim)]" />
        )}
      </span>
      <span className="flex shrink-0 items-center">
        <DjVotes trackId={track.id} />
        <IconButton
          icon="more"
          label={t.moreActions}
          size={17}
          className="!h-8 !w-8"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            openMenu(r.right, r.bottom + 4, track);
          }}
        />
      </span>
      <span className="d">{duration(track.durationMs)}</span>
    </div>
  );
}

/** The DJ page: a remote for the session — now, next, and the session's tally (the full list lives in the queue). */
export default function Dj() {
  const t = useT();
  const active = useDj((s) => s.active);
  const status = useDj((s) => s.status);
  const feedbackOn = useDj((s) => s.feedbackOn);
  const voted = useDj((s) => Object.keys(s.votes).length);
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const current = useCurrentTrack();
  const likesOrigin = useDj((s) => s.origin?.kind === "likes");
  const reasons = useDj((s) => s.reasons);
  const upcoming: { track: Track; at: number }[] = [];
  for (let at = index + 1; at < queue.length; at++) {
    const track = queue[at];
    if (track && reasons[track.id]) upcoming.push({ track, at });
  }
  const nextUp = upcoming.slice(0, 3);
  const commonSeed = commonSeedOf(nextUp, reasons);
  const suggested = Object.keys(reasons).length;
  const played = queue.filter((tr, i) => i < index && reasons[tr.id]).length;

  return (
    <Screen label={t.dj}>
      <ScreenTitle meta={t.djTagline}>{t.dj}</ScreenTitle>

      <section aria-label={t.dj} className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-3">
        <DjToggle primary />
        {status === "error" && (
          <button type="button" onClick={dj.retry} className="s-btn">
            {t.retry}
          </button>
        )}
        <DjStatusText className="w-full text-[13px] text-[var(--s-dim)]" />
        {status === "empty" && <span className="w-full text-[13px] text-[var(--s-dim)]">{likesOrigin ? t.djLikesEmptyHint : t.djEmptyHint}</span>}
      </section>

      {active && current && (
        <section aria-label={t.nowPlaying} className="mb-6">
          <h2 className="s-lbl mb-2">{t.nowPlaying}</h2>
          <NowRow track={current} />
        </section>
      )}

      {active && nextUp.length > 0 && (
        <section aria-label={t.upNext} className="mb-6">
          <h2 className="s-lbl mb-2">{t.upNext}</h2>
          {commonSeed && (
            <p className="mb-2 flex min-w-0 items-center gap-1 text-[12px] text-[var(--s-dim)]">
              <Icon name="dj" size={12} className="shrink-0" />
              <span className="truncate">{t.djWhySeed(commonSeed.title)}</span>
            </p>
          )}
          <ol>
            {nextUp.map(({ track, at }) => (
              <Suggestion key={`${track.id}-${at}`} track={track} at={at} hideWhy={commonSeed !== null} />
            ))}
          </ol>
        </section>
      )}

      {active && (
        <section aria-label={t.djSession} className="mb-6">
          <h2 className="s-lbl mb-2">{t.djSession}</h2>
          <div className="mb-4 flex gap-6">
            <span className="block">
              <span className="block text-xl font-semibold text-text">{suggested}</span>
              <span className="s-lbl">{t.djStatSuggested}</span>
            </span>
            <span className="block">
              <span className="block text-xl font-semibold text-text">{played}</span>
              <span className="s-lbl">{t.djStatPlayed}</span>
            </span>
            <span className="block">
              <span className="block text-xl font-semibold text-text">{voted}</span>
              <span className="s-lbl">{t.djStatVotes}</span>
            </span>
          </div>
          <button type="button" role="switch" aria-checked={feedbackOn} onClick={() => dj.setFeedbackOn(!feedbackOn)} className="s-row mb-2 w-full max-w-xl text-left">
            <Icon name="dj" size={17} className="text-muted" />
            <span>
              <span className="t block">{t.djFeedback}</span>
              <span className="s block">{t.djFeedbackHint}</span>
            </span>
            <span className={`s-sw ${feedbackOn ? "on" : ""}`} />
          </button>
          <div>
            <button type="button" onClick={dj.clearVotes} disabled={!voted} className="text-[12px] text-[var(--s-dim)] hover:text-text disabled:opacity-40">
              {t.djClearVotes}
            </button>
          </div>
        </section>
      )}

      {!active && (
        <>
          <section aria-label={t.djStartFrom}>
            <h2 className="s-lbl mb-2">{t.djStartFrom}</h2>
            {current ? (
              <div className="s-qi s-qi-auto">
                <span className="block h-10 w-10 shrink-0 overflow-hidden rounded-[4px] bg-white/[0.06]">
                  {current.artworkUrl && <img src={artwork(current.artworkUrl, "large") ?? undefined} alt="" loading="lazy" decoding="async" draggable={false} className="h-full w-full object-cover" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="t block truncate">{current.title}</span>
                  <span className="s block truncate">{current.artist}</span>
                </span>
              </div>
            ) : (
              <p className="text-[13px] text-[var(--s-dim)]">{t.djNeedTrack}</p>
            )}
          </section>
          <section aria-label={t.djStartLikes} className="mt-6">
            <DjStartLikesButton />
          </section>
        </>
      )}
    </Screen>
  );
}
