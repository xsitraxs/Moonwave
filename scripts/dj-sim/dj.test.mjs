// The DJ controller against the real player store: what a session does on start, on a short round, when the queue turns
// over mid-flight, and what it refuses to touch. main's bridge is scripted per test (stubs/sky.mjs), the audio engine is
// silent (stubs/engine.mjs) — the player, the ranker, the collector and the session are the app's own code.
//
// Each test is a bug that once shipped: the short start that stranded the session, the stale answer that landed in the
// next list, the status with no way out. Run it with the rest: `npm test` (or `node --test scripts/dj-sim/dj.test.mjs`).
import assert from "node:assert/strict";
import { register } from "node:module";
import { beforeEach, test } from "node:test";

register("./loader.mjs", import.meta.url);

globalThis.window ??= globalThis;
const { RENDERER_DEFAULTS } = await import("../../src/shared/ipc.ts");
const { dj, initDj, useDj } = await import("../../src/renderer/src/state/dj.ts");
const { player, usePlayer } = await import("../../src/renderer/src/state/player.ts");
const { useSettings } = await import("../../src/renderer/src/state/settings.ts");
const { calls, handlers } = await import("./stubs/sky.mjs");

initDj();

function track(id, overrides = {}) {
  return {
    id,
    title: `Track ${id}`,
    artist: `Artist ${id}`,
    user: { id: 1000 + id, username: `Artist ${id}`, permalinkUrl: "" },
    durationMs: 180_000,
    artworkUrl: null,
    waveformUrl: null,
    permalinkUrl: "",
    playability: "ok",
    ...overrides,
  };
}

/** `data:related` answers one round at a time; the last answer serves every later round. Returns the round counter. */
function rounds(...answers) {
  let asked = 0;
  handlers["data:related"] = () => answers[Math.min(asked++, answers.length - 1)] ?? [];
  return () => asked;
}

const queueIds = () => usePlayer.getState().queue.map((t) => t.id);

async function until(what, ms = 3_000) {
  const deadline = Date.now() + ms;
  while (!what()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what.toString()}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const settle = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));

// a clean slate before every test: no session, no queue, no history, a quiet autopilot, no scripted answers
beforeEach(() => {
  dj.stop();
  for (const channel of Object.keys(handlers)) delete handlers[channel];
  calls.length = 0;
  useDj.setState({ active: false, status: "idle", seeds: [], origin: null, refilling: false, reasons: {}, votes: {}, feedbackOn: true });
  usePlayer.setState({
    queue: [],
    index: -1,
    source: { kind: "static" },
    original: null,
    pending: [],
    autoFrom: -1,
    status: "idle",
    error: null,
    duration: 0,
    volume: 1,
    muted: false,
    repeat: "off",
    shuffle: false,
  });
  useSettings.setState({ history: [], prefs: { ...structuredClone(RENDERER_DEFAULTS.prefs), autopilot: false } });
});

test("a short start round refills on its own instead of stranding the session", async () => {
  usePlayer.setState({ queue: [track(1)], index: 0 });
  const asked = rounds([track(101)], [track(201), track(202), track(203), track(204)]);

  dj.start();
  await until(() => useDj.getState().status === "ready" && !useDj.getState().refilling && queueIds().length >= 6);

  // one pick is a zero tail once it plays: without the second round the next player event read the empty tail as the
  // person clearing the queue and stopped the session
  assert.ok(asked() >= 2, "the short start asked for a second round right away");
  assert.equal(useDj.getState().active, true);
  assert.equal(useDj.getState().status, "ready");
  assert.deepEqual(queueIds(), [1, 101, 201, 202, 203, 204]);
});

test("a start that turns the queue over keeps its session", async () => {
  rounds([track(101)], [track(201), track(202), track(203), track(204), track(205)]);

  // nothing playing: the picks become the queue themselves — a new queue generation, this session's own
  dj.startFromTrack(track(1));
  await until(() => useDj.getState().status === "ready" && !useDj.getState().refilling && queueIds().length >= 6);

  assert.equal(useDj.getState().active, true, "the session's own turn-over is not another list taking the player");
  assert.equal(queueIds()[0], 101);
  assert.equal(Object.keys(useDj.getState().reasons).length, 6);
});

