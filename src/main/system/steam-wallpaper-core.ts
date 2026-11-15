import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import type { SteamWallpaper } from "@shared/types";

/**
 * The Wallpaper Engine workshop lookup with everything that touches Steam or Electron injected, so the file-based
 * logic (what a folder holds, which preview a background may use) can be tested without either of them. Why it looks
 * like this (researched 2026-11; no Steam install exists on the build machine, so the layout rests on published and
 * documented evidence — community project.json files and Wallpaper Engine's own help pages — not on a live library):
 *
 * - a video wallpaper keeps the file project.json points at next to it (`"type": "video"`, `"file": "something.mp4"`);
 * - a scene keeps only metadata and a preview next to project.json (`"type": "scene"`, `"file": "scene.json"`): everything
 *   the scene needs to draw is packed into the closed `scene.pkg`, so there is nothing an app can render — the preview
 *   (a GIF or JPG saved by the author) is the only usable stand-in;
 * - a web wallpaper keeps `index.html` and its assets loose in the folder (`"type": "web"`) — rendering it means running
 *   someone's page with full network access, which this app doesn't do; the preview stands in here too;
 * - `project.json.preview` names the preview ("preview.gif", "preview.jpg", …); when it's absent the same names are
 *   the common fallback (preview.gif|jpg|jpeg|png|webp|bmp). Only gif/jpg/jpeg/png/webp can be a background here — the
 *   background pipeline can't read bmp — so a preview outside that set, or none, means "no image to offer".
 */
const WALLPAPER_ENGINE = "431960";
const PREVIEW_IMAGE = /\.(gif|jpe?g|png|webp)$/i;
const PREVIEW_FALLBACKS = ["preview.gif", "preview.jpg", "preview.jpeg", "preview.png", "preview.webp"];
const MB = 1048576;

/** What the lookup needs from the outside world — faked in tests. */
export interface SteamWallpaperDeps {
  /** every Steam library folder to look in */
  libraries(): Promise<string[]>;
  /** the URL to serve a file to the page as (scbg://import/…) */
  allowImport(path: string): string;
}

/** The project.json preview, when it names a file inside the folder; otherwise the preview.* the folder has. Null (not a thumbnail problem to guess at) when none fits what a background can be. */
export function previewOf(dir: string, preview: unknown): string | null {
  const candidates = typeof preview === "string" && preview.trim() ? [preview.trim(), ...PREVIEW_FALLBACKS] : PREVIEW_FALLBACKS;
  for (const name of new Set(candidates)) {
    const file = resolve(dir, name);
    // the same guard as the video: only inside the workshop folder, an extension a background understands, and a real file
    if (!file.startsWith(dir + sep) || !PREVIEW_IMAGE.test(file)) continue;
    try {
      if (statSync(file).isFile()) return file;
    } catch {
      /* not there */
    }
  }
  return null;
}

/** The wallpaper itself, when Steam has it here; the deps decide how the file is offered to the page. */
export async function findWallpaperIn(id: string, deps: SteamWallpaperDeps): Promise<SteamWallpaper> {
  for (const lib of await deps.libraries()) {
    const dir = join(lib, "steamapps", "workshop", "content", WALLPAPER_ENGINE, id);
    let project: { type?: unknown; file?: unknown; title?: unknown; preview?: unknown };
    try {
      project = JSON.parse(readFileSync(join(dir, "project.json"), "utf8")) as typeof project;
    } catch {
      continue;
    }
    const title = typeof project.title === "string" ? project.title.slice(0, 100) : id;
    const type = String(project.type).toLowerCase();
    // scenes and web wallpapers are drawn by Wallpaper Engine itself: the best this app can show is the preview
    if (type === "scene" || type === "web") {
      const preview = previewOf(dir, project.preview);
      if (!preview) return { found: false, id, reason: "no-preview" };
      const bytes = statSync(preview).size;
      // a preview is often under a megabyte: one decimal, so a small GIF doesn't come out as "0 MB"
      return { found: true, id, title, sizeMb: Math.round(bytes / (MB / 10)) / 10, url: deps.allowImport(preview), kind: "image" };
    }
    if (type !== "video" || typeof project.file !== "string") return { found: false, id, reason: "not-video" };
    const file = resolve(dir, project.file);
    if (!file.startsWith(dir + sep) || !/\.(mp4|webm)$/i.test(file) || !existsSync(file)) return { found: false, id, reason: "not-video" };
    return { found: true, id, title, sizeMb: Math.round(statSync(file).size / MB), url: deps.allowImport(file), kind: "video" };
  }
  return { found: false, id, reason: "missing" };
}
