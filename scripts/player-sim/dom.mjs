// Just enough of a page for audio/engine.ts: a fake <audio> the tests drive by hand (metadata, time, end, failure).
globalThis.window = globalThis;
globalThis.addEventListener ??= () => {};
// the engine's watchdogs run forever; they must not keep the test process alive
const setIntervalReal = globalThis.setInterval;
globalThis.setInterval = (fn, ms, ...args) => setIntervalReal(fn, ms, ...args).unref();

export const elements = [];

class FakeAudio extends EventTarget {
  constructor() {
    super();
    this._src = "";
    this.paused = true;
    this.ended = false;
    this.currentTime = 0;
    this.duration = NaN;
    this.readyState = 0;
    this.volume = 1;
    this.playbackRate = 1;
    elements.push(this);
  }
  get src() {
    return this._src;
  }
  // a new source starts at 0, as in a browser
  set src(v) {
    this._src = v;
    this.currentTime = 0;
    this.readyState = 0;
  }
  removeAttribute(name) {
    if (name === "src") this._src = "";
  }
  load() {}
  async play() {
    this.paused = false;
    this.dispatchEvent(new Event("playing"));
  }
  pause() {
    if (this.paused) return;
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
  }
  async setSinkId() {}

  /** the stream's length became known */
  meta(duration) {
    this.duration = duration;
    this.readyState = 1;
    this.dispatchEvent(new Event("loadedmetadata"));
    this.dispatchEvent(new Event("durationchange"));
  }
  tick(seconds) {
    this.currentTime = seconds;
    this.dispatchEvent(new Event("timeupdate"));
  }
  end() {
    this.paused = true;
    this.ended = true;
    this.dispatchEvent(new Event("ended"));
  }
  fail() {
    this.dispatchEvent(new Event("error"));
  }
}
globalThis.Audio = FakeAudio;
