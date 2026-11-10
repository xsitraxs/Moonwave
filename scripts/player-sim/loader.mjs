// Lets the real renderer modules (audio/engine.ts, state/player.ts) run under Node for player.test.mjs: resolves the
// Vite aliases, swaps the modules that need Electron or a real page for small stubs, and strips the types.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
const STUBS = fileURLToPath(new URL("./stubs/", import.meta.url));
const stubs = { "@/lib/sky": "sky.mjs", "@/lib/activity": "activity.mjs", "@/lib/hidden": "hidden.mjs", "@/api/queries": "queries.mjs", "hls.js/light": "hls.mjs" };
const local = (p) => [p, `${p}.ts`, `${p}/index.ts`].find((c) => existsSync(c) && !c.endsWith("/")) ?? null;

export async function resolve(spec, ctx, next) {
  if (stubs[spec]) return { url: pathToFileURL(STUBS + stubs[spec]).href, shortCircuit: true };
  // the player's settings and UI stores pull in the whole app; the player only reads a few fields of them
  if (ctx.parentURL?.includes("/state/") && (spec === "./settings" || spec === "./ui")) return { url: pathToFileURL(`${STUBS}${spec.slice(2)}.mjs`).href, shortCircuit: true };
  let p = null;
  if (spec.startsWith("@/")) p = local(`${SRC}renderer/src/${spec.slice(2)}`);
  else if (spec.startsWith("@shared/")) p = local(`${SRC}shared/${spec.slice(8)}`);
  else if (spec.startsWith(".") && ctx.parentURL?.startsWith("file:") && ctx.parentURL.endsWith(".ts")) p = local(fileURLToPath(new URL(spec, ctx.parentURL)));
  if (p) return { url: pathToFileURL(p).href, shortCircuit: true };
  // packages (zustand) from the app's own node_modules, whoever imports them
  if (!/^(\.|\/|node:|file:)/.test(spec)) return next(spec, { ...ctx, parentURL: pathToFileURL(SRC).href });
  return next(spec, ctx);
}

export async function load(url, ctx, next) {
  if (!url.endsWith(".ts")) return next(url, ctx);
  // Vite's build-time flags have no meaning here
  const source = (await readFile(fileURLToPath(url), "utf8")).replaceAll("import.meta.env.DEV", "false");
  return { format: "module-typescript", source, shortCircuit: true };
}
