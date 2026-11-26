import { createHash } from "node:crypto";
import { app } from "electron";
import { isLocalTrack, type BackupStatus, type RestoreResult } from "@shared/types";
import { likesData, mergeLikes, type LikesData } from "./local-likes";
import { exportLocal, importLocal } from "./local-playlists";
import { mergeOwnLyrics, ownLyricsData } from "./lyrics";
import { adoptFriendSecret, api, friendSecret, serverBase } from "./social";
import { ScError } from "./soundcloud";
import { backupId, backupWriteToken, cleanKey, newBackupKey, openBackup, sealBackup } from "./backup-crypto";
import { getSecret, setSecret } from "./store/secrets";
import { log } from "./system/log";

/**
 * A copy of what lives only on this computer — likes, own playlists, own lyrics and the friend code — kept on
 * Moonwave's server, so a new computer gets it all back with the transfer key (Settings → Account). The key never
 * leaves the computer: it names the copy, guards writing it and encrypts it (AES-256-GCM), so the server holds bytes
 * it can't read. Lost key, lost copy — the page says so.
 */
const CHECK_MS = 2 * 60_000;

interface Payload {
  app: "Moonwave";
  kind: "backup";
  version: 1;
  at: number;
  likes: LikesData;
  /** the playlists file as Export writes it */
  playlists: string;
  ownLyrics: Record<string, { text: string; at: number }>;
  /** the friend code's secret (null: no code on that computer) */
  friend: string | null;
}

function payload(): Payload {
  return { app: "Moonwave", kind: "backup", version: 1, at: Date.now(), // files from this computer get other ids elsewhere: their likes stay here
    likes: { ...likesData(), liked: likesData().liked.filter((l) => !isLocalTrack(l.id)) }, playlists: exportLocal().text, ownLyrics: ownLyricsData(), friend: friendSecret() };
}
/** what the copy holds, without its time: unchanged since the last upload means nothing goes */
const fingerprint = (p: Payload) => createHash("sha256").update(JSON.stringify({ ...p, at: 0 })).digest("hex");

let last: { at: number; fingerprint: string } | null = null;
let failed = "";

export function backupStatus(): BackupStatus {
  return { available: !!serverBase(), key: getSecret("backupKey"), at: last?.at ?? null, error: failed || null };
}

/** The copy as it is now, when it changed (or `force`). The key is made on the first one. */
export async function backupNow(force = false): Promise<BackupStatus> {
  if (!serverBase()) return backupStatus();
  const p = payload();
  // nothing here yet worth keeping: no key, no copy
  if (!getSecret("backupKey") && !p.likes.liked.length && !p.likes.playlists?.length && !JSON.parse(p.playlists).playlists.length && !Object.keys(p.ownLyrics).length && !p.friend) return backupStatus();
  let key = getSecret("backupKey");
  if (!key) {
    key = newBackupKey();
    setSecret("backupKey", key);
  }
  const fp = fingerprint(p);
  if (!force && last?.fingerprint === fp) return backupStatus();
  try {
    await api("PUT", `/v1/backup/${backupId(key)}`, { raw: sealBackup(key, p), auth: false, headers: { "x-backup-write": backupWriteToken(key) }, timeout: 60_000 });
    last = { at: Date.now(), fingerprint: fp };
    failed = "";
  } catch (e) {
    failed = e instanceof Error ? e.message : String(e);
    log("main", `backup: not sent: ${failed}`);
  }
  return backupStatus();
}

/**
 * Everything in the copy a key opens, added to what's here: likes and playlists merged (nothing here is lost), own
 * lyrics for tracks that have none here. The friend code comes too when this computer has none — or replaces this
 * one's when `replaceCode` (asked first). The key becomes this computer's, so its copy goes on from here.
 */
export async function restoreBackup(typed: string, replaceCode = false): Promise<RestoreResult> {
  if (cleanKey(typed).length !== 32) throw new ScError("unknown", "A transfer key is 32 letters and digits");
  const key = typed.trim().toUpperCase();
  const data = await api<ArrayBuffer>("GET", `/v1/backup/${backupId(key)}`, { auth: false, binary: true, timeout: 60_000 }).catch((e: unknown) => {
    if (e instanceof ScError && e.code === "not_found") throw new ScError("not_found", "No backup for that key");
    throw e;
  });
  const p = openBackup<Payload>(key, Buffer.from(data));
  const likes = mergeLikes(p.likes ?? { liked: [], hidden: [] });
  const playlists = p.playlists ? importLocal(p.playlists) : 0;
  const lyrics = mergeOwnLyrics(p.ownLyrics ?? {});
  let code: RestoreResult["code"] = "none";
  const mine = friendSecret();
  if (p.friend) {
    if (!mine || mine === p.friend) code = mine ? "same" : "restored";
    else code = replaceCode ? "restored" : "differs";
    if (code === "restored") await adoptFriendSecret(p.friend);
  }
  if (code !== "differs") {
    setSecret("backupKey", key);
    last = null;
  }
  return { likes, playlists, lyrics, code };
}

/** Checks for changes every couple of minutes (and once soon after the start). */
export function initBackup() {
  if (!serverBase()) return;
  setTimeout(() => void backupNow(), 60_000);
  setInterval(() => void backupNow(), CHECK_MS);
  // will-quit is cancellable: the exit backup finishes (or gives up) before the process dies, only once
  let quitPending = false;
  app.on("will-quit", async (event) => {
    if (quitPending) return;
    quitPending = true;
    event.preventDefault();
    try {
      await backupNow();
    } catch {
      /* the exit backup is best-effort: a dead network must not hang the quit */
    }
    app.quit();
  });
}
