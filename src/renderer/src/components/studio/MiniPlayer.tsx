import { artwork } from "@shared/types";
import { useT } from "@/i18n";
import { duration } from "@/lib/format";
import { setMiniPlayer } from "@/lib/miniPlayer";
import { player, useCurrentTrack, usePlayer, usePosition } from "@/state/player";
import { WindowButtons } from "@/components/chrome/TitleBar";
import { useSettings } from "@/state/settings";
import Icon, { type IconName } from "@/components/ui/Icon";

export default function MiniPlayer() {
  const t = useT();
  const track = useCurrentTrack();
  const history = useSettings((s) => s.history);
  const progress = useSettings((s) => s.trackProgress);
  const displayTrack = track ?? history[0] ?? null;
  const status = usePlayer((s) => s.status);
  const total = usePlayer((s) => s.duration);
  const position = usePosition((s) => s.position);
  const playing = status === "playing" || status === "loading";
  const button = (icon: IconName, label: string, onClick: () => void, disabled = false) => (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className="s-ib !h-9 !w-9"><Icon name={icon} size={20} /></button>
  );
  return (
    <div className="mini-player" data-theme-scope="">
      <header className="s-tb mini-header">
        <span className="min-w-0 truncate font-semibold">{t.miniPlayer}</span>
        <div className="ml-auto flex h-full shrink-0 items-center">
          {button("expand", t.exitMiniPlayer, () => void setMiniPlayer(false))}
          <WindowButtons />
        </div>
      </header>
      <div className="mini-body">
        <div className="mini-cover">{displayTrack?.artworkUrl ? <img src={artwork(displayTrack.artworkUrl, "large") ?? undefined} alt="" /> : <Icon name="disc" size={30} />}</div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold text-text" title={displayTrack?.title}>{displayTrack?.title ?? t.nothingPlaying}</div>
          {displayTrack && <div className="truncate text-[12px] text-muted" title={displayTrack.artist}>{displayTrack.artist}</div>}
          <div className="mt-1 flex items-center gap-2">
            {button("prev", t.previous, player.prev, !track)}
            <button type="button" className="s-pp h-9 w-9" aria-label={playing ? t.pause : t.play} title={playing ? t.pause : t.play} onClick={() => track ? player.toggle() : player.playFrom(history, 0, { kind: "static" }, displayTrack ? progress[`t:${displayTrack.id}`] : undefined)} disabled={!displayTrack}><Icon name={playing ? "pause" : "play"} size={20} /></button>
            {button("next", t.next, player.next, !track)}
          </div>
        </div>
      </div>
      <div className="mini-progress">
        <span>{duration(position * 1000)}</span>
        <input type="range" min={0} max={Math.max(total, 1)} step={0.1} value={Math.min(position, Math.max(total, 1))} disabled={!track || !total} aria-label={t.hkSeek} onChange={(event) => player.seek(Number(event.target.value))} />
        <span>{duration(total * 1000)}</span>
      </div>
    </div>
  );
}
