/**
 * What stays behind when the old "sc player" data folder is copied into Moonwave's (src/main/system/data-move.ts).
 * Free of imports so it can be unit-tested.
 */

/** Chromium's caches and lock files: rebuilt on their own, and a lock copied over would only confuse the new app. */
const CACHES = new Set(["Cache", "Code Cache", "GPUCache", "DawnCache", "DawnGraphiteCache", "DawnWebGPUCache", "GrShaderCache", "ShaderCache", "Crashpad", "blob_storage", "lockfile"]);

/**
 * True for a path (relative to the data folder, "/"-separated) that is not copied: caches anywhere, Chromium's
 * Singleton* locks, and — outside Windows — the sealed secrets and the browser sessions, whose key is named after the
 * app and so cannot be opened under the new name.
 */
export function skipOnCopy(relPath: string, platform: string): boolean {
  const parts = relPath.split("/");
  const name = parts[parts.length - 1] ?? "";
  if (parts.some((p) => CACHES.has(p))) return true;
  if (name.startsWith("Singleton")) return true;
  if (platform !== "win32" && (relPath === "secrets.bin" || relPath === "secrets.bin.disabled" || parts[0] === "Partitions" || relPath === "Cookies" || relPath === "Local State")) return true;
  return false;
}
