import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * The bytes of a Moonwave backup: AES-256-GCM under a key derived from the transfer key, with a four-byte "SCB1" head
 * so a file that isn't a backup is told apart from one this key doesn't open. Nothing here touches Electron or the
 * store, so the format can be checked on its own (backup-crypto.test.ts) — the format itself must not change: copies
 * made by older versions are opened by newer ones.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford's base32: no I, L, O, U

/**
 * What a bad key or a bad file throws: the same shape as the app's ScError ("unknown") and the same messages, but its
 * own class — this module stays free of imports the test runner can't load, so the format can be checked on its own.
 */
export class BackupError extends Error {
  readonly code = "unknown";
  constructor(message: string) {
    super(message);
    this.name = "BackupError";
  }
}

/** A key's letters only, upper case (dashes and spaces as typed are fine). */
export const cleanKey = (key: string) => key.toUpperCase().replace(/[^0-9A-Z]/g, "");
const derive = (key: string, label: string) => createHash("sha256").update(`scp-backup-${label}:${cleanKey(key)}`).digest();

export function newBackupKey(): string {
  // 32 characters of 5 bits: 160 bits, nothing to guess
  const bytes = randomBytes(32);
  let out = "";
  for (const b of bytes) out += ALPHABET[b & 31];
  return out.match(/.{1,4}/g)!.join("-");
}

export function sealBackup(key: string, payload: unknown): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", derive(key, "enc"), iv);
  const body = Buffer.concat([c.update(JSON.stringify(payload), "utf8"), c.final()]);
  return Buffer.concat([Buffer.from("SCB1"), iv, body, c.getAuthTag()]);
}

export function openBackup<T>(key: string, data: Buffer): T {
  if (data.subarray(0, 4).toString() !== "SCB1") throw new BackupError("This isn't a Moonwave backup");
  try {
    const d = createDecipheriv("aes-256-gcm", derive(key, "enc"), data.subarray(4, 16));
    d.setAuthTag(data.subarray(data.length - 16));
    return JSON.parse(Buffer.concat([d.update(data.subarray(16, data.length - 16)), d.final()]).toString("utf8")) as T;
  } catch {
    throw new BackupError("That key doesn't open this backup");
  }
}

export const backupId = (key: string) => derive(key, "id").toString("hex");
export const backupWriteToken = (key: string) => derive(key, "write").toString("hex");
