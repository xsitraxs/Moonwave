// Lets the DJ controller run under Node for dj.test.mjs: the Vite aliases, the app's own stores, and small stubs for
// what needs Electron or a page (main's bridge, the audio engine, the UI/toast store, i18n, social sharing).
//
// The player-sim next door does the same for the player and the real audio engine with a fake <audio>; here the engine
// is silent, because these tests are about where a suggestion lands in the queue, not about how it sounds.
// `@/lib/hidden` and `./settings` deliberately stay real: the blocklist must hold for suggestions through the same gate
// the autopilot goes through, so the real one has to run.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
const STUBS = fileURLToPath(new URL("./stubs/", import.meta.url));
const PLAYER_SIM_STUBS = fileURLToPath(new URL("../player-sim/stubs/", import.meta.url));

const stubs = {
  "@/lib/sky": `${STUBS}sky.mjs`,
  "@/audio/engine": `${STUBS}engine.mjs`,
  "@/i18n": `${STUBS}i18n.mjs`,
  "./ui": `${STUBS}ui.mjs`,
  "./social": `${STUBS}social.mjs`,
  // generic ones, shared with the player-sim
  "@/lib/activity": `${PLAYER_SIM_STUBS}activity.mjs`,
  "@/api/queries": `${PLAYER_SIM_STUBS}queries.mjs`,
};

const local = (path) => [path, `${path}.ts`, `${path}/index.ts`].find((candidate) => existsSync(candidate) && !candidate.endsWith("/")) ?? null;

export async function resolve(spec, ctx, next) {
  const stub = stubs[spec];
  if (stub) return { url: pathToFileURL(stub).href, shortCircuit: true };
  let file = null;
  if (spec.startsWith("@/")) file = local(`${SRC}renderer/src/${spec.slice(2)}`);
  else if (spec.startsWith("@shared/")) file = local(`${SRC}shared/${spec.slice(8)}`);
  else if (spec.startsWith(".") && ctx.parentURL?.startsWith("file:") && ctx.parentURL.endsWith(".ts")) file = local(fileURLToPath(new URL(spec, ctx.parentURL)));
  if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
  // packages (zustand) come from the app's own node_modules, whoever imports them
  if (!/^(\.|\/|node:|file:)/.test(spec)) return next(spec, { ...ctx, parentURL: pathToFileURL(SRC).href });
  return next(spec, ctx);
}

export async function load(url, ctx, next) {
  if (!url.endsWith(".ts")) return next(url, ctx);
  // Vite's build-time flag has no meaning here (the DevTools hooks in player.ts read it at module scope)
  const source = (await readFile(fileURLToPath(url), "utf8")).replaceAll("import.meta.env.DEV", "false");
  return { format: "module-typescript", source, shortCircuit: true };
}
