import { create } from "zustand";
import type { Track } from "@shared/types";
import { isReducedMotion, queueExitMs } from "@/lib/motion";

export type QueuePhase = "closed" | "open" | "closing";

interface UiStore {
  queueOpen: boolean;
  toggleQueue(): void;
  closeQueue(): void;
  /** the words panel; it opens where the queue does, so one closes the other */
  lyricsOpen: boolean;
  toggleLyrics(): void;
  closeLyrics(): void;
  /** studio: the queue panel on the right (remembered on this PC) */
  sideQueue: boolean;
  /** three-phase layout/animation state for the side queue (`open` / `closing` / `closed`) */
  queuePhase: QueuePhase;
  openSideQueue(): void;
  closeSideQueue(): void;
  toggleSideQueue(): void;
  /** studio: the Appearance popover, opened from the sidebar ("side") or the full screen player ("full") */
  appearance: "side" | "full" | null;
  setAppearance(where: "side" | "full" | null): void;
  /** the workshop is taking its picture of the look: the page steps aside */
  posing: boolean;
  setPosing(posing: boolean): void;
  /** what the full screen player shows on the right */
  fullTab: FullTab;
  setFullTab(tab: FullTab): void;
  /** the player over the whole window: big cover with its spectrum, the words sung line by line */
  fullOpen: boolean;
  openFull(): void;
  closeFull(): void;
  /** the track context menu (right click / menu key on a row) */
  menu: { x: number; y: number; track: Track } | null;
  openMenu(x: number, y: number, track: Track): void;
  closeMenu(): void;
  /** "Add to playlist" picker for this track */
  picker: Track | null;
  openPicker(track: Track): void;
  closePicker(): void;
  /** a protected track with no other upload was skipped: say so, with a link to it on SoundCloud */
  skipped: Track | null;
  noteSkipped(track: Track): void;
  clearSkipped(): void;
  /** a short message at the bottom ("Link copied") */
  toast: { id: number; text: string } | null;
  showToast(text: string): void;
}

export type FullTab = "lyrics" | "queue" | "visualizer";

let toastTimer = 0;
let skippedTimer = 0;
let sideQueueTimer = 0;
const SIDE_QUEUE = "sc.sideQueue";
const stored = (() => {
  try {
    return localStorage.getItem(SIDE_QUEUE);
  } catch {
    return null;
  }
})();
const initialSideQueue = stored !== "0";

function persistSideQueue(open: boolean) {
  try {
    localStorage.setItem(SIDE_QUEUE, open ? "1" : "0");
  } catch {
    /* only for this run then */
  }
}

/** Return focus to the queue toggle before `inert` is committed on `<aside class="s-queue">`. */
function restoreQueueFocusIfInside() {
  if (typeof document === "undefined") return;
  const active = document.activeElement;
  const panel = document.querySelector(".s-queue");
  if (panel && active && panel.contains(active)) {
    document.querySelector<HTMLElement>("[data-queue-toggle]")?.focus();
  }
}

export const useUi = create<UiStore>((set, get) => ({
  queueOpen: false,
  toggleQueue: () => set((s) => ({ queueOpen: !s.queueOpen, lyricsOpen: false })),
  lyricsOpen: false,
  toggleLyrics: () => set((s) => ({ lyricsOpen: !s.lyricsOpen, queueOpen: false })),
  closeLyrics: () => set({ lyricsOpen: false }),
  closeQueue: () => set({ queueOpen: false }),
  sideQueue: initialSideQueue,
  queuePhase: initialSideQueue ? "open" : "closed",
  openSideQueue: () => {
    window.clearTimeout(sideQueueTimer);
    persistSideQueue(true);
    set({ sideQueue: true, queuePhase: "open" });
  },
  closeSideQueue: () => {
    window.clearTimeout(sideQueueTimer);
    persistSideQueue(false);
    restoreQueueFocusIfInside();
    const delay = isReducedMotion() ? 0 : queueExitMs();
    if (delay <= 0) {
      set({ sideQueue: false, queuePhase: "closed" });
      return;
    }
    set({ sideQueue: false, queuePhase: "closing" });
    sideQueueTimer = window.setTimeout(() => {
      set((s) => (s.queuePhase === "closing" ? { queuePhase: "closed" } : s));
    }, delay);
  },
  toggleSideQueue: () => {
    if (get().sideQueue) get().closeSideQueue();
    else get().openSideQueue();
  },
  appearance: null,
  setAppearance: (appearance) => set({ appearance }),
  posing: false,
  setPosing: (posing) => set({ posing }),
  fullTab: "lyrics",
  setFullTab: (fullTab) => set({ fullTab }),
  fullOpen: false,
  openFull: () => set({ fullOpen: true, queueOpen: false, lyricsOpen: false }),
  closeFull: () => set({ fullOpen: false }),
  menu: null,
  openMenu: (x, y, track) => set({ menu: { x, y, track } }),
  closeMenu: () => set({ menu: null }),
  picker: null,
  openPicker: (track) => set({ picker: track }),
  closePicker: () => set({ picker: null }),
  skipped: null,
  noteSkipped: (track) => {
    window.clearTimeout(skippedTimer);
    set({ skipped: track });
    skippedTimer = window.setTimeout(() => set({ skipped: null }), 9000);
  },
  clearSkipped: () => {
    window.clearTimeout(skippedTimer);
    set({ skipped: null });
  },
  toast: null,
  showToast: (text) => {
    window.clearTimeout(toastTimer);
    set({ toast: { id: Date.now(), text } });
    toastTimer = window.setTimeout(() => set({ toast: null }), 2200);
  },
}));
