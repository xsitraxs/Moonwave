/**
 * The audio tract's health, shared by the page and main: what the engine says about its output, which media helper
 * a dead utility process was, and how many rebuilds a failure may cost. Kept free of stream URLs, tokens and device
 * ids — this is what "Report a problem" prints, so it must never carry anything private.
 */

/** What the engine reports about the output. Pushed to main so a report can explain silence the UI didn't show. */
export interface AudioHealth {
  /** the page's AudioContext, "none" when the Web Audio chain was never built ("interrupted" is Windows hiding it) */
  context: AudioContextState | "none";
  /** what asked for the Web Audio chain: the equalizer, the sound-reactive sky, both, or nothing */
  graph: "off" | "eq" | "reactive" | "both";
  /** the stream the current deck holds, and what that <audio> element itself reports */
  stream: "hls" | "progressive" | "none";
  element: "playing" | "paused" | "waiting" | "none";
  /** 0..1, the slider's value before the curve */
  volume: number;
  muted: boolean;
  output: "default" | "custom";
  /** why the last setSinkId failed (a device that is gone), null when it worked */
  sinkError: string | null;
  /** the loudest the analyser heard in the last second, 0..255; null without an analyser */
  level: number | null;
  /** rebuilds of the output this session (each one reloads the stream) */
  rebuilds: number;
}

const LONG = 200;
const short = (v: unknown) => (typeof v === "string" ? v.slice(0, LONG).replace(/https?:\/\/\S+/gi, "…") : null);

/**
 * What main keeps from the page's report. The page is the app's own, but this is what gets attached to a bug report
 * and written to the log, so the shape is enforced here: fixed sets for the states, numbers clamped, and any string
 * truncated with links removed — a device error message never smuggles a stream URL or a token into a report.
 */
