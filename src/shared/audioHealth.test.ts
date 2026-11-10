import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AUDIO_HEALTH_DEFAULTS,
  MAX_REBUILDS,
  audioReportLines,
  canRouteAudio,
  ROUTE_SILENCE_MS,
  routeIsSilent,
  silenceVerdict,
  audioUtilityRole,
  exitText,
  isPolicyRefusal,
  recoveryStep,
  sanitizeHealth,
  graphAction,
  chainLostAction,
  teardownIsCurrent,
  contextEventAction,
  wantedGraph,
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

// ---- the chain's lifecycle (the three defects found by the audit, kept from coming back) ----------------------

test("chain: a deck inside a graph nothing wants is never dropped — closing it would silence that deck", () => {
  // the equalizer and the sky were switched off while a deck was routed: the graph must stay, the deck is moved off it
  // by a restart instead (a closed graph is unrecoverable for a routed element)
  assert.equal(graphAction({ wanted: 0, hasChain: true, stranded: true, canRoute: true }), "keep");
});

test("chain: nothing wants it and nothing is inside it, so it can be closed for real", () => {
  assert.equal(graphAction({ wanted: 0, hasChain: true, stranded: false, canRoute: true }), "drop");
});

test("chain: something wants it — built once, then kept, and never built on a machine that cannot route", () => {
  assert.equal(graphAction({ wanted: 1, hasChain: false, stranded: false, canRoute: true }), "build");
  assert.equal(graphAction({ wanted: 2, hasChain: true, stranded: false, canRoute: true }), "keep");
  // hardware acceleration off: routing an element there is silence, so no chain is built at all
  assert.equal(graphAction({ wanted: 1, hasChain: false, stranded: false, canRoute: false }), "blocked");
});

test("chain: a closed context is detached first, and recovery is a separate step it cannot race", () => {
  // a deck was stranded in it and the person is listening: detach, then recover on fresh elements
  assert.equal(chainLostAction({ stranded: true, wanted: true }), "detach-and-recover");
  // nothing is stranded, or nobody is listening: just detach, the elements carry the sound
  assert.equal(chainLostAction({ stranded: false, wanted: true }), "detach");
  assert.equal(chainLostAction({ stranded: true, wanted: false }), "detach");
});

test("chain: cleanup closes its own context and never the replacement recovery just built", () => {
  const dead = {} as object;
  const fresh = {} as object;
  assert.equal(teardownIsCurrent(dead, dead), true);
  // the crux of the race: recovery replaced ctx synchronously, so the old teardown must not touch the new context
  assert.equal(teardownIsCurrent(dead, fresh), false);
  assert.equal(teardownIsCurrent(null, fresh), false);
  assert.equal(teardownIsCurrent(dead, null), false);
});

// ---- routing depends on the graphics stack, not only on a setting (the 13:51 log: software rendering, silent graph) --

test("routing: a working graphics stack allows the chain, whatever the memory saver says", () => {
  assert.equal(canRouteAudio({ memorySaver: false, graphics: { gpuCompositing: "enabled", webgl: "enabled" } }), true);
});

test("routing: software rendering is a no even with the memory saver off — the case the log showed", () => {
  // gpu_compositing disabled_software: createMediaElementSource empties the element without filling the chain
  assert.equal(canRouteAudio({ memorySaver: false, graphics: { gpuCompositing: "disabled_software", webgl: "disabled_off" } }), false);
  // a card whose WebGL is blocked is just as unable to route an element's media
  assert.equal(canRouteAudio({ memorySaver: false, graphics: { gpuCompositing: "disabled_software", webgl: "unavailable_software" } }), false);
});

test("routing: the memory saver still wins, and an unknown status is never a yes", () => {
  assert.equal(canRouteAudio({ memorySaver: true, graphics: { gpuCompositing: "enabled", webgl: "enabled" } }), false);
  // before main has answered there is nothing to build on; routing once too often costs the sound, never routing
  // costs only the decorative reaction
  assert.equal(canRouteAudio({ memorySaver: false, graphics: null }), false);
  assert.equal(canRouteAudio({ memorySaver: false }), false);
});

test("silence: a playing deck routed into a graph nobody can hear is told apart from a silent device", () => {
  const base = { element: "playing" as const, routed: true, level: 0 as number | null, context: "running" as const, sinkError: null };
  // nothing reached the graph: the routing did not work (the software-rendering silence)
  assert.equal(silenceVerdict(base), "silent-graph");
  // samples are in the graph, yet the speakers stay quiet and a device already failed: the output, not the engine
  assert.equal(silenceVerdict({ ...base, sinkError: "NotFoundError: gone" }), "silent-device");
  // a graph that is loud is simply working, whatever the device did earlier
  assert.equal(silenceVerdict({ ...base, level: 120 }), "playing-loud");
  // not routed, paused, or no analyser at all: nothing to conclude
  assert.equal(silenceVerdict({ ...base, routed: false }), "playing-loud");
  assert.equal(silenceVerdict({ ...base, element: "paused" }), "playing-loud");
  assert.equal(silenceVerdict({ ...base, level: null }), "playing-loud");
});

