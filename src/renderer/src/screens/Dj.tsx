import { artwork, type Track } from "@shared/types";
import { DjStatusText, DjToggle, DjVotes, DjWhyLine } from "@/components/dj/bits";
import { IconButton } from "@/components/ui/Buttons";
import Icon from "@/components/ui/Icon";
import { Screen, ScreenTitle } from "@/components/ui/Screen";
import { useT } from "@/i18n";
import { duration } from "@/lib/format";
import { dj, useDj } from "@/state/dj";
import { player, usePlayer } from "@/state/player";
import { useUi } from "@/state/ui";

/** One upcoming suggestion: jumping plays it here in the queue (never restarts the session elsewhere). */
function Suggestion({ track, at }: { track: Track; at: number }) {
  const t = useT();
  const openMenu = useUi((s) => s.openMenu);
  const active = useDj((s) => s.active);
  return (
    <li className="s-qi group">
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
        <DjWhyLine trackId={track.id} className="mt-0.5 text-[11.5px] text-[var(--s-dim)]" />
      </span>
      <span className="flex shrink-0 items-center opacity-0 transition-opacity motion-color group-focus-within:opacity-100 group-hover:opacity-100">
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

/** The DJ page: the session state and its switch, the ratings, and every upcoming suggestion with its reason. */
export default function Dj() {
  const t = useT();
  const active = useDj((s) => s.active);
  const status = useDj((s) => s.status);
  const feedbackOn = useDj((s) => s.feedbackOn);
  const voted = useDj((s) => Object.keys(s.votes).length);
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const reasons = useDj((s) => s.reasons);
  const upcoming: { track: Track; at: number }[] = [];
  for (let at = index + 1; at < queue.length; at++) {
    const track = queue[at];
    if (track && reasons[track.id]) upcoming.push({ track, at });
  }

  return (
    <Screen label={t.dj}>
      <ScreenTitle meta={t.djHint}>{t.dj.toLowerCase()}</ScreenTitle>

      <section aria-label={t.dj} className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-3">
        <DjToggle primary />
        {status === "error" && (
          <button type="button" onClick={dj.retry} className="s-btn">
            {t.retry}
          </button>
        )}
        <DjStatusText className="w-full text-[13px] text-[var(--s-dim)]" />
        {status === "empty" && <span className="w-full text-[13px] text-[var(--s-dim)]">{t.djEmptyHint}</span>}
      </section>

      {active && (
        <>
          <button type="button" role="switch" aria-checked={feedbackOn} onClick={() => dj.setFeedbackOn(!feedbackOn)} className="s-row mb-2 w-full max-w-xl text-left">
            <Icon name="sparkle" size={17} className="text-muted" />
            <span>
              <span className="t block">{t.djFeedback}</span>
              <span className="s block">{t.djFeedbackHint}</span>
            </span>
            <span className={`s-sw ${feedbackOn ? "on" : ""}`} />
          </button>
          <div className="mb-6">
            <button type="button" onClick={dj.clearVotes} disabled={!voted} className="text-[12px] text-[var(--s-dim)] hover:text-text disabled:opacity-40">
              {t.djClearVotes}
            </button>
          </div>
        </>
      )}

      {upcoming.length > 0 && (
        <section aria-label={t.djSuggestions}>
          <h2 className="s-lbl mb-2">{t.djSuggestions}</h2>
          <ol>
            {upcoming.map(({ track, at }) => (
              <Suggestion key={`${track.id}-${at}`} track={track} at={at} />
            ))}
          </ol>
        </section>
      )}
    </Screen>
  );
}
