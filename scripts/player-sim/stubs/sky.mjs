// main's side of the bridge: each test sets the answers it needs; every call is recorded
export const calls = [];
export const handlers = {};
export async function call(channel, ...args) {
  calls.push([channel, ...args]);
  const h = handlers[channel];
  return h ? h(...args) : undefined;
}
export const errorCode = (e) => e?.code ?? "unknown";
export class SkyError extends Error {}
