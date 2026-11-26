// main's side of the bridge, scripted by each test: `handlers[channel]` answers (or throws, which the DJ reads as a
// failed seed); every call is recorded, so a test can ask "did the controller go to the network again?".
export const calls = [];
export const handlers = {};

export async function call(channel, ...args) {
  calls.push([channel, ...args]);
  const handler = handlers[channel];
  if (!handler) return undefined;
  return handler(...args);
}

export const on = () => () => {};
export const errorCode = (error) => error?.code ?? "unknown";

export class SkyError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
