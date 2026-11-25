// A silent stand-in for audio/engine.ts: the DJ tests never play sound, they only need the calls the player makes to
// exist and to answer sanely. The two decks, HLS and the Web Audio graph are not here — player-sim/next door runs the
// real engine against a fake <audio>, for the tests that are about playback.
export const bindEngine = () => {};
export const load = async () => {};
export const play = () => {};
export const pause = () => {};
export const seek = () => {};
export const stop = () => {};
export const currentTime = () => 0;
export const activeStreamId = () => -1;
export const setVolume = () => {};
export const setRate = () => {};
export const retrySound = async () => {};
