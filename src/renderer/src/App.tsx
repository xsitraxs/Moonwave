import { Suspense, lazy, useState, type ReactNode } from "react";
import { MotionConfig, motion } from "framer-motion";
import LivingBackdrop from "@/components/deco/LivingBackdrop";
import { enter } from "@/lib/motion";
import SvgDefs from "@/components/deco/SvgDefs";
import MiniPlayer from "@/components/studio/MiniPlayer";
import StudioPlayerBar from "@/components/studio/PlayerBar";
import StudioQueue from "@/components/studio/Queue";
import StudioSidebar from "@/components/studio/Sidebar";
import StudioTitleBar from "@/components/studio/TitleBar";
import { useUi } from "@/state/ui";
import { useRoomSheet } from "@/state/room";
import { useSocial } from "@/state/social";
import ScreenBoundary from "@/components/ui/ScreenBoundary";
import { ScreenFallback } from "@/components/ui/States";
import Home from "@/screens/Home";
import InviteFloat from "@/components/room/Invites";
import SkipNotice from "@/components/player/SkipNotice";
import TrackMenu from "@/components/tracks/TrackMenu";
import Toast from "@/components/ui/Toast";
import PlaylistPicker from "@/components/tracks/PlaylistPicker";
import CheckDialog from "@/components/CheckDialog";
import SharingPrompt from "@/components/SharingPrompt";
import Onboarding from "@/components/Onboarding";
import Dialog from "@/components/Dialog";
import { useNav, type Route } from "@/state/nav";

// Lazy-loaded screens: keeps initial window startup fast by deferring secondary routes until navigated to.
const Likes = lazy(() => import("@/screens/Likes"));
const Feed = lazy(() => import("@/screens/Feed"));
const Playlists = lazy(() => import("@/screens/Playlists"));
const Playlist = lazy(() => import("@/screens/Playlist"));
const Track = lazy(() => import("@/screens/Track"));
const Profile = lazy(() => import("@/screens/Profile"));
const History = lazy(() => import("@/screens/History"));
const Local = lazy(() => import("@/screens/Local"));
const Search = lazy(() => import("@/screens/Search"));
const Albums = lazy(() => import("@/screens/Library").then((m) => ({ default: m.Albums })));
const Stations = lazy(() => import("@/screens/Library").then((m) => ({ default: m.Stations })));
const Following = lazy(() => import("@/screens/Library").then((m) => ({ default: m.Following })));
const Inbox = lazy(() => import("@/screens/Inbox"));
const Workshop = lazy(() => import("@/screens/Workshop"));
const Settings = lazy(() => import("@/screens/Settings"));
const Login = lazy(() => import("@/screens/Login"));
const Import = lazy(() => import("@/screens/Import"));
const Dj = lazy(() => import("@/screens/Dj"));

// Lazy-loaded heavy overlays & modals: mounted on first open, then kept mounted so AnimatePresence exit animations work.
const NowPlaying = lazy(() => import("@/components/player/NowPlaying"));
const AppearancePopover = lazy(() => import("@/components/studio/AppearancePopover"));
const CommandPalette = lazy(() => import("@/components/studio/CommandPalette"));
const HotkeysModal = lazy(() => import("@/components/studio/HotkeysModal"));
const RoomSheet = lazy(() => import("@/components/room/RoomSheet"));
const SendSheet = lazy(() => import("@/components/social/SendSheet"));

function LazyOverlay({ active, children }: { active: boolean; children: ReactNode }) {
  const [ever, setEver] = useState(active);
  if (active && !ever) setEver(true);
  if (!ever) return null;
  return <Suspense fallback={null}>{children}</Suspense>;
}

function ScreenFor({ route }: { route: Route }) {
  switch (route.name) {
    case "home":
      return <Home />;
    case "likes":
      return <Likes />;
    case "feed":
      return <Feed />;
    case "playlists":
      return <Playlists />;
    case "playlist":
      return <Playlist id={route.id} />;
    case "track":
      return <Track id={route.id} />;
    case "profile":
      return <Profile userId={route.userId} />;
    case "history":
      return <History />;
    case "local":
      return <Local />;
    case "search":
      return <Search />;
    case "albums":
      return <Albums />;
    case "stations":
      return <Stations />;
    case "following":
      return <Following />;
    case "inbox":
      return <Inbox />;
    case "workshop":
      return <Workshop />;
    case "settings":
      return <Settings />;
    case "signin":
      return <Login />;
    case "import":
      return <Import />;
    case "dj":
      return <Dj />;
  }
}

function Page() {
  const route = useNav((s) => s.route);
  return (
    <motion.div key={JSON.stringify(route)} className="h-full" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={enter()}>
      <ScreenBoundary>
        <Suspense fallback={<ScreenFallback />}>
          <ScreenFor route={route} />
        </Suspense>
      </ScreenBoundary>
    </motion.div>
  );
}

/**
 * The window: title bar with search, sidebar, the page, the queue on the right, the player, over the living
 * background. While the workshop takes its picture of the look (`posing`), the page and the toasts step aside so
 * the background shows in the middle.
 */
export default function App() {
  const full = useUi((s) => s.fullOpen);
  const queuePhase = useUi((s) => s.queuePhase);
  const posing = useUi((s) => s.posing);
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const mini = useUi((s) => s.miniPlayer);
  const appearanceOpen = useUi((s) => s.appearance !== null);
  const commandPaletteOpen = useUi((s) => s.commandPaletteOpen);
  const hotkeysOpen = useUi((s) => s.hotkeysOpen);
  const roomOpen = useRoomSheet((s) => s.open);
  const sendOpen = useSocial((s) => Boolean(s.sending ?? s.sendingPlaylist));
  if (mini) return <MotionConfig reducedMotion="user"><SvgDefs /><MiniPlayer /><Toast /></MotionConfig>;
  return (
    <MotionConfig reducedMotion="user">
      <SvgDefs />
      <LivingBackdrop />
      <TrackMenu />
      <PlaylistPicker />
      <CheckDialog />
      <LazyOverlay active={sendOpen}><SendSheet /></LazyOverlay>
      <LazyOverlay active={roomOpen}><RoomSheet /></LazyOverlay>
      <InviteFloat />
      <SkipNotice />
      {/* the theme workshop's CSS is scoped to this element (lib/themeCss.ts): a theme restyles the shell and what is in it, nothing outside */}
      <div data-theme-scope="" data-queue={queuePhase} className={`s-shell relative z-10${full ? " full-open" : ""}${collapsed ? " s-collapsed" : ""}`}>
        <StudioTitleBar />
        <StudioSidebar />
        <main className="relative min-h-0 overflow-hidden">
          {!posing && <Page />}
          {!posing && <Toast />}
        </main>
        <StudioQueue />
        <StudioPlayerBar />
        <LazyOverlay active={full}><NowPlaying /></LazyOverlay>
      </div>
      <LazyOverlay active={appearanceOpen}><AppearancePopover /></LazyOverlay>
      <LazyOverlay active={commandPaletteOpen}><CommandPalette /></LazyOverlay>
      <LazyOverlay active={hotkeysOpen}><HotkeysModal /></LazyOverlay>
      <Dialog />
      <SharingPrompt />
      <Onboarding />
    </MotionConfig>
  );
}

