// The player and its audio engine, run for real against a fake <audio> (dom.mjs) and a stubbed bridge to main
// (stubs/sky.mjs). Each test is a bug that once reached people; the comments say what they heard.
import assert from "node:assert/strict";
import { register } from "node:module";
import { beforeEach, test } from "node:test";
import "./dom.mjs";
import { elements } from "./dom.mjs";
import { calls, handlers } from "./stubs/sky.mjs";

register("./loader.mjs", import.meta.url);
const { usePlayer, player } = await import("../../src/renderer/src/state/player.ts");
const engine = await import("../../src/renderer/src/audio/engine.ts");

const flush = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const T = (id, extra = {}) => ({ id, title: `t${id}`, artist: "a", durationMs: 200_000, playability: "ok", waveformUrl: null, ...extra });
/** the element that has a source: the deck playing */
const playing = () => elements.find((e) => e.src);
let urlN = 0;
const stream = async (id) => ({ url: `https://cf.example/${id}/${++urlN}.mp3`, protocol: "progressive", mime: "audio/mpeg", snipped: false });
/** a request that hangs (a slow network) until the next test begins, so no test inherits another's fill in flight */
const hanging = [];
const hang = () => new Promise((r) => hanging.push(() => r([])));
const streamsOf = (id) => calls.filter((c) => c[0] === "data:stream" && (id === undefined || c[1] === id)).length;

beforeEach(async () => {
  for (const release of hanging.splice(0)) release();
  await flush(5);
  engine.stop();
  engine.setCrossfade(0);
  usePlayer.setState({ repeat: "off", shuffle: false, status: "idle", error: null });
  handlers["data:stream"] = stream;
  handlers["data:related"] = async () => [];
  handlers["data:tracks"] = async (ids) => ids.map((id) => T(id));
});

test("a start position left over from a dropped load does not move the next track", async () => {
  // restored at 120 s; the person picks another track before the first one's length is known
  await engine.load(T(1), { autoplay: false, startAt: 120 });
  player.playFrom([T(2)], 0, { kind: "static" });
  await flush();
  const el = playing();
  assert.match(el.src, /\/2\//);
  el.meta(200);
  assert.equal(el.currentTime, 0, "the new track jumped to 2:00");
});

test("a seek made while the stream URL is on its way is where playback starts", async () => {
  let release;
  handlers["data:stream"] = (id) => new Promise((r) => (release = () => r(stream(id))));
  player.playFrom([T(3)], 0, { kind: "static" });
  await flush();
  player.seek(75);
  release();
  await flush();
  const el = playing();
  el.meta(200);
  assert.equal(el.currentTime, 75, "the seek was lost and the track started from 0:00");
});

test("a long mix refreshes its URL more than once, 30 s apart; one failing again at once is an error", async () => {
  const realNow = performance.now.bind(performance);
  let shift = 0;
  performance.now = () => realNow() + shift;
  try {
    player.playFrom([T(4, { durationMs: 3_600_000 })], 0, { kind: "static" });
    await flush();
    playing().meta(3600);
    const before = streamsOf(4);
    playing().fail(); // the first URL expires
    await flush();
    assert.equal(streamsOf(4), before + 1);
    shift += 40_000; // and the second one, later in the set
    playing().fail();
    await flush();
    assert.equal(streamsOf(4), before + 2, "the second expiry ended the mix with \"offline\"");
    assert.notEqual(usePlayer.getState().status, "error");
    playing().fail(); // right away again: that is not an expiry
    await flush();
    assert.equal(streamsOf(4), before + 2);
    assert.equal(usePlayer.getState().status, "error");
  } finally {
    performance.now = realNow;
  }
});

test("the next stream is asked for before the end and used at the change", async () => {
  player.playFrom([T(5), T(6)], 0, { kind: "static" });
  await flush();
  const el = playing();
  el.meta(200);
  el.tick(100);
  await flush();
  assert.equal(streamsOf(6), 0, "too early, 100 s left");
  el.tick(185);
  el.tick(186);
  await flush();
  assert.equal(streamsOf(6), 1, "asked once, 15 s before the end");
  el.end();
  await flush(5);
  const s = usePlayer.getState();
  assert.equal(s.queue[s.index].id, 6);
  assert.equal(streamsOf(6), 1, "the change asked again instead of using it");
  assert.match(playing().src, /\/6\//);
});

test("a crossfade lasts as long as the outgoing track has left once the next stream is there", async () => {
  engine.setCrossfade(6);
  let release;
  handlers["data:stream"] = (id) => (id === 8 ? new Promise((r) => (release = () => r(stream(id)))) : stream(id));
  player.playFrom([T(7), T(8)], 0, { kind: "static" });
  await flush();
  const from = playing();
  from.meta(200);
  from.tick(195); // 5 s left: the next stream is asked for
  await flush();
  from.tick(198.5); // it took a while to come: 1.5 s left now
  release();
  await flush(5);
  assert.equal(usePlayer.getState().queue[usePlayer.getState().index].id, 8);
  await flush(1700);
  assert.equal(from.src, "", "planned on the old 5 s, the fade outlasted the track that was fading out");
  assert.equal(streamsOf(8), 1, "the next stream was fetched twice");
});

test("a list where nothing plays is not walked forever with repeat on", async () => {
  handlers["data:stream"] = async () => {
    throw Object.assign(new Error("drm"), { code: "unavailable" });
  };
  usePlayer.setState({ repeat: "all" });
  // the skips wait 1.2 s each; time runs fast for this test
  const realTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...args) => realTimeout(fn, ms >= 600 ? 1 : ms, ...args);
  const before = streamsOf();
  try {
    player.playFrom([T(9), T(10), T(11)], 0, { kind: "static" });
    await flush(300);
  } finally {
    globalThis.setTimeout = realTimeout;
  }
  const tried = streamsOf() - before;
  assert.ok(tried <= 16, `asked for ${tried} streams and counting`);
  assert.equal(usePlayer.getState().status, "error");
});

test("a queued next track starts without waiting for the queue to be topped up", async () => {
  // the fill at the start finds nothing; the one at the track's end would hang (a slow network)
  let asked = 0;
  handlers["data:related"] = () => (++asked === 1 ? Promise.resolve([]) : hang());
  player.playFrom([T(40), T(41)], 0, { kind: "static" });
  await flush(5);
  playing().meta(200);
  playing().end();
  await flush(5);
  const s = usePlayer.getState();
  assert.equal(s.queue[s.index]?.id, 41, "waited for the autopilot before the track that was already there");
});

test("at a list's end the next track waits for the autopilot's tracks on their way, not for the whole fill", async () => {
  let give;
  let asked = 0;
  // the first answer comes when the test says; any later one never does (the fill goes on asking)
  handlers["data:related"] = () => (++asked === 1 ? new Promise((r) => (give = () => r([T(21), T(22)]))) : hang());
  player.playFrom([T(20)], 0, { kind: "static" });
  await flush();
  playing().meta(200);
  playing().end();
  await flush();
  give();
  await flush(5);
  const s = usePlayer.getState();
  assert.equal(s.queue[s.index]?.id, 21, `the queue ended on ${s.queue[s.index]?.id} (${s.status})`);
});
