import { useEffect, useRef, useState, type CSSProperties } from "react";
import { isLocalTrack, artwork, type Track } from "@shared/types";
import { DjVotes, DjWhyLine } from "@/components/dj/bits";
import { errorText, useT } from "@/i18n";
import { duration } from "@/lib/format";
import { setMiniPlayer } from "@/lib/miniPlayer";
import { dj, useDj } from "@/state/dj";
import { toggleLike, useLiked, useCanLike } from "@/state/likes";
import { useNav } from "@/state/nav";
import { player, useCurrentTrack, usePlayer, usePosition, useStreamTrack } from "@/state/player";
import { useRoom, useRoomSheet } from "@/state/room";
import { useSettings } from "@/state/settings";
import { useSocial } from "@/state/social";
import { useUi } from "@/state/ui";
import CoverRing from "../player/CoverRing";
import SleepTimer from "../player/SleepTimer";
import Waveform from "../player/Waveform";
import Icon, { type IconName } from "../ui/Icon";

const STATIC = { kind: "static" } as const;

function Btn({
  icon,
  label,
  on = false,
  onClick,
  size = 20,
  disabled = false,
  alwaysPressed = false,
  expanded,
  controls,
  queueToggle = false,
  tipAlign = "center",
}: {
  icon: IconName;
  label: string;
  on?: boolean;
  onClick: () => void;
  size?: number;
  disabled?: boolean;
  alwaysPressed?: boolean;
  expanded?: boolean;
  controls?: string;
  queueToggle?: boolean;
  tipAlign?: "center" | "start" | "end";
}) {
  const alignClass = tipAlign === "start" ? "s-tip-start" : tipAlign === "end" ? "s-tip-end" : "";
  return (
    <button
      type="button"
      className={`s-ib s-tip ${alignClass} !h-9 !w-9 ${on ? "on" : ""}`}
      aria-label={label}
      data-tip={label}
      aria-pressed={alwaysPressed ? on : on || undefined}
      aria-expanded={expanded}
      aria-controls={controls}
      data-queue-toggle={queueToggle ? "" : undefined}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon name={icon} size={size} />
      {on && <span aria-hidden="true" className="absolute bottom-0.5 h-[3px] w-[3px] rounded-full bg-[var(--accent)]" />}
    </button>
  );
}

function Like({ track }: { track: Track }) {
  const t = useT();
  const canLike = useCanLike();
  // files from this computer: only with likes kept here
  const local = useSettings((s) => s.prefs.localLikes);
  const liked = useLiked(track.id);
  const [pop, setPop] = useState(0);
  if (!canLike || (isLocalTrack(track.id) && !local)) return null;
  return (
    <button
      type="button"
      onClick={() => {
        setPop((p) => p + 1);
        void toggleLike(track);
      }}
      aria-pressed={liked}
      aria-label={liked ? t.unlike : t.like}
      data-tip={liked ? t.unlike : t.like}
      className={`s-tip grid h-9 w-9 shrink-0 place-items-center rounded-md transition-colors motion-color ${liked ? "text-[var(--accent)]" : "text-muted hover:text-text"}`}
    >
      <span key={pop} className={pop ? "s-like-pop grid place-items-center" : "grid place-items-center"}>
        <Icon name="heart" size={20} filled={liked} />
      </span>
    </button>
  );
}

/** "Add to playlist" for what plays, next to the ♥ (the queue has its own button on the right) */
function AddTo({ track }: { track: Track }) {
  const t = useT();
  const openPicker = useUi((s) => s.openPicker);
  return (
    <button
      type="button"
      onClick={() => openPicker(track)}
      aria-label={t.addToPlaylist}
      data-tip={t.addToPlaylist}
      className="s-tip grid h-9 w-9 shrink-0 place-items-center rounded-md text-muted transition-colors motion-color hover:text-text"
    >
      <Icon name="playlistAdd" size={20} />
    </button>
  );
}

function Elapsed() {
  const position = usePosition((s) => s.position);
  return <span className="min-w-10 shrink-0 text-right text-[12px] tabular-nums text-[var(--s-dim)]">{duration(position * 1000)}</span>;
}