test("report: it says where the sound leaves the app, so a silent route is visible rather than implied", () => {
  const crashed = { audio: 0, capture: 0, lastExit: null, lastAt: null };
  const line = (routed: boolean) =>
    audioReportLines({
      health: { ...AUDIO_HEALTH_DEFAULTS, element: "playing", stream: "hls", context: "running", graph: "reactive", routed, level: routed ? 0 : null },
      crashes: crashed,
      runtime: { electron: "44.7.2", chrome: "140.0.0.0" },
      webAudioInUse: true,
    }).join("\n");
  assert.match(line(true), /sound through the graph/);
  assert.match(line(false), /sound straight from the deck/);
});

// ---- a route that carries nothing while it holds the sound (the 16:13 log: routed, muted element, peak 0 for minutes) --

test("route: a playing deck whose graph hears exact zero is a failed route, not a quiet passage", () => {
  // the log's shape: element handed over (so muted), context running, position advancing, analyser silent
  assert.equal(routeIsSilent({ running: true, level: 0, progressedSeconds: 5 }), true);
});

test("route: it needs a running graph and real progress before anything is concluded", () => {
  // a paused or suspended graph is expected to be silent — the elements carry the sound there
  assert.equal(routeIsSilent({ running: false, level: 0, progressedSeconds: 5 }), false);
  // no analyser measured, or sound in the graph: nothing to repair
  assert.equal(routeIsSilent({ running: true, level: null, progressedSeconds: 5 }), false);
  assert.equal(routeIsSilent({ running: true, level: 89, progressedSeconds: 5 }), false);
  // a deck that barely moved (a stall, a seek, a fade) is not evidence of anything yet
  assert.equal(routeIsSilent({ running: true, level: 0, progressedSeconds: 0.2 }), false);
  // and the window it is given is long enough not to fire between two tracks of a quiet passage
  assert.ok(ROUTE_SILENCE_MS >= 3_000);
});

test("route: a muted deck (or one at volume 0) is never judged silent — the person turned it down, not the graph", () => {
  assert.equal(routeIsSilent({ running: true, level: 0, progressedSeconds: 30, audible: false }), false);
  // audible and silent is still the fault it always was
  assert.equal(routeIsSilent({ running: true, level: 0, progressedSeconds: 30, audible: true }), true);
});

// ---- who asks for the chain (the equalizer without the sky is the case the silence hid in) -----------------------

test("wantedGraph: the equalizer alone asks for the chain — the sky is not required to carry the sound", () => {
  const only = wantedGraph(true, false);
  assert.deepEqual([...only], ["eq"]);
  // both, in whatever order the user switched them
  assert.deepEqual([...wantedGraph(true, true)].sort(), ["eq", "reactive"]);
  assert.deepEqual([...wantedGraph(false, true)], ["reactive"]);
  assert.deepEqual([...wantedGraph(false, false)], []);
});

// ---- a context's word about itself, and whether it is still the context we own ------------------------------------

test("context events: a late 'closed' from the old context is ignored — the replacement it tore down is not", () => {
  // recovery closed the old context after building the new one; its statechange still fires
  assert.equal(contextEventAction({ isCurrent: false, state: "closed" }), "ignore");
  assert.equal(contextEventAction({ isCurrent: false, state: "running" }), "ignore");
  assert.equal(contextEventAction({ isCurrent: false, state: "suspended" }), "ignore");
});

test("context events: the current context, suspended or interrupted — the elements carry the sound", () => {
  assert.equal(contextEventAction({ isCurrent: true, state: "suspended" }), "asleep");
  // Windows' "interrupted" (another app has the device) is asleep too, not a death
  assert.equal(contextEventAction({ isCurrent: true, state: "interrupted" }), "asleep");
  assert.equal(contextEventAction({ isCurrent: true, state: "running" }), "carry");
});

test("context events: the current context, closed — detach now, recovery is a separate step", () => {
  assert.equal(contextEventAction({ isCurrent: true, state: "closed" }), "closed");
  // and the engine maps that into: fresh elements for anything stranded in the graph, then rebuild if wanted
  assert.equal(chainLostAction({ stranded: true, wanted: true }), "detach-and-recover");
  assert.equal(chainLostAction({ stranded: true, wanted: false }), "detach");
});

// ---- the route-failure guard must work with the sky off (EQ-only runs were invisible to it before) -----------------

test("route: EQ on and the sky off still builds the chain, so the route check has something to measure", () => {
  // the chain is wanted by the equalizer alone; this is what makes the analyser — and therefore routeIsSilent's
  // input — available without any visualizer running
  assert.equal(graphAction({ wanted: wantedGraph(true, false).size, hasChain: false, stranded: false, canRoute: true }), "build");
  assert.equal(graphAction({ wanted: wantedGraph(true, false).size, hasChain: true, stranded: true, canRoute: true }), "keep");
  // and a route that stops carrying while the deck plays on is caught by the level, not by a missing analyser
  assert.equal(routeIsSilent({ running: true, level: 0, progressedSeconds: 5 }), true);
});

test("route: after fresh elements are made the graph may take them again — recovery is not one-way", () => {
  // elements were replaced (restartDecks): nothing is stranded, something still wants the chain → build, then keep
  assert.equal(graphAction({ wanted: wantedGraph(true, false).size, hasChain: false, stranded: false, canRoute: true }), "build");
  assert.equal(graphAction({ wanted: wantedGraph(true, false).size, hasChain: true, stranded: false, canRoute: true }), "keep");
  // a chain that carries is not flagged as silent even with the position advancing
  assert.equal(routeIsSilent({ running: true, level: 140, progressedSeconds: 9 }), false);
});
