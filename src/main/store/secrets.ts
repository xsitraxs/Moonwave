import { chmodSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app, safeStorage } from "electron";
import { log } from "../system/log";
import { SECRETS_DISABLED_SUFFIX, looksLikeSecretsFile, planForBackend, type StoragePlan } from "@shared/secureStorage";

/**
 * Tokens and secrets, encrypted with the OS (DPAPI on Windows, Keychain on macOS, libsecret/kwallet on Linux) through
 * safeStorage.
 *
 * On a desktop with no secure storage (a Linux window manager Chromium doesn't know, so safeStorage picks "basic_text")
 * nothing is written at rest at all: secrets stay in memory for this run, the SoundCloud session is an in-memory
 * partition (see soundcloud/session.ts), and the user is told the sign-in won't survive a restart (app:info →
 * secretsPersist, shown on the sign-in screen). Sealing with basic_text's built-in key would only be obfuscation, and
 * a silent one — the sign-in screen must not imply a password was saved when it only lived in memory.
 *
 * A secret that can't be opened is not the same as no secret: a run whose encryption key never reached the disk (seen
 * after installing over a running app) writes values the next run can't open, and the older value it overwrote was
 * the user's account. So every account value replaced or removed is kept sealed under "<key>~old" (the last few), and when
 * the current one can't be opened the newest old one that can is put back.
 */
type Key = "sessionToken" | "officialClientSecret" | "officialRefreshToken" | "proxyPassword" | "socialSecret" | "moderatorToken" | "backupKey";

const KEEP_OLD = 4;
/** the ones that are an account: kept when replaced (a removed moderator key or proxy password is simply gone) */
const GUARDED = new Set<Key>(["sessionToken", "officialRefreshToken", "socialSecret", "backupKey"]);
const memory = new Map<Key, string>();
const path = () => join(app.getPath("userData"), "secrets.bin");
const quarantine = () => `${path()}${SECRETS_DISABLED_SUFFIX}`;

/**
 * Decided once per run, after the app is ready. "basic_text" can never be trusted, and neither can a file a previous
 * version sealed with it: that file is moved aside (never read, never overwritten in place, never deleted) so a later
 * run on a desktop that does get a keyring starts clean instead of "restoring" an unsealed session token from disk.
 */
let plan: StoragePlan | null = null;
function prepare() {
  if (plan || !app.isReady()) return;
  const backend = safeStorage.getSelectedStorageBackend();
  plan = planForBackend(backend, safeStorage.isEncryptionAvailable());
  if (plan === "ephemeral") {
    log("main", `secrets: no secure storage on this desktop (${backend || "unavailable"}) — secrets are kept for this run only`);
    quarantineStaleSecrets();
    quarantineStaleSession();
  } else {
    log("main", `secrets: ${backend}`);
  }
}

/**
 * A secrets.bin a previous, less careful version may have left: it is only ever moved aside (next to itself), and only
 * after it is recognized as ours by shape — unrecognized files are left completely alone and noted in the log.
 */
function quarantineStaleSecrets() {
  let raw: string;
  try {
    raw = readFileSync(path(), "utf8");
  } catch {
    return; // nothing stored — nothing to quarantine
  }
  let ours: boolean;
  try {
    ours = looksLikeSecretsFile(JSON.parse(raw));
  } catch {
    ours = false;
  }
  if (!ours) {
    log("main", "secrets.bin exists but is not in this app's format — left untouched");
    return;
  }
  try {
    renameSync(path(), quarantine());
    log("main", "secrets.bin was sealed without secure storage — moved aside, never read (your sign-in will be asked for again)");
  } catch (err) {
    // keep the file but never read it this run; a later run tries again
    log("main", `secrets.bin could not be moved aside (${(err as Error).message}) — it will be ignored anyway`);
  }
}

/**
 * The cookie jar the SoundCloud session always used (persist:soundcloud, created before storage was conditional). In
 * an ephemeral run it is never read again — but if it is simply left there, a later run on a sealed desktop would
 * resurrect the old token without the person doing anything. Moved aside next to where Electron would keep it.
 */
function quarantineStaleSession() {
  const dir = join(app.getPath("userData"), "Partitions", "soundcloud");
  try {
    renameSync(dir, `${dir}.disabled`);
    log("main", "the stored SoundCloud web session was moved aside (no secure storage on this desktop)");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") log("main", `the stored SoundCloud web session could not be moved aside (${(err as Error).message}) — it will not be used this run`);
  }
}

/** True while this run is on a desktop with no secure storage: nothing is persisted, the sign-in lasts one run. */
export function secretsEphemeral(): boolean {
  prepare();
  return plan === "ephemeral";
}

const save = (all: Sealed) => {
  writeFileSync(path(), JSON.stringify(all), { mode: 0o600 });
  // a file written before keeps its mode: this user only (no-op on Windows)
  if (process.platform !== "win32") chmodSync(path(), 0o600);
};

type Sealed = Record<string, string | string[]>;

function load(): Sealed {
  try {
    return JSON.parse(readFileSync(path(), "utf8")) as Sealed;
  } catch {
    return {};
  }
}

function open(sealed: string): string | null {
  try {
    return safeStorage.decryptString(Buffer.from(sealed, "base64"));
  } catch {
    return null;
  }
}

const olds = (all: Sealed, key: Key) => {
  const v = all[`${key}~old`];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x) : [];
};
const keepOld = (all: Sealed, key: Key, sealed: string, drop?: string) => {
  all[`${key}~old`] = [sealed, ...olds(all, key).filter((s) => s !== sealed && s !== drop)].slice(0, KEEP_OLD);
};

const sealing = () => {
  prepare();
  return plan === "system" && safeStorage.isEncryptionAvailable();
};

export function getSecret(key: Key): string | null {
  prepare();
  if (memory.has(key)) return memory.get(key) ?? null;
  if (!sealing()) return null;
  const all = load();
  const sealed = all[key];
  if (typeof sealed !== "string" || !sealed) return null;
  const value = open(sealed);
  if (value !== null) {
    memory.set(key, value);
    return value;
  }
  // sealed with a key this run doesn't have: an older value that opens is the one to use
  const back = olds(all, key).find((s) => open(s) !== null);
  if (!back) {
    log("main", `secret ${key} can't be opened (kept as it is)`);
    return null;
  }
  log("main", `secret ${key} can't be opened: an earlier one is put back`);
  all[key] = back;
  keepOld(all, key, sealed, back);
  save(all);
  const restored = open(back)!;
  memory.set(key, restored);
  return restored;
}

/** The stored values this run can't open (nothing is changed): a sign that it started with another encryption key. */
export function unopenedSecrets(): string[] {
  if (!sealing()) return [];
  return Object.entries(load()).flatMap(([k, v]) => (!k.includes("~") && typeof v === "string" && v && open(v) === null ? [v] : []));
}

export function setSecret(key: Key, value: string | null) {
  if (value === null) memory.delete(key);
  else memory.set(key, value);
  if (!sealing()) return; // ephemeral: kept for this run, never written
  const all = load();
  const was = all[key];
  if (GUARDED.has(key) && typeof was === "string" && was && open(was) !== value) keepOld(all, key, was);
  if (value === null) delete all[key];
  else all[key] = safeStorage.encryptString(value).toString("base64");
  save(all);
}

/**
 * Sign out and forget: the in-memory copies, the on-disk file, and the quarantine this build made (all of it is only
 * this app's credentials). User data — playlists, history, settings — is untouched.
 */
export function clearSecrets() {
  memory.clear();
  rmSync(path(), { force: true });
  rmSync(quarantine(), { force: true });
}