function Remaining({ totalMs }: { totalMs: number }) {
  const t = useT();
  const position = usePosition((s) => s.position);
  const [showRemaining, setShowRemaining] = useState(false);
  const remaining = Math.max(0, totalMs / 1000 - position);
  const label = showRemaining ? `-${duration(remaining * 1000)}` : duration(totalMs);
  return (
    <button
      type="button"
      onClick={() => setShowRemaining((v) => !v)}
      aria-label={showRemaining ? t.showTotal : t.showRemaining}
      title={showRemaining ? t.showTotal : t.showRemaining}
      className="min-w-10 shrink-0 text-[12px] tabular-nums text-[var(--s-dim)] transition-colors motion-color hover:text-text"
    >
      {label}
    </button>
  );
}

/** Where the sound goes: the system default or one of the audio outputs. */
function Device() {
  const t = useT();
  const current = useSettings((s) => s.prefs.outputDevice);
  const setPref = useSettings((s) => s.setPref);
  const [open, setOpen] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    void navigator.mediaDevices.enumerateDevices().then((d) => setDevices(d.filter((x) => x.kind === "audiooutput" && x.deviceId !== "default" && x.deviceId !== "communications")));
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);
  const options = [{ id: "", label: t.systemDefault }, ...devices.map((d, i) => ({ id: d.deviceId, label: d.label || `${t.outputDevice} ${i + 1}` }))];
  return (
    <div ref={box} className="relative">
      <Btn icon="device" label={t.outputDevice} on={!!current} onClick={() => setOpen((o) => !o)} />
      {open && (
        <div className="s-pop s-glass !absolute bottom-11 right-0 w-72">
          <div className="s-lbl mx-2 mb-1.5 mt-1">{t.outputDevice}</div>
          {options.map((o) => (
            <button
              key={o.id || "default"}
              type="button"
              className={`s-opt ${o.id === current ? "on" : ""}`}
              onClick={() => {
                setPref("outputDevice", o.id);
                setOpen(false);
              }}
            >
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
              {o.id === current && <Icon name="check" size={16} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Volume() {
  const t = useT();
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  const shown = muted ? 0 : volume;
  return (
    <div className="flex items-center gap-1">
      <Btn icon={muted || volume === 0 ? "mute" : "volume"} label={muted ? t.unmute : t.mute} onClick={player.toggleMute} />
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={shown}
        aria-label={t.volume}
        onChange={(e) => player.setVolume(Number(e.target.value))}
        onWheel={(e) => player.setVolume(volume + (e.deltaY < 0 ? 0.05 : -0.05))}
        className="s-vol"
        style={{ "--fill": `${shown * 100}%` } as CSSProperties}
      />
    </div>
  );
}

function TrackTitle({ title, onClick }: { title: string; onClick: () => void }) {
  const box = useRef<HTMLButtonElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(0);
  useEffect(() => {
    const measure = () => setOverflow(Math.max(0, (text.current?.scrollWidth ?? 0) - (box.current?.clientWidth ?? 0)));
    measure();
    const observer = new ResizeObserver(measure);
    if (box.current) observer.observe(box.current);
    if (text.current) observer.observe(text.current);
    return () => observer.disconnect();
  }, [title]);
  return (
    <button ref={box} type="button" onClick={onClick} title={title} className={`s-track-title block max-w-full overflow-hidden text-left text-[15px] font-semibold leading-snug text-text hover:underline ${overflow > 0 ? "s-track-title-overflow" : ""}`} style={{ "--title-overflow": `${overflow}px` } as CSSProperties}>
      <span ref={text}>{title}</span>
    </button>
  );
}

/** Studio player: always-visible transport & progress bar, reviving last played track in idle state. */
export default function StudioPlayerBar() {
  const t = useT();
  const track = useCurrentTrack();
  const djActive = useDj((s) => s.active);
  const history = useSettings((s) => s.history);
  const savedPlayer = useSettings((s) => s.player);
  const lastTrack = history[0] ?? null;
  const displayTrack = track ?? lastTrack;
  const isIdleLast = !track && !!lastTrack;
  const savedPos =
    isIdleLast && savedPlayer && savedPlayer.index >= 0 && savedPlayer.queue[savedPlayer.index]?.id === lastTrack.id
      ? Math.max(0, savedPlayer.position)
      : 0;
  const idlePct = isIdleLast && lastTrack.durationMs > 0 ? Math.min(100, (savedPos / (lastTrack.durationMs / 1000)) * 100) : 0;
  const sound = useStreamTrack(track);
  const go = useNav((s) => s.go);
  const status = usePlayer((s) => s.status);
  const repeat = usePlayer((s) => s.repeat);
  const shuffle = usePlayer((s) => s.shuffle);
  const error = usePlayer((s) => (s.status === "error" ? s.error : null));
  const total = usePlayer((s) => s.duration);
  const sideQueue = useUi((s) => s.sideQueue);
  const openSideQueue = useUi((s) => s.openSideQueue);
  const toggleSideQueue = useUi((s) => s.toggleSideQueue);
  const openFull = useUi((s) => s.openFull);
  const setFullTab = useUi((s) => s.setFullTab);
  const canSend = useSocial((s) => !!s.status?.profile);
  const openSend = useSocial((s) => s.openSend);
  const rooms = useSocial((s) => !!s.status?.available);
  const inRoom = useRoom((s) => !!s.room);
  const roomMember = useRoom((s) => !!s.room && s.room.host !== s.me);
  const active = !!track && (status === "playing" || status === "loading");
  const repeatLabel = repeat === "off" ? t.repeatOff : repeat === "all" ? t.repeatAll : t.repeatOne;
  const hotkeys = useSettings((s) => s.prefs.hotkeys);

  const playOrResume = () => {
    if (track) player.toggle();
    else if (history.length) player.playFrom(history, 0, STATIC, useSettings.getState().trackProgress[`t:${history[0]!.id}`]);
  };

  const totalMs = track ? (total || 0) * 1000 : (displayTrack?.durationMs ?? 0);

  return (
    <footer className="s-player s-glass">
      <div className="s-player-track flex min-w-0 items-center gap-3.5 pl-1.5">
        {displayTrack ? (
          <>
            <button
              type="button"
              onClick={() => (track ? openFull() : playOrResume())}
              aria-label={track ? t.fullPlayer : `${t.play}: ${displayTrack.title}`}
              data-tip={track ? t.fullPlayer : t.play}
              className={`s-tip s-tip-start relative h-16 w-16 shrink-0 ${track ? "cursor-zoom-in" : "cursor-pointer opacity-60 transition-opacity hover:opacity-90"}`}
            >
              {track && <CoverRing size={64} />}
              <span className="block h-full w-full overflow-hidden rounded-[var(--r2)] bg-white/[0.06]">
                {displayTrack.artworkUrl && <img src={artwork(displayTrack.artworkUrl, "t300x300") ?? undefined} alt="" className="h-full w-full object-cover" draggable={false} />}
              </span>
            </button>
            <div className={`min-w-0 flex-1 ${isIdleLast ? "opacity-65" : ""}`}>
              <TrackTitle title={displayTrack.title} onClick={() => go({ name: "track", id: displayTrack.id })} />
              <button type="button" onClick={() => go({ name: "profile", userId: displayTrack.user.id })} className="mt-0.5 block max-w-full truncate text-left text-[13px] font-normal text-muted hover:text-text hover:underline">
                {displayTrack.artist}
              </button>
              {track && <DjWhyLine trackId={track.id} className="mt-0.5 text-[11.5px] text-[var(--s-dim)]" />}
            </div>
            <div className={`flex shrink-0 items-center ${isIdleLast ? "opacity-75" : ""}`}>
              <Like track={displayTrack} />
              <AddTo track={displayTrack} />
              {track && <DjVotes trackId={track.id} />}
            </div>
          </>
        ) : (
          <span className="flex items-center gap-2.5 text-[13px] text-[var(--s-dim)]">
            <Icon name="disc" size={20} />
            {t.nothingPlaying}
          </span>
        )}
      </div>

      <div className="s-player-transport flex min-w-0 flex-col items-center gap-1">
        <div className="flex items-center gap-[18px]">
          {/* in a listening room: no shuffle or repeat (the host's queue), tracks changed by the host only */}
          <Btn icon="shuffle" label={t.shuffle} on={shuffle && !inRoom} onClick={player.toggleShuffle} disabled={!track || inRoom} />
          <Btn icon="prev" label={`${t.previous} (${hotkeys.previous || "—"})`} onClick={player.prev} disabled={!track || roomMember} />
          <button
            type="button"
            onClick={playOrResume}
            disabled={!displayTrack}
            aria-label={active ? t.pause : t.play}
            data-tip={`${active ? t.pause : t.play} (${hotkeys.playPause || "Space"})`}
            className="s-pp s-tip h-[34px] w-[34px]"
          >
            <Icon name={active ? "pause" : "play"} size={20} />
          </button>
          <Btn icon="next" label={`${t.next} (${hotkeys.next || "—"})`} onClick={player.next} disabled={!track || roomMember} />
          <Btn icon={repeat === "one" ? "repeatOne" : "repeat"} label={repeatLabel} on={repeat !== "off" && !inRoom} onClick={player.cycleRepeat} disabled={!track || inRoom} />
        </div>
        <div className={`flex w-full max-w-[560px] items-center gap-2.5 ${isIdleLast ? "opacity-65" : ""}`}>
          {track ? <Elapsed /> : <span className="min-w-10 shrink-0 text-right text-[12px] tabular-nums text-[var(--s-dim)]">{duration(savedPos * 1000)}</span>}
          <div className="min-w-0 flex-1">
            {sound ? (
              <Waveform key={sound.id} track={sound} height={32} />
            ) : (
              <div className="flex h-8 items-center" aria-hidden="true">
                <div className="h-[3px] w-full overflow-hidden rounded-full bg-white/[0.12]">
                  {idlePct > 0 && <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${idlePct}%` }} />}
                </div>
              </div>
            )}
          </div>
          {track ? <Remaining totalMs={totalMs} /> : <span className="min-w-10 shrink-0 text-[12px] tabular-nums text-[var(--s-dim)]">{duration(totalMs)}</span>}
        </div>
      </div>

      <div className="s-player-actions min-w-0">
        <div className="s-player-actions-inner flex w-max items-center">
          {error && (
            <button type="button" onClick={player.retry} title={errorText(t, error)} className="s-btn mr-1 !h-7 shrink-0 !px-2 text-[12px]">
              {t.retry}
            </button>
          )}
          {(rooms || (canSend && track && !isLocalTrack(track.id))) && (
            <>
              <div className="s-player-group">
                {canSend && track && !isLocalTrack(track.id) && <Btn icon="send" label={t.sendToFriends} onClick={() => openSend(track)} />}
                {rooms && <Btn icon="users" label={t.listenTogether} on={inRoom} onClick={() => (inRoom ? !sideQueue && openSideQueue() : useRoomSheet.setState({ open: true }))} />}
              </div>
              <span className="s-player-sep" aria-hidden="true" />
            </>
          )}
          <div className="s-player-group">
            <Btn icon="sparkle" label={!track ? t.djNeedTrack : djActive ? t.djStop : t.djStart} on={djActive} disabled={!track || inRoom} onClick={() => (djActive ? dj.stop() : dj.start())} />
            <Btn
              icon="lyrics"
              label={t.lyrics}
              disabled={!track}
              onClick={() => {
                setFullTab("lyrics");
                openFull();
              }}
            />
            <Btn icon="queue" label={t.queue} on={sideQueue} alwaysPressed expanded={sideQueue} controls="studio-queue" queueToggle onClick={toggleSideQueue} />
          </div>
          <span className="s-player-sep" aria-hidden="true" />
          <div className="s-player-group">
            <SleepTimer />
            <Device />
            <Volume />
          </div>
          <span className="s-player-sep" aria-hidden="true" />
          <div className="s-player-group">
            <Btn icon="collapse" label={t.miniPlayer} onClick={() => void setMiniPlayer(true)} />
            <Btn icon="expand" label={t.fullPlayer} tipAlign="end" onClick={openFull} disabled={!track} />
          </div>
        </div>
      </div>
    </footer>
  );
}
