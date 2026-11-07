import { app } from "electron";
import type { AudioHealth } from "@shared/audioHealth";
import { AUDIO_CRASH_TALLY, audioUtilityRole, audioReportLines, exitText, sanitizeHealth, type AudioCrashTally } from "@shared/audioHealth";
import type { AudioCrashEvent } from "@shared/ipc";
import { log } from "./log";
import { send } from "../windows/main-window";
import type { BrowserWindow } from "electron";

/**
 * What main remembers about the audio tract for a report: the helpers that died and the page's own account of its
 * output. The counts survive a page reload, so a crash loop shows even when the page restarted between the crashes;
 * they reset with the app.
 *
 * The page reports after everything that could change the sound (a track, the volume, a device, the graph), and each
 * report lands in the log — so a person whose music is silent but whose window says "playing" sends a file that says
 * what the engine thought.
 */

const MAX_KEPT_PER_MINUTE = 6;
let health: AudioHealth | null = null;
let lastLine = "";
let lastHealthAt = 0;
/** crash logs per minute, so a loop that restarts every second can't fill the log file */
let crashLines: number[] = [];

const crashes: AudioCrashTally = { ...AUDIO_CRASH_TALLY };

/** The engine's account of its output: kept for the report, and written to the log when it changes. */
export function noteAudioHealth(next: AudioHealth, memorySaver: boolean) {
  health = sanitizeHealth(next);
  const line = describe(health);
  const now = Date.now();
  // the page reports after every change, but the same state can arrive twice: write it once, and once a minute anyway
  // so the log always has a recent line to place the crashes against
  if (line === lastLine && now - lastHealthAt <= 60_000) return;
  lastLine = line;
  lastHealthAt = now;
  log("page", `audio: ${line}${memorySaver ? "; graphics disabled (memory saver)" : ""}`);
}

function describe(h: AudioHealth): string {
  const chain = h.context === "none" ? "off" : `${h.graph} ${h.context}${h.routed ? " (decks in it)" : ""}`;
  // the peak is what makes a silent line readable: routed + peak 0 means the sound never reached the graph,
  // routed + a peak above 0 with silence at the speakers points at the output device instead
  const peak = h.level === null ? "" : `, peak ${h.level}`;
  return `${h.element}, stream ${h.stream}, ${h.output === "default" ? "system default" : "chosen device"}${h.sinkError ? ` (sink error: ${h.sinkError})` : ""}, graph ${chain}, ${h.muted ? "muted" : `volume ${Math.round(h.volume * 100)}%`}${peak}, rebuilds ${h.rebuilds}`;
}

/**
 * A Chromium media helper died. The sound's service going takes the tract down with it; the media device service is
 * what a chosen output device starts, so its death names the device rather than the stream. Main tells the page, which
 * rebuilds and retries; the page tells the person if it can't.
 */
export function noteChildProcessGone(win: BrowserWindow | null, d: { type: string; name?: string; reason: string; exitCode: number }) {
  if (d.reason === "clean-exit") return;
  const role = audioUtilityRole(d.type, d.name);
  if (!role) return;
  if (role === "audio") crashes.audio++;
  else crashes.capture++;
  crashes.lastExit = d.exitCode;
  crashes.lastAt = new Date().toISOString();

  const now = Date.now();
  crashLines = crashLines.filter((at) => now - at < 60_000);
  if (crashLines.length < MAX_KEPT_PER_MINUTE) {
    crashLines.push(now);
    log("main", `audio helper (${role}) gone: ${d.reason}, exit ${exitText(d.exitCode)}; ${role === "audio" ? `audio service ${crashes.audio}×` : `video capture ${crashes.capture}×`} this session`);
  }
  const event: AudioCrashEvent = { role, count: role === "audio" ? crashes.audio : crashes.capture, reason: d.reason, exitCode: d.exitCode };
  send(win, "audio:crashed", event);
}

/** The report's audio section: runtime versions, the engine's last account, and the crashes. */
export function audioReport(): string[] {
  return audioReportLines({
    health,
    crashes,
    runtime: {
      electron: process.versions.electron ?? app.getVersion(),
      chrome: process.versions.chrome ?? "?",
    },
    // the graph is in use when the page built it; the counts say which knob did it
    webAudioInUse: !!health && health.context !== "none",
  });
}