test("a new list during a flight ends the session at once, and the late answer is dropped", async () => {
  usePlayer.setState({ queue: [track(1)], index: 0 });
  let release = () => {};
  let asked = 0;
  handlers["data:related"] = () => {
    asked++;
    return new Promise((resolve) => {
      release = () => resolve([track(201), track(202)]);
    });
  };

  dj.start();
  await until(() => asked === 1);
  assert.equal(useDj.getState().status, "loading");

  // a new list takes the player while the answer is still in the air
  player.playFrom([11, 12, 13, 14, 15, 16].map((id) => track(id)), 0, { kind: "static" });
  assert.equal(useDj.getState().active, false, "the session steps aside at once — the busy hold doesn't outlive its context");
  assert.equal(useDj.getState().status, "stopped");

  release();
  await settle();
  assert.deepEqual(queueIds(), [11, 12, 13, 14, 15, 16], "the stale round never touched the new queue");
  assert.deepEqual(useDj.getState().reasons, {}, "and left no phantom labels behind");
});

test("dismissing a suggestion takes it out of the queue and its reason with it", () => {
  usePlayer.setState({ queue: [track(1), track(101), track(102)], index: 0 });
  useDj.setState({ reasons: { 101: { kind: "generic" }, 102: { kind: "generic" } } });

  // what the × button and the Delete key both call
  dj.dismiss(101);

  assert.deepEqual(queueIds(), [1, 102]);
  assert.deepEqual(Object.keys(useDj.getState().reasons), ["102"]);
});

test("dismissing the suggestion that is playing moves on", () => {
  usePlayer.setState({ queue: [track(101), track(102), track(103)], index: 0 });
  useDj.setState({ reasons: { 101: { kind: "generic" }, 102: { kind: "generic" }, 103: { kind: "generic" } } });

  dj.dismiss(101);

  assert.equal(usePlayer.getState().queue[usePlayer.getState().index]?.id, 102);
});

test("a finished status (error, empty) can be closed", async () => {
  usePlayer.setState({ queue: [track(1)], index: 0 });
  handlers["data:related"] = () => {
    throw new Error("no network");
  };

  dj.start();
  await until(() => useDj.getState().status === "error");
  assert.equal(useDj.getState().active, false);
  dj.clear();
  assert.equal(useDj.getState().status, "idle");

  // nothing to suggest: an honest empty, closed the same way (the strip and the page go quiet)
  handlers["data:related"] = () => [];
  dj.start();
  await until(() => useDj.getState().status === "empty");
  assert.notEqual(useDj.getState().origin, null, "the empty status still knows where it came from");
  dj.clear();
  assert.equal(useDj.getState().status, "idle");
  assert.equal(useDj.getState().origin, null);
});

test("volume and mute never change a decision, a queue change does", async () => {
  usePlayer.setState({ queue: [track(1)], index: 0 });
  let asked = 0;
  const answers = [[track(101), track(102), track(103), track(104), track(105)], [track(201), track(202), track(203)]];
  handlers["data:related"] = () => answers[Math.min(asked++, answers.length - 1)];

  dj.start();
  await until(() => useDj.getState().status === "ready" && queueIds().length === 6);
  const before = asked;

  // the player moves in ways a session can't care about
  usePlayer.setState({ volume: 0.2, muted: true, duration: 123 });
  await settle();
  assert.equal(asked, before, "only the queue and the current track move a session");

  // ...and in one it does: the tail drops below the refill line, so the next round goes out
  player.removeAt(3);
  await until(() => asked > before);
});

test("blocked artists and hidden keywords stay out of the DJ queue", async () => {
  usePlayer.setState({ queue: [track(1)], index: 0 });
  useSettings.setState({ prefs: { ...useSettings.getState().prefs, blockedArtists: [{ id: 42, username: "Blocked" }], hiddenKeywords: ["spam"] } });
  rounds([
    track(101, { user: { id: 42, username: "Blocked", permalinkUrl: "" }, artist: "Blocked" }),
    track(102, { title: "Free spam" }),
    track(103),
    track(104),
    track(105),
    track(106),
    track(107),
    track(108),
  ]);

  dj.start();
  await until(() => useDj.getState().status === "ready" && queueIds().length >= 7);
  await settle();

  // the player's own gate (canPlay) runs before anything is appended: a hidden track is never queued, labelled, or
  // counted in the tail — the settings' blocklist holds for suggestions exactly as it does for the autopilot
  assert.deepEqual(queueIds(), [1, 103, 104, 105, 106, 107, 108]);
  assert.deepEqual(
    Object.keys(useDj.getState().reasons)
      .map(Number)
      .sort((a, b) => a - b),
    [103, 104, 105, 106, 107, 108],
  );
});
