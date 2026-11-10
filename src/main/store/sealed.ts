/**
 * The shape of secrets.bin and the bookkeeping on it, apart from Electron so it can be tested: each key holds its
 * current sealed value, and an account key also keeps the values it replaced under "<key>~old" (newest first).
 */
export type Sealed = Record<string, string | string[]>;

export const KEEP_OLD = 4;

const oldKey = (key: string) => `${key}~old`;

/** The earlier sealed values of `key`, newest first (anything malformed in the file is skipped). */
export function olds(all: Sealed, key: string): string[] {
  const v = all[oldKey(key)];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x) : [];
}

/** Puts `sealed` first among the earlier values (once), drops `drop`, keeps the newest KEEP_OLD. */
export function keepOld(all: Sealed, key: string, sealed: string, drop?: string) {
  all[oldKey(key)] = [sealed, ...olds(all, key).filter((s) => s !== sealed && s !== drop)].slice(0, KEEP_OLD);
}

/** The value and every earlier one of `key` removed; true when there was anything to remove. */
export function forgetAll(all: Sealed, key: string): boolean {
  const had = key in all || oldKey(key) in all;
  delete all[key];
  delete all[oldKey(key)];
  return had;
}

/**
 * Earlier copies whose key has no current value: what a removal left (2.5.0 and earlier kept them even on sign-out).
 * They can never be what the old copies are for, putting back a current value that won't open, since there is no
 * current value. All they could do is bring a removed account back once a new value fails to open, so they go.
 * True when anything was removed.
 */
export function dropOrphans(all: Sealed, keys: Iterable<string>): boolean {
  let changed = false;
  for (const key of keys) {
    if (typeof all[key] === "string" && all[key]) continue;
    if (oldKey(key) in all) {
      delete all[oldKey(key)];
      changed = true;
    }
  }
  return changed;
}
