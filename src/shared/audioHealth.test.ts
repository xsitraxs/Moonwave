import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AUDIO_HEALTH_DEFAULTS,
  MAX_REBUILDS,
  audioReportLines,
  audioUtilityRole,
  exitText,
  isPolicyRefusal,
  recoveryStep,
  sanitizeHealth,
  type AudioHealth,
} from "./audioHealth.ts";

// ---- which utility process a death belongs to ---------------------------------------------------------------

test("audio helpers: Windows' names, and the mojo name the other platforms use", () => {
  assert.equal(audioUtilityRole("Utility", "Audio Service"), "audio");
  assert.equal(audioUtilityRole("Utility", "audio.mojom.AudioService"), "audio");
  assert.equal(audioUtilityRole("Utility", "Video Capture"), "capture");
});

test("audio helpers: the processes that are not part of the sound are left alone", () => {
  assert.equal(audioUtilityRole("GPU"), null);
  assert.equal(audioUtilityRole("Utility", "Network Service"), null);
  assert.equal(audioUtilityRole("Utility", "Storage Service"), null);
  assert.equal(audioUtilityRole("Utility"), null);
});

// ---- how a failure reads in the log and the report ----------------------------------------------------------

test("exit codes: the reported -2147483645 reads as the breakpoint Windows raised", () => {
  assert.equal(exitText(-2147483645), "0x80000003 STATUS_BREAKPOINT (-2147483645)");
});

test("exit codes: access violations are named, unknown ones keep their hex, a clean exit is just 0", () => {
  assert.equal(exitText(-1073741819), "0xc0000005 STATUS_ACCESS_VIOLATION (-1073741819)");
  assert.equal(exitText(5), "0x00000005 (5)");
  assert.equal(exitText(0), "0");
});

// ---- the autoplay policy is not a fault ---------------------------------------------------------------------

test("a refusal because the page wasn't clicked yet is the ordinary policy, not a broken output", () => {
  assert.equal(isPolicyRefusal({ name: "NotAllowedError" }), true);
  assert.equal(isPolicyRefusal(new DOMExceptionLike("NotAllowedError")), true);
  assert.equal(isPolicyRefusal({ name: "NotSupportedError" }), false);
  assert.equal(isPolicyRefusal(null), false);
  assert.equal(isPolicyRefusal("nonsense"), false);
});

class DOMExceptionLike {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
}

// ---- the recovery decision ----------------------------------------------------------------------------------

test("recovery: nobody asked for sound, so nothing is rebuilt (a pause is not a fault)", () => {
  assert.equal(recoveryStep({ wanted: false, rebuilds: 0, resumable: true, dead: false }), "none");
  // even a dead context is left alone while the person isn't listening: play() rebuilds when they ask
  assert.equal(recoveryStep({ wanted: false, rebuilds: 99, resumable: false, dead: true }), "none");
});

test("recovery: a context that only fell asleep is woken, not rebuilt", () => {
  assert.equal(recoveryStep({ wanted: true, rebuilds: 0, resumable: true, dead: false }), "resume");
});

test("recovery: a dead or absent context is rebuilt while the budget lasts", () => {
  assert.equal(recoveryStep({ wanted: true, rebuilds: 0, resumable: false, dead: true }), "rebuild");
  assert.equal(recoveryStep({ wanted: true, rebuilds: MAX_REBUILDS - 1, resumable: false, dead: true }), "rebuild");
});

test("recovery: the budget runs out into a plain error, never an endless crash loop", () => {
  assert.equal(recoveryStep({ wanted: true, rebuilds: MAX_REBUILDS, resumable: false, dead: true }), "give-up");
  // even a cheap resume is refused once the budget is gone, so a loop can't spin on it
  assert.equal(recoveryStep({ wanted: true, rebuilds: MAX_REBUILDS, resumable: true, dead: false }), "give-up");
});

// ---- the report ---------------------------------------------------------------------------------------------

const health = (over: Partial<AudioHealth> = {}): AudioHealth => ({ ...AUDIO_HEALTH_DEFAULTS, ...over });
const runtime = { electron: "44.7.2", chrome: "140.0.7339.82" };
const noCrashes = { audio: 0, capture: 0, lastExit: null, lastAt: null };

test("report: the runtime that has to be healthy is named, not only the app's version", () => {
  const lines = audioReportLines({ health: null, crashes: noCrashes, runtime, webAudioInUse: false });
  assert.equal(lines[0], "runtime: Electron 44.7.2, Chromium 140.0.7339.82");
});

test("report: a page that never reported says so instead of implying health", () => {
  const lines = audioReportLines({ health: null, crashes: noCrashes, runtime, webAudioInUse: false });
  assert.match(lines[1]!, /has not reported yet/);
  assert.match(lines.join("\n"), /none crashed/);
});

