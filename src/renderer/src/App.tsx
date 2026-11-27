import { MotionConfig, motion } from "framer-motion";
import LivingBackdrop from "@/components/deco/LivingBackdrop";
import { enter } from "@/lib/motion";
import SvgDefs from "@/components/deco/SvgDefs";
import NowPlaying from "@/components/player/NowPlaying";
import AppearancePopover from "@/components/studio/AppearancePopover";
import HotkeysModal from "@/components/studio/HotkeysModal";
import MiniPlayer from "@/components/studio/MiniPlayer";
import StudioPlayerBar from "@/components/studio/PlayerBar";
import StudioQueue from "@/components/studio/Queue";
import StudioSidebar from "@/components/studio/Sidebar";
import StudioTitleBar from "@/components/studio/TitleBar";
import { useUi } from "@/state/ui";
import ScreenBoundary from "@/components/ui/ScreenBoundary";
import History from "@/screens/History";
import Local from "@/screens/Local";
import Home from "@/screens/Home";
import Inbox from "@/screens/Inbox";
import Import from "@/screens/Import";
import Login from "@/screens/Login";
import { Albums, Following, Stations } from "@/screens/Library";
import Workshop from "@/screens/Workshop";
import SendSheet from "@/components/social/SendSheet";
import InviteFloat from "@/components/room/Invites";
import RoomSheet from "@/components/room/RoomSheet";
import SkipNotice from "@/components/player/SkipNotice";
import Dj from "@/screens/Dj";
import Feed from "@/screens/Feed";
import Likes from "@/screens/Likes";
import Playlist from "@/screens/Playlist";
import Playlists from "@/screens/Playlists";
import Profile from "@/screens/Profile";
import Search from "@/screens/Search";
import Settings from "@/screens/Settings";
import Track from "@/screens/Track";
import TrackMenu from "@/components/tracks/TrackMenu";
import Toast from "@/components/ui/Toast";
import PlaylistPicker from "@/components/tracks/PlaylistPicker";
import CheckDialog from "@/components/CheckDialog";
import SharingPrompt from "@/components/SharingPrompt";
import Onboarding from "@/components/Onboarding";
import Dialog from "@/components/Dialog";
import { useNav, type Route } from "@/state/nav";

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
        <ScreenFor route={route} />
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
  if (mini) return <MotionConfig reducedMotion="user"><SvgDefs /><MiniPlayer /><Toast /></MotionConfig>;
  return (
    <MotionConfig reducedMotion="user">
      <SvgDefs />
      <LivingBackdrop />
      <TrackMenu />
      <PlaylistPicker />
      <CheckDialog />
      <SendSheet />
      <RoomSheet />
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
        <NowPlaying />
      </div>
      <AppearancePopover />
      <HotkeysModal />
      <Dialog />
      <SharingPrompt />
      <Onboarding />
    </MotionConfig>
  );
}