export function sanitizeHealth(raw: AudioHealth): AudioHealth {
  const state = (v: unknown, set: readonly string[], fallback: string) => (typeof v === "string" && set.includes(v) ? v : fallback);
  const n = (v: unknown, min: number, max: number, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
  return {
    context: state(raw.context, ["none", "suspended", "running", "closed", "interrupted"], "none") as AudioHealth["context"],
    graph: state(raw.graph, ["off", "eq", "reactive", "both"], "off") as AudioHealth["graph"],
    stream: state(raw.stream, ["hls", "progressive", "none"], "none") as AudioHealth["stream"],
    element: state(raw.element, ["playing", "paused", "waiting", "none"], "none") as AudioHealth["element"],
    volume: n(raw.volume, 0, 1, AUDIO_HEALTH_DEFAULTS.volume),
    muted: raw.muted === true,
    output: raw.output === "custom" ? "custom" : "default",
    sinkError: short(raw.sinkError),
    level: raw.level === null || raw.level === undefined ? null : Math.round(n(raw.level, 0, 255, 0)),
    rebuilds: Math.round(n(raw.rebuilds, 0, 999, 0)),
  };
}

/** What the engine knows before anything played. */
export const AUDIO_HEALTH_DEFAULTS: AudioHealth = {
  context: "none",
  graph: "off",
  stream: "none",
  element: "none",
  volume: 0.8,
  muted: false,
  output: "default",
  sinkError: null,
  level: null,
  rebuilds: 0,
};

/** How a dead utility process relates to the sound. */
export type AudioUtilityRole = "audio" | "capture";

/**
 * Which media helper a gone utility process was. Chromium's "Audio Service" carries the sound; the "Video Capture"
 * helper is the media device service that setSinkId starts, so its death points at a chosen output device rather
 * than at the stream. Everything else (GPU, network, storage) is left out: the report says so separately.
 */
export function audioUtilityRole(type: string, name?: string): AudioUtilityRole | null {
  if (type !== "Utility") return null;
  const n = (name ?? "").toLowerCase();
  if (n.includes("video capture")) return "capture";
  // Windows calls it "Audio Service"; the mojo name on the other platforms is audio.mojom.AudioService
  if (n.includes("audio")) return "audio";
  return null;
}

/** The few Windows status codes worth naming, so a log line reads like something instead of a large negative number. */
const EXIT_NAMES: Record<string, string> = {
  "80000003": "STATUS_BREAKPOINT",
  c0000005: "STATUS_ACCESS_VIOLATION",
  c0000374: "STATUS_HEAP_CORRUPTION",
  c0000409: "STATUS_STACK_BUFFER_OVERRUN",
};

/**
 * A process exit code as the log and the report show it: the hexadecimal code, its Windows name when it has one,
 * and the signed 32-bit number Electron reports (-2147483645 is 0x80000003, STATUS_BREAKPOINT).
 */
export function exitText(code: number): string {
  if (code === 0) return "0";
  const hex = (code >>> 0).toString(16).padStart(8, "0");
  const name = EXIT_NAMES[hex];
  return `${name ? `0x${hex} ${name}` : `0x${hex}`} (${code})`;
}

/** What to do about the Web Audio chain, given what wants it and what is already inside it. */
export type GraphAction =
  /** nothing wants a chain, and none exists */
  | "idle"
  /** the chain stays as it is */
  | "keep"
  /** something wants it and none exists yet */
  | "build"
  /** nothing wants it and no deck is inside it, so it can be closed */
  | "drop"
  /** something wants it, but this machine cannot route an element (hardware acceleration off) */
  | "blocked";

/**
 * The chain's fate. The one rule that matters: a deck whose element was handed to Web Audio cannot return to the
 * speakers by itself, so the chain must never be closed while a deck is still inside it — that would be silence with a
 * player that says "playing". Closing it is only safe when nothing was routed through it.
 */
export function graphAction(s: { wanted: number; hasChain: boolean; stranded: boolean; canRoute: boolean }): GraphAction {
  if (s.wanted > 0) {
    if (!s.canRoute) return "blocked";
    return s.hasChain ? "keep" : "build";
  }
  if (!s.hasChain) return "idle";
  return s.stranded ? "keep" : "drop";
}

/** What a context that closed leaves behind: the chain is dropped, and the sound rebuilt only if it was inside the graph. */
export type ChainLostAction = "detach" | "detach-and-recover";

export function chainLostAction(s: { stranded: boolean; wanted: boolean }): ChainLostAction {
  return s.stranded && s.wanted ? "detach-and-recover" : "detach";
}

/**
 * Whether a teardown may close the context it was made for. Recovery creates a new context synchronously, so the
 * cleanup of the old one must be compared by identity: anything else would close the context recovery just built.
 */
export function teardownIsCurrent(dead: object | null, current: object | null): boolean {
  return current !== null && current !== undefined && dead === current;
}

/** Whether a play() failure is the ordinary autoplay policy rather than a broken output. */
export function isPolicyRefusal(err: unknown): boolean {
  const name = err && typeof err === "object" && "name" in err ? String((err as { name: unknown }).name) : "";
  // NotAllowedError: the page hasn't been interacted with yet (a tray click, a hotkey); the next click plays
  return name === "NotAllowedError";
}

/** What to do about a silent or broken output. */
export type RecoveryStep = "none" | "resume" | "rebuild" | "give-up";

/** Rebuilds one failure may cost: each one reloads the stream, so they are spent, not repeated forever. */
export const MAX_REBUILDS = 2;

/** After this much quiet between failures the budget is full again (the crash loops this guards against are continuous). */
export const REBUILD_BUDGET_MS = 60_000;

/**
 * The next step for a silent output: nothing while the person didn't ask for sound, a cheap resume while the context
 * only fell asleep, a rebuild while the budget lasts, and then a plain error for the UI instead of pretending to play.
 */
export function recoveryStep(s: {
  /** the player means to be heard (status playing, not paused by the person) */
  wanted: boolean;
  /** rebuilds already spent on this failure */
  rebuilds: number;
  /** a context exists and is suspended, which resume() can bring back */
  resumable: boolean;
  /** a context exists and is closed, or the decks are held by a graph that can never play again */
  dead: boolean;
}): RecoveryStep {
  if (!s.wanted) return "none";
  if (s.rebuilds >= MAX_REBUILDS) return "give-up";
  if (s.dead) return "rebuild";
  if (s.resumable) return "resume";
  return "rebuild";
}

/** The crash tally a report prints. */
export interface AudioCrashTally {
  audio: number;
  capture: number;
  /** the last exit code and when it came, ISO time */
  lastExit: number | null;
  lastAt: string | null;
}

export const AUDIO_CRASH_TALLY: AudioCrashTally = { audio: 0, capture: 0, lastExit: null, lastAt: null };

/**
 * The report's audio section: the runtime that has to be healthy for any of this to work, what the engine last said,
 * and the media helpers that died. Safe by construction — the values are all counts, states and version strings.
 */
export function audioReportLines(input: {
  health: AudioHealth | null;
  crashes: AudioCrashTally;
  /** from process.versions: the versions that actually run, not the ones package.json asks for */
  runtime: { electron: string; chrome: string };
  /** true when the sound-reactive sky or the equalizer put the sound through Web Audio */
  webAudioInUse: boolean;
}): string[] {
  const { health, crashes, runtime } = input;
  const lines = [`runtime: Electron ${runtime.electron}, Chromium ${runtime.chrome}`];
  if (!health) {
    lines.push("audio: the page has not reported yet (nothing played, or the page is older than this report)");
  } else {
    const chain = health.context === "none" ? "off (decks play straight to the speakers)" : `${health.graph}, context ${health.context}`;
    const device = health.output === "default" ? "system default" : "chosen in Settings";
    lines.push(`audio: ${health.element}, stream ${health.stream}; output ${device}${health.sinkError ? ` (last setSinkId failed: ${health.sinkError})` : ""}`);
    lines.push(`audio: Web Audio chain ${chain}${health.muted ? ", muted" : `, volume ${Math.round(health.volume * 100)}%`}${health.level === null ? "" : `, analyser peak ${health.level}/255`}; rebuilds ${health.rebuilds}`);
    if (input.webAudioInUse && health.context !== "none") {
      lines.push("audio: the sound is routed through Web Audio for the equalizer or the sound-reactive sky, so a dead context silences it while <audio> still reports playing");
    }
  }
  if (!crashes.audio && !crashes.capture) {
    lines.push("audio helpers: none crashed this session");
  } else {
    const parts = [];
    if (crashes.audio) parts.push(`audio service ${crashes.audio}×`);
    if (crashes.capture) parts.push(`video capture ${crashes.capture}×`);
    lines.push(`audio helpers: ${parts.join(", ")}${crashes.lastExit === null ? "" : `; last exit ${exitText(crashes.lastExit)}${crashes.lastAt ? ` at ${crashes.lastAt}` : ""}`}`);
  }
  return lines;
}
