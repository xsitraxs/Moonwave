import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { skipOnCopy } from "@shared/dataMove";

/**
 * The data folder from before the rename (Moonwave was published as "sc player" up to 2.4.1, in "%APPDATA%\sc player"
 * and its equivalents) is brought over once, when the new folder has no settings yet.
 *
 * It is **copied, never moved**: the same folder also belongs to the original sc player (waterlilo/sc-player), which
 * may be installed next to Moonwave, and taking its data away would break it. Chromium's caches are left behind (they
 * rebuild themselves), and so is anything that cannot be read right now (a file the other app holds open): a partial
 * copy only means that part starts fresh.
 *
 * On macOS and Linux the sign-in does not come along: safeStorage seals with a key named after the app ("… Safe
 * Storage" in the keychain), so the old secrets and cookies cannot be opened under the new name. Copying them would
 * only make the app restart once trying (restartForKey) — they stay behind and the person signs in again. On Windows
 * the key is the user's own (DPAPI), so everything opens and the sign-in survives.
 *
 * The even older "sky player" folder is still moved, as before, when there is nothing newer to take.
 */
export function bringOverOldData(appData: string, current: string, platform: NodeJS.Platform, log: (line: string) => void) {
  const has = (dir: string) => existsSync(join(dir, "settings.json"));
  if (has(current)) return;
  const scPlayer = join(appData, "sc player");
  if (scPlayer !== current && has(scPlayer)) {
    const skipped = copyTree(scPlayer, current, platform);
    log(`data: copied the settings and library from "${scPlayer}"${skipped ? ` (${skipped} item(s) left behind)` : ""}`);
    return;
  }
  const sky = join(appData, "sky player");
  if (sky !== current && has(sky)) {
    try {
      if (existsSync(current)) renameSync(current, `${current}.unused-${Date.now()}`);
      renameSync(sky, current);
    } catch {
      /* in use or not allowed: start fresh */
    }
  }
}

/** Copies `from` into `to` file by file; returns how many entries were skipped or failed. */
function copyTree(from: string, to: string, platform: NodeJS.Platform, rel = ""): number {
  let skipped = 0;
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(join(from, rel), { withFileTypes: true });
    mkdirSync(join(to, rel), { recursive: true });
  } catch {
    return 1;
  }
  for (const e of entries) {
    const path = rel ? `${rel}/${e.name}` : e.name;
    if (skipOnCopy(path, platform) || e.isSymbolicLink()) {
      skipped++;
      continue;
    }
    try {
      if (e.isDirectory()) skipped += copyTree(from, to, platform, path);
      else if (e.isFile()) copyFileSync(join(from, path), join(to, path));
    } catch {
      skipped++;
    }
  }
  return skipped;
}
