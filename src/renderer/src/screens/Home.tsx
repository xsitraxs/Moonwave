import { useMemo } from "react";
import { artwork, type Track } from "@shared/types";
import { useFeed } from "@/api/queries";
import { HomeStart, useHomeActions } from "@/components/home/HomeStart";
import TrackList from "@/components/tracks/TrackList";
import Icon from "@/components/ui/Icon";
import { Screen } from "@/components/ui/Screen";
import { useT } from "@/i18n";
import { useVisibleTracks } from "@/lib/hidden";
import { useAuth } from "@/state/auth";
import { useNav } from "@/state/nav";
import { player, usePlayer } from "@/state/player";
import { useSettings } from "@/state/settings";
import StudioHome from "./StudioHome";

const STATIC = { kind: "static" } as const;

function Heading({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <div className="mb-3 mt-9 flex items-baseline gap-4">
      <h2 className="home-heading text-xl font-semibold text-text">{title}</h2>
      {action && (
        <button type="button" onClick={onAction} className="ml-auto font-type text-xs text-muted hover:text-text">
          {action}
        </button>
      )}
    </div>
  );
}

/** Recently played, as covers, one row (as many as fit): a click plays from there on through the history. */
function Recent({ tracks }: { tracks: Track[] }) {
  const t = useT();
  const currentId = usePlayer((s) => s.queue[s.index]?.id ?? null);
  const playing = usePlayer((s) => s.status === "playing" || s.status === "loading");
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] grid-rows-[auto] gap-x-5 overflow-hidden [grid-auto-rows:0]">
      {tracks.map((track, i) => {
        const on = track.id === currentId;
        return (
          <button
            type="button"
            key={track.id}
            onClick={() => (on ? player.toggle() : player.playFrom(tracks, i, STATIC))}
            aria-label={`${on && playing ? t.pause : t.play}: ${track.title}`}
            className="group min-w-0 text-left"
          >
            <span className="relative block">
              <span className="home-card-cover block aspect-square w-full overflow-hidden rounded-md bg-[var(--paper)] shadow-[0_10px_24px_rgba(0,0,0,0.35)]">
                {track.artworkUrl ? <img src={artwork(track.artworkUrl, "t300x300") ?? undefined} alt="" loading="lazy" decoding="async" draggable={false} className="h-full w-full object-cover" /> : <span className="stipple-night block h-full w-full" />}
              </span>
              <span className={`home-play absolute bottom-2 right-2 grid h-9 w-9 place-items-center rounded-full transition-opacity motion-color ${on ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"}`}>
                <Icon name={on && playing ? "pause" : "play"} size={16} />
              </span>
            </span>
            <span className={`mt-2 block truncate text-sm font-medium ${on ? "text-glow" : "text-text"}`}>{track.title}</span>
            <span className="block truncate text-xs text-muted">{track.artist}</span>
          </button>
        );
      })}
    </div>
  );
}

function FeedPreview() {
  const t = useT();
  const q = useFeed(true);
  const all = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  const tracks = useVisibleTracks(all).slice(0, 6);
  if (!tracks.length) return null;
  return <TrackList tracks={tracks} source={STATIC} label={t.feed} />;
}

/**
 * Home in the night design. The start block gives the place and the next step; below it are the things you played,
 * then what is new in the feed. Signed out, the app's own history is all there is, and that is said up front.
 */
function OgHome() {
  const t = useT();
  const open = useNav((s) => s.open);
  const auth = useAuth((s) => s.status);
  const signedIn = auth?.mode === "session";
  const history = useSettings((s) => s.history);
  const recent = useVisibleTracks(history).slice(0, 12);
  const { primary, secondary, hasMusic } = useHomeActions();

  return (
    <Screen label={t.home}>
      <HomeStart name={auth?.mode === "session" ? auth.user?.username : undefined} signedIn={signedIn} hasMusic={hasMusic} primary={primary} secondary={secondary} />

      {recent.length > 0 && (
        <>
          <Heading title={t.jumpBackIn} action={t.showAll} onAction={() => open("history", { name: "history" })} />
          <Recent tracks={recent} />
        </>
      )}

      {signedIn && (
        <>
          <Heading title={t.newInFeed} action={t.showAll} onAction={() => open("feed", { name: "feed" })} />
          <FeedPreview />
        </>
      )}
    </Screen>
  );
}

export default function Home() {
  const studio = useSettings((s) => s.prefs.look.design === "studio");
  return studio ? <StudioHome /> : <OgHome />;
}
