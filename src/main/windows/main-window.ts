import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, shell } from "electron";
import type { EventMap, WindowActivity } from "@shared/ipc";
import { isOwnIndexFile } from "@shared/appUrl";
import { appIcon } from "../system/tray";

/** Windows' own window buttons: as tall as the page's title bars (the main one's 52 px box, the full screen player's 48),
 * so their hover squares sit around the page's drawn icons (WindowButtons draws them in this same strip) */
export const TITLEBAR_HEIGHT = 48;
const DEV_URL = process.env.ELECTRON_RENDERER_URL;
/** the dev server's origin, so http://localhost:5173.evil.com is not "starts with the dev url" */
const DEV_ORIGIN = DEV_URL ? new URL(DEV_URL).origin : null;
/** the one file the window may ever show: the page this build shipped (never any other file on disk) */
const INDEX_HREF = pathToFileURL(join(import.meta.dirname, "../renderer/index.html")).href;

export function isAppUrl(url: string) {
  // in development the page comes from the dev server; in a packaged build it is exactly this one file
  if (DEV_ORIGIN) {
    try {
      return new URL(url).origin === DEV_ORIGIN;
    } catch {
      return false;
    }
  }
  return isOwnIndexFile(url, INDEX_HREF);
}

export function send<K extends keyof EventMap>(win: BrowserWindow | null, channel: K, payload: EventMap[K]) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

/**
 * Frameless window, with the app icon. The caption buttons are Windows' own (Window Controls Overlay), made fully transparent: the page
 * draws its marker-style buttons underneath, while Windows keeps dragging, double-click to maximize and the Windows 11
 * Snap Layouts flyout working on the real maximize button.
 */
export function createMainWindow(opts: { startHidden: boolean; closeToTray: () => boolean; quitting: () => boolean }) {
  const isMac = process.platform === "darwin";
  const win = new BrowserWindow({
    width: 1240,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: "sc player",
    icon: appIcon(),
    backgroundColor: "#07050d",
    titleBarStyle: isMac ? "hiddenInset" : "hidden",
    // Linux: no overlay — Electron draws its own round buttons there, which didn't line up with the page's; the page's
    // drawn buttons are the real ones instead (WindowButtons without the overlay)
    ...(isMac
      ? { trafficLightPosition: { x: 14, y: 12 } }
      : process.platform === "win32"
        ? { titleBarOverlay: { color: "#00000000", symbolColor: "#00000000", height: TITLEBAR_HEIGHT } }
        : { frame: false }),
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // audio keeps buffering while the window is hidden; the page stops its own animations instead (win:activity)
      backgroundThrottling: false,
      spellcheck: false,
    },
  });

  // started with Windows and "start minimized": stay in the tray until the icon is clicked
  win.once("ready-to-show", () => {
    if (!opts.startHidden) win.show();
  });

  // the ✕ hides the window to the tray (Settings → close button), the music keeps playing
  win.on("close", (e) => {
    if (opts.quitting()) return;
    if (isMac || opts.closeToTray()) {
      e.preventDefault();
      win.hide();
    }
  });

  // the window only ever shows the app itself; links go to the real browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!isAppUrl(url)) e.preventDefault();
  });

  // tell the page whether anyone can see it: hidden → everything stops, blurred → only progress keeps moving
  let last: WindowActivity | null = null;
  const activity = () => {
    const next: WindowActivity = !win.isVisible() || win.isMinimized() ? "hidden" : win.isFocused() ? "active" : "blurred";
    if (next === last) return;
    last = next;
    send(win, "win:activity", next);
  };
  for (const ev of ["show", "hide", "minimize", "restore", "focus", "blur"] as const) win.on(ev as "show", activity);
  win.webContents.on("did-finish-load", () => {
    last = null;
    activity();
    send(win, "win:maximized", win.isMaximized());
  });
  win.on("maximize", () => send(win, "win:maximized", true));
  win.on("unmaximize", () => send(win, "win:maximized", false));

  if (DEV_URL) void win.loadURL(DEV_URL);
  // SKY_DEBUG_STORES=1 when run from the sources (not installed): the page puts its stores on window.__sc, for profiling
  else void win.loadFile(join(import.meta.dirname, "../renderer/index.html"), !app.isPackaged && process.env.SKY_DEBUG_STORES === "1" ? { search: "sc-debug" } : undefined);
  return win;
}
