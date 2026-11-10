/**
 * Moonwave's own server (server/README.md): the track messenger and the theme workshop. Shapes as the API returns
 * them; main talks to the server, the page only sees these.
 */

/** A track as it travels between friends: just enough to show it and open it. */
export interface SocialTrack {
  id: number;
  title: string;
  artist: string;
  artworkUrl: string | null;
  permalinkUrl: string;
  durationMs: number;
}

export interface SocialProfile {
  /** the friend code others type to add you (SKY-XXXXX) */
  code: string;
  name: string;
  /** friends may see what is playing */
  shareNow: boolean;
}

export interface SocialStatus {
  /** this build knows a server */
  available: boolean;
  /** null until "Get my code" */
  profile: SocialProfile | null;
}

export interface Friend {
  code: string;
  name: string;
  since: number;
  /** playing right now (when they share it) */
  now: SocialTrack | null;
  /** their app can join listening rooms (older ones can't) */
  rooms?: boolean;
}

export interface FriendRequest {
  code: string;
  name: string;
  at: number;
}

export interface Friends {
  v: number;
  friends: Friend[];
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
}

export type MessageState = "" | "heard" | "liked" | "queued" | "saved";

/** A playlist from the sender's computer: its name and SoundCloud track ids (the tracks are read from SoundCloud). */
export interface SharedPlaylist {
  title: string;
  ids: number[];
}

export interface Message {
  id: number;
  /** the sender's code (in updates) */
  from?: string;
  mine: boolean;
  /** for a playlist: its first track (what older apps show) */
  track: SocialTrack;
  playlist?: SharedPlaylist;
  sent: number;
  seen: boolean;
  state: MessageState;
}

/** What a poll brings: new tracks for me, unread counts per friend, what friends did with mine, friends' "now". */
export interface SocialUpdate {
  messages: Message[];
  unread: Record<string, number>;
  states: Record<string, MessageState>;
  now: Record<string, SocialTrack>;
  friends?: Friends;
  /** invitations to listening rooms waiting for me */
  invites?: RoomInvite[];
}

// ---- listening rooms ------------------------------------------------------------------------------------------------

/** An invitation to a friend's listening room. */
export interface RoomInvite {
  room: string;
  /** who invited (their code and name) */
  by: string;
  name: string;
  at: number;
  /** the host now (may have changed since) */
  host: string;
  track: SocialTrack | null;
  members: number;
}

export interface RoomItem {
  uid: string;
  track: SocialTrack;
  /** who put it there (a code) */
  by: string;
  /** picked by the host's autopilot */
  auto?: boolean;
}

/**
 * A listening room as the server sends it, whole, after every change: what plays from which second (`position` at
 * the server time `at`, moving on while `playing`), who is in it, the host's queue, suggestions waiting, what played.
 */
export interface Room {
  id: string;
  version: number;
  /** the server's time when this was sent */
  now: number;
  host: string;
  startTogether: boolean;
  members: { code: string; name: string; here: boolean }[];
  track: SocialTrack | null;
  position: number;
  at: number;
  playing: boolean;
  /** who paused or resumed last */
  by: string;
  /** "start together": waiting for everyone to have the track loaded, until `until` at most */
  waiting: { until: number; ready: string[] } | null;
  queue: RoomItem[];
  /** what the host put on (a playlist, the likes…), after the queue: its name, the next few, how many are left */
  list?: { title: string; left: number; next: RoomItem[] } | null;
  /** `list`: a whole playlist suggested (`track` is its first track) — its name and how many tracks */
  suggestions: (RoomItem & { at: number; list?: { title: string; count: number } })[];
  history: { track: SocialTrack; at: number }[];
}

