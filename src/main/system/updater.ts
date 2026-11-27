import { app, type BrowserWindow } from "electron";
import { UPDATE_REPO, type UpdateStatus } from "@shared/ipc";
import { log } from "./log";
import { isPortableRelease } from "./updater-check";

/** electron-updater and its dependencies (js-yaml, fs-extra …) are half the main bundle: loaded on the first update check, not at start. */
let updater: Promise<(typeof import("electron-updater"))["autoUpdater"]> | null = null;
const auto = () => (updater ??= import("electron-updater").then((m) => m.autoUpdater));
const EVERY = 6 * 3600 * 1000;

/**
 * Updates from this project's own GitHub Releases (xsitraxs/Moonwave). The installed app downloads the new version
 * when asked and installs it on restart. A portable .exe can't replace itself, so it is only told that a new version
 * exists (with a link to the release). Off in development.
 *
 * The repository is named in one place, `UPDATE_REPO` in @shared/ipc, so the feed and the "open the release" button
 * can never drift apart again: they did, and the check looked at a repository this build does not come from.
 */
let status: UpdateStatus = { state: "idle" };
let send: (s: UpdateStatus) => void = () => {};
const portable = () => isPortableRelease();

function setStatus(next: UpdateStatus) {
  status = next;
  send(status);
}

export function initUpdater(win: () => BrowserWindow | null, enabled: () => boolean) {
  send = (s) => {
    const w = win();
    if (w && !w.isDestroyed()) w.webContents.send("update:status", s);
  };
  if (!app.isPackaged) return;
  void auto().then((up) => {
    // the feed itself, not resources/app-update.yml: the portable .exe has no such file, so it never heard of a new
    // version ("update: ENOENT … app-update.yml"). Same as package.json → build.publish.
    up.setFeedURL({ provider: "github", owner: UPDATE_REPO.owner, repo: UPDATE_REPO.repo });
    up.autoDownload = false;
    up.autoInstallOnAppQuit = true;
    up.on("checking-for-update", () => setStatus({ state: "checking" }));
    up.on("update-not-available", () => setStatus({ state: "none" }));
    up.on("update-available", (info) => setStatus({ state: "available", version: info.version, portable: portable() }));
    up.on("download-progress", (p) => {
      if (status.state === "available" || status.state === "downloading") setStatus({ state: "downloading", version: status.version, percent: Math.round(p.percent) });
    });
    up.on("update-downloaded", (info) => setStatus({ state: "ready", version: info.version }));
    up.on("error", (err) => {
      // the first line only: electron-updater appends the response headers and a stack
      log("main", `update: ${err.message.split("\n")[0]}`);
      setStatus({ state: "error", message: err.message });
    });
    const tick = () => {
      if (enabled()) void check();
    };
    setTimeout(tick, 8000);
    setInterval(tick, EVERY);
  });
}

export const updateStatus = () => status;

export async function check(): Promise<UpdateStatus> {
  if (!app.isPackaged) return { state: "none" };
  if (status.state === "downloading" || status.state === "ready") return status;
  try {
    await (await auto()).checkForUpdates();
  } catch (err) {
    setStatus({ state: "error", message: (err as Error).message });
  }
  return status;
}

export function download() {
  if (status.state === "available" && !portable()) void auto().then((up) => up.downloadUpdate());
}

export function install() {
  if (status.state === "ready") void auto().then((up) => up.quitAndInstall(false, true));
}
