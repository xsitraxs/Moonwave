/**
 * Whether this run can keep secrets at rest, decided from what Electron's safeStorage reports about the desktop.
 * Pure and shared so the decision is unit-tested and so main, the SoundCloud session and the app-info report can
 * never disagree about it.
 *
 * "basic_text" is what Chromium selects on a Linux desktop with no keyring (or no desktop it recognizes). sealing
 * values with its built-in key is obfuscation, not encryption — file permissions are the only barrier, and anyone who
 * can read the profile can read them. Writing them anyway (the old behaviour: an invisible regular file whose contents
 * looked protected) breaks the promise the sign-in screen implies. So in that case nothing is written at all: secrets
 * live in memory for the run, the SoundCloud session is an in-memory partition, and the user is told.
 */

export type StoragePlan = "system" | "ephemeral";

/** The plan for this run, from safeStorage's backend name and whether it reports encryption as available. */
export function planForBackend(backend: string, encryptionAvailable: boolean): StoragePlan {
  if (!encryptionAvailable) return "ephemeral";
  // unknown/empty answers are treated as "not sealed", never as safe: an unfamiliar desktop is more likely to be a
  // missing keyring than a sealed one
  if (!backend || backend === "basic_text") return "ephemeral";
  // keychain (macOS), dpapi (Windows), gnome_libsecret / kwallet (Linux) — anything else that claims availability
  // is trusted (it is Chromium's own answer), and stays system-sealed
  return "system";
}

/**
 * The partition the SoundCloud web session uses. Persistent only when secrets may persist: a token held in memory must
 * not be brought back by a cookie jar on disk (and a cookie written to disk must not outlive a keyring that is gone).
 * Without "persist:" the session is in-memory and dies with the app — no file is written, and the next run signs in.
 */
export function scPartitionFor(plan: StoragePlan): string {
  return plan === "ephemeral" ? "soundcloud-ephemeral" : "persist:soundcloud";
}

/** The name of the quarantine an old secrets.bin is moved to (next to it, never deleted). */
export const SECRETS_DISABLED_SUFFIX = ".disabled";

/** The names setSecret may write (with the "~old" rotation suffix). Mirrors the Key union in src/main/store/secrets.ts — change both together. */
const KNOWN_SECRET_KEYS = new Set(["sessionToken", "officialClientSecret", "officialRefreshToken", "proxyPassword", "socialSecret", "moderatorToken", "backupKey"]);

/**
 * Whether a parsed secrets.bin is one this app could have written: a flat object whose keys are the app's own secret
 * names (optionally with the "~old" suffix for the rotation backups) and whose values are base64 strings or arrays of
 * them. Used only to decide whether a stale, never-to-be-read file may be moved aside — not to trust its contents.
 * Anything unexpected (unknown keys, odd shapes, non-base64 values) is left untouched.
 */
export function looksLikeSecretsFile(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  if (entries.length > 64) return false;
  for (const [k, v] of entries) {
    const m = /^([A-Za-z][A-Za-z0-9]*)(~old)?$/.exec(k);
    if (!m || !KNOWN_SECRET_KEYS.has(m[1]!)) return false;
    if (typeof v === "string") {
      if (v.length > 16_384 || !/^[A-Za-z0-9+/]*={0,2}$/.test(v)) return false;
      continue;
    }
    if (Array.isArray(v)) {
      if (v.length > 8) return false;
      if (!v.every((x) => typeof x === "string" && x.length <= 16_384 && /^[A-Za-z0-9+/]*={0,2}$/.test(x))) return false;
      continue;
    }
    return false;
  }
  return true;
}
