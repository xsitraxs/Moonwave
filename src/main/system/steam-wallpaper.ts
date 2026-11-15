import type { SteamWallpaper } from "@shared/types";
import { allowImport } from "./background";
import { findWallpaperIn } from "./steam-wallpaper-core";
import { steamLibraries, workshopId } from "./steam-path";

export { workshopId };

/**
 * Wallpapers from Wallpaper Engine's Steam Workshop, as a background: a workshop link names the item, and Steam itself
 * keeps the files of the items one subscribes to in <library>/steamapps/workshop/content/431960/<id>. Nothing is
 * downloaded here — an item that isn't on this computer is subscribed to in Steam first.
 *
 * The folder format (the scenes' closed scene.pkg, the preview rules this relies on) is documented in
 * steam-wallpaper-core.ts — researched 2026-11, there is no Steam install on the build machine.
 */

/** The wallpaper itself, when Steam has it here; served to the page as scbg://import/<token> (that file only). */
export async function findWallpaper(id: string): Promise<SteamWallpaper> {
  return findWallpaperIn(id, { libraries: steamLibraries, allowImport });
}
