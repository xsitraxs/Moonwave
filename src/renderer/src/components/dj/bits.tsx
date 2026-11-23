import Icon from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/Buttons";
import { useT } from "@/i18n";
import { djReasonText } from "@/lib/djReason";
import { dj, useDj } from "@/state/dj";
import { useCurrentTrack } from "@/state/player";
import { useRoom } from "@/state/room";

/** One line for the session state; nothing while idle. Shared by the page, the queue strip and the home card. */
export function DjStatusText({ className = "" }: { className?: string }) {
  const t = useT();
  const status = useDj((s) => s.status);
  const seed = useDj((s) => s.seeds[0] ?? null);
  const refilling = useDj((s) => s.refilling);
  if (status === "idle") return null;
  const text =
    status === "loading"
      ? t.djLoading
      : status === "ready"
        ? `${seed?.title ? t.djSeed(seed.title) : t.dj}${refilling ? ` · ${t.loadingMore}` : ""}`
        : status === "error"
          ? t.djError
          : status === "empty"
            ? t.djEmpty
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
      <span className="truncate">{djReasonText(why, { seed: t.djWhySeed, seeds: t.djWhySeeds, generic: t.djWhyGeneric })}</span>
    </span>
  );
}