test("report: a healthy tract on the element's own output is one plain line", () => {
  const lines = audioReportLines({
    health: health({ element: "playing", stream: "hls" }),
    crashes: noCrashes,
    runtime,
    webAudioInUse: false,
  });
  const text = lines.join("\n");
  assert.match(text, /audio: playing, stream hls; output system default/);
  assert.match(text, /Web Audio chain off \(decks play straight to the speakers\)/);
  // nothing about Web Audio silencing anything: there is no chain
  assert.doesNotMatch(text, /a dead context silences it/);
});

test("report: a chosen device that failed to be used is named", () => {
  const lines = audioReportLines({
    health: health({ output: "custom", sinkError: "NotFoundError: device not found" }),
    crashes: noCrashes,
    runtime,
    webAudioInUse: false,
  });
  const text = lines.join("\n");
  assert.match(text, /output chosen in Settings \(last setSinkId failed: NotFoundError: device not found\)/);
});

test("report: with the sound going through Web Audio, the trap is spelled out", () => {
  const lines = audioReportLines({
    health: health({ context: "suspended", graph: "reactive", element: "playing" }),
    crashes: noCrashes,
    runtime,
    webAudioInUse: true,
  });
  const text = lines.join("\n");
  assert.match(text, /Web Audio chain reactive, context suspended/);
  assert.match(text, /a dead context silences it while <audio> still reports playing/);
});

test("report: muted is printed as muted, not as a volume that happens to be silent", () => {
  const lines = audioReportLines({ health: health({ muted: true, volume: 0.8 }), crashes: noCrashes, runtime, webAudioInUse: false });
  const text = lines.join("\n");
  assert.match(text, /, muted; rebuilds 0/);
  assert.doesNotMatch(text, /volume/);
});

test("report: the helpers that died are counted, with the code and time of the last one", () => {
  const lines = audioReportLines({
    health: health(),
    crashes: { audio: 7, capture: 3, lastExit: -2147483645, lastAt: "2026-11-07T04:15:00.000Z" },
    runtime,
    webAudioInUse: false,
  });
  const text = lines.join("\n");
  assert.match(text, /audio service 7×, video capture 3×/);
  assert.match(text, /last exit 0x80000003 STATUS_BREAKPOINT \(-2147483645\) at 2026-11-07T04:15:00.000Z/);
});

test("report: never a URL, a token or a device id — the section is built from states and counts only", () => {
  const lines = audioReportLines({
    health: health({ element: "playing", stream: "hls", sinkError: null }),
    crashes: { audio: 1, capture: 0, lastExit: -2147483645, lastAt: "2026-11-07T04:15:00.000Z" },
    runtime,
    webAudioInUse: true,
  });
  const text = lines.join("\n");
  assert.doesNotMatch(text, /https?:\/\//);
  assert.doesNotMatch(text, /[A-Za-z0-9_-]{24,}/); // the same shape main blanks out of the log
});

// ---- what main keeps from the page ---------------------------------------------------------------------------

test("sanitize: the states are taken from fixed sets, so a report can never print an arbitrary string", () => {
  const kept = sanitizeHealth({ ...AUDIO_HEALTH_DEFAULTS, element: "playing", context: "running", stream: "hls", graph: "both", output: "custom" });
  assert.equal(kept.element, "playing");
  assert.equal(kept.context, "running");
  assert.equal(kept.stream, "hls");
  assert.equal(kept.graph, "both");
  assert.equal(kept.output, "custom");

  const junk = sanitizeHealth({ ...AUDIO_HEALTH_DEFAULTS, element: "screaming", context: "exploded", stream: "x", graph: "y", output: "z" } as never);
  assert.equal(junk.element, "none");
  assert.equal(junk.context, "none");
  assert.equal(junk.stream, "none");
  assert.equal(junk.graph, "off");
  assert.equal(junk.output, "default");
});

test("sanitize: numbers are clamped and rounded, so one bad value can't break the report's arithmetic", () => {
  const h = sanitizeHealth({ ...AUDIO_HEALTH_DEFAULTS, volume: 9, level: -4, rebuilds: 1e9, muted: "yes" } as never);
  assert.equal(h.volume, 1);
  assert.equal(h.level, 0);
  assert.equal(h.rebuilds, 999);
  // only a real true counts as muted
  assert.equal(h.muted, false);
});

test("sanitize: a device error message is truncated and stripped of links before it reaches a report", () => {
  const long = `NotFoundError: ${"x".repeat(400)} https://api.soundcloud.com/media/soundcloud:tracks:1/stream?token=secret`;
  const h = sanitizeHealth({ ...AUDIO_HEALTH_DEFAULTS, sinkError: long });
  assert.ok(h.sinkError!.length <= 200);
  assert.doesNotMatch(h.sinkError!, /https?:\/\//);
  assert.doesNotMatch(h.sinkError!, /secret/);
});

test("sanitize: a missing level stays missing (no analyser) rather than becoming 0", () => {
  assert.equal(sanitizeHealth({ ...AUDIO_HEALTH_DEFAULTS, level: null }).level, null);
});