export type RoomOp =
  | { op: "play"; track: SocialTrack; position?: number }
  | { op: "playing"; playing: boolean }
  | { op: "seek"; position: number }
  | { op: "next" }
  | { op: "queueAdd"; track: SocialTrack; next?: boolean; auto?: boolean }
  | { op: "queueRemove"; item: string }
  | { op: "queueMove"; item: string; to: number }
  | { op: "suggest"; track: SocialTrack }
  | { op: "suggestList"; tracks: SocialTrack[]; title: string }
  | { op: "decide"; item: string; take: boolean }
  | { op: "ready"; trackId: number }
  | { op: "playList"; tracks: SocialTrack[]; title: string }
  | { op: "listAppend"; tracks: SocialTrack[] }
  | { op: "listRemove"; item: string }
  | { op: "listClear" }
  | { op: "handOver"; to: string };

/** Where this app stands with rooms: in one (and connected or reconnecting), or not; why the last one ended. */
export interface RoomState {
  room: Room | null;
  /** my code */
  me: string;
  /** server time − this machine's time, ms */
  offset: number;
  connected: boolean;
  /** the room ended by itself (the server closed it, or I was dropped) rather than by my leaving */
  closed: boolean;
}

/** The appearance a workshop theme sets (the Settings → Appearance knobs that travel). */
export interface ThemeLook {
  design: "studio" | "og";
  bg: "liquid" | "cover" | "file" | "none";
  bgBlur: number;
  bgDim: number;
  bgReact: number;
  panelOpacity: number;
  panelBlur: number;
  /** "#rrggbb", or "" = from the cover */
  accent: string;
  /** the interface colour "#rrggbb", or "" = graphite (missing in themes published before it existed) */
  surface?: string;
}

export interface WsTheme {
  id: string;
  name: string;
  description: string;
  author: string;
  likes: number;
  installs: number;
  created: number;
  /** the preview image (an https address on the server) */
  previewUrl: string;
  /** the background's type ("image/png", "video/mp4"), "" without one */
  background: string;
  liked?: boolean;
  /** my own themes only */
  published?: boolean;
  hidden?: boolean;
}

/** A theme in the moderator's list: reported, or hidden (by three reports or by the moderator). */
export interface WsReported extends WsTheme {
  reports: number;
  /** the reports' reasons, " | " between them */
  reasons: string;
  /** the author's friend code */
  authorCode: string;
}

export interface WsThemeFull extends WsTheme {
  look: ThemeLook;
  css: string;
  /** published by this device */
  mine: boolean;
}

export interface WsPage {
  themes: WsTheme[];
  more: boolean;
}

export type WsSort = "new" | "top";

/**
 * A theme's look as it arrives from the server, reduced to the knobs a theme may set, each in its range — what the
 * server checks at publishing, checked again here. The look is spread into this machine's settings, so anything else
 * in it (an older theme's leftovers, a server that has been tampered with) would land there unchecked: a setting the
 * theme has no business changing, or a value that ends up in a style.
 */
export function cleanThemeLook(v: unknown, fallback: ThemeLook): ThemeLook {
  const l = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const num = (x: unknown, lo: number, hi: number, d: number) => (typeof x === "number" && Number.isFinite(x) ? Math.round(Math.min(hi, Math.max(lo, x))) : d);
  const colour = (x: unknown) => (typeof x === "string" && /^#[0-9a-f]{6}$/i.test(x) ? x : "");
  const BGS = ["liquid", "cover", "file", "none"] as const;
  return {
    design: "studio",
    bg: BGS.includes(l.bg as (typeof BGS)[number]) ? (l.bg as ThemeLook["bg"]) : fallback.bg,
    bgBlur: num(l.bgBlur, 0, 40, fallback.bgBlur),
    bgDim: num(l.bgDim, 0, 100, fallback.bgDim),
    bgReact: num(l.bgReact, 0, 100, fallback.bgReact),
    panelOpacity: num(l.panelOpacity, 10, 100, fallback.panelOpacity),
    panelBlur: num(l.panelBlur, 0, 60, fallback.panelBlur),
    accent: colour(l.accent),
    surface: colour(l.surface),
  };
}
