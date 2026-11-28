import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Track } from "@shared/types";
import { useT } from "@/i18n";
import { setMiniPlayer } from "@/lib/miniPlayer";
import { enterFast, exit } from "@/lib/motion";
import { call } from "@/lib/sky";
import { useNav, type Section } from "@/state/nav";
import { player, usePlayer } from "@/state/player";
import { useRoomSheet } from "@/state/room";
import { useSettings } from "@/state/settings";
import { useUi } from "@/state/ui";
import Icon, { type IconName } from "../ui/Icon";

interface CommandItem {
  id: string;
  label: string;
  sub?: string;
  keywords: string;
  icon: IconName;
  shortcut?: string;
  run: () => void;
}

/** Quick command palette (Ctrl+P): jump to any screen or trigger common player/UI actions. */
export default function CommandPalette() {
  const t = useT();
  const open = useUi((s) => s.commandPaletteOpen);
  const setOpen = useUi((s) => s.setCommandPaletteOpen);
  const navOpen = useNav((s) => s.open);
  const navGo = useNav((s) => s.go);
  const hasTrack = usePlayer((s) => s.index >= 0);
  const pinnedPlaylists = useSettings((s) => s.pinnedPlaylists);
  const history = useSettings((s) => s.history);

  const [wasOpen, setWasOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setQuery("");
      setActive(0);
    }
  }

  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeItemRef = useRef<HTMLButtonElement>(null);
  const scrollActive = useRef(false);

  const { data: localTracks = [] } = useQuery<Track[]>({
    queryKey: ["local-tracks"],
    queryFn: () => call("local:list"),
    enabled: open,
    staleTime: 60_000,
  });

  const commands = useMemo<CommandItem[]>(() => {
    const go = (key: Section | null, route: Parameters<typeof navOpen>[1]) => () =>
      key ? navOpen(key, route) : navGo(route);
    const list: CommandItem[] = [
      { id: "nav-home", label: t.home, keywords: "home главная", icon: "home", run: go("home", { name: "home" }) },
      { id: "nav-likes", label: t.likedTracks, keywords: "likes лайки favorites", icon: "heart", run: go("likes", { name: "likes" }) },
      { id: "nav-feed", label: t.feed, keywords: "feed лента stream", icon: "feed", run: go("feed", { name: "feed" }) },
      { id: "nav-playlists", label: t.playlists, keywords: "playlists плейлисты", icon: "playlists", run: go("playlists", { name: "playlists" }) },
      { id: "nav-albums", label: t.albums, keywords: "albums альбомы", icon: "disc", run: go("albums", { name: "albums" }) },
      { id: "nav-stations", label: t.stations, keywords: "stations станции радио", icon: "radio", run: go("stations", { name: "stations" }) },
      { id: "nav-following", label: t.following, keywords: "following подписки artists", icon: "user", run: go("following", { name: "following" }) },
      { id: "nav-history", label: t.history, keywords: "history история recent", icon: "history", run: go("history", { name: "history" }) },
      { id: "nav-local", label: t.localMusic, keywords: "local локальная музыка files", icon: "list", run: go("local", { name: "local" }) },
      { id: "nav-dj", label: t.dj, keywords: "dj диджей mix", icon: "dj", run: go("dj", { name: "dj" }) },
      { id: "nav-inbox", label: t.inbox, keywords: "inbox сообщения friends друзья", icon: "inbox", run: go("inbox", { name: "inbox" }) },
      { id: "nav-workshop", label: t.workshop, keywords: "workshop мастерская themes темы", icon: "brush", run: go("workshop", { name: "workshop" }) },
      { id: "nav-import", label: t.importTitle, keywords: "import vk spotify yandex youtube импорт", icon: "plus", run: go(null, { name: "import" }) },
      { id: "nav-settings", label: t.settings, keywords: "settings настройки preferences proxy", icon: "settings", run: go("settings", { name: "settings" }) },
      {
        id: "act-queue",
        label: t.queue,
        keywords: "queue очередь toggle",
        icon: "queue",
        run: () => useUi.getState().toggleSideQueue(),
      },
      {
        id: "act-room",
        label: t.listenTogether,
        keywords: "room комната listen together слушать вместе",
        icon: "users",
        run: () => useRoomSheet.setState({ open: true }),
      },
      {
        id: "act-mini",
        label: t.miniPlayer,
        keywords: "mini player мини плеер compact",
        icon: "minimize",
        run: () => void setMiniPlayer(true),
      },
      {
        id: "act-hotkeys",
        label: t.hotkeysTitle,
        keywords: "hotkeys shortcuts клавиши",
        icon: "sparkle",
        shortcut: "?",
        run: () => useUi.getState().setHotkeysOpen(true),
      },
    ];
    if (hasTrack) {
      list.push(
        { id: "act-play", label: t.hkPlayPause, keywords: "play pause пауза играть", icon: "play", shortcut: "Space", run: () => player.toggle() },
        { id: "act-next", label: t.hkNext, keywords: "next следующий трек skip", icon: "next", run: () => player.next() },
      );
    }
    return list;
  }, [hasTrack, navGo, navOpen, t]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    const base = commands.filter((c) => c.label.toLowerCase().includes(q) || c.keywords.toLowerCase().includes(q));
    const extra: CommandItem[] = [];

    for (const p of pinnedPlaylists) {
      if (p.title.toLowerCase().includes(q)) {
        extra.push({
          id: `pl-${p.id}`,
          label: p.title,
          sub: t.playlists,
          keywords: "",
          icon: "playlists",
          run: () => navGo({ name: "playlist", id: p.id }),
        });
      }
      if (extra.length >= 6) break;
    }

    const seen = new Set<number>();
    let histCount = 0;
    for (let i = 0; i < history.length && histCount < 6; i++) {
      const tr = history[i]!;
      if (seen.has(tr.id)) continue;
      if (tr.title.toLowerCase().includes(q) || tr.artist.toLowerCase().includes(q)) {
        seen.add(tr.id);
        histCount++;
        extra.push({
          id: `hist-${tr.id}`,
          label: tr.title,
          sub: `${tr.artist} · ${t.history}`,
          keywords: "",
          icon: "history",
          run: () => player.playFrom(history, i, { kind: "static" }),
        });
      }
    }

    let localCount = 0;
    for (let i = 0; i < localTracks.length && localCount < 6; i++) {
      const tr = localTracks[i]!;
      if (seen.has(tr.id)) continue;
      if (tr.title.toLowerCase().includes(q) || tr.artist.toLowerCase().includes(q)) {
        seen.add(tr.id);
        localCount++;
        extra.push({
          id: `local-${tr.id}`,
          label: tr.title,
          sub: `${tr.artist} · ${t.localMusic}`,
          keywords: "",
          icon: "list",
          run: () => player.playFrom(localTracks, i, { kind: "static" }),
        });
      }
    }

    return [...base, ...extra];
  }, [commands, history, localTracks, navGo, pinnedPlaylists, query, t.history, t.localMusic, t.playlists]);

  const safeActive = filtered.length ? Math.min(active, filtered.length - 1) : 0;

  const execute = (item: CommandItem | undefined) => {
    if (!item) return;
    setOpen(false);
    item.run();
  };

  const stateRef = useRef({ filtered, safeActive, execute });
  useEffect(() => {
    stateRef.current = { filtered, safeActive, execute };
  });

  useEffect(() => {
    if (!open) return;
    const dialogEl = dialogRef.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        setOpen(false);
      } else if (e.key === "Tab") {
        e.preventDefault();
        inputRef.current?.focus();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        scrollActive.current = true;
        const len = stateRef.current.filtered.length;
        setActive((i) => (len ? (Math.min(i, len - 1) + 1) % len : 0));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        scrollActive.current = true;
        const len = stateRef.current.filtered.length;
        setActive((i) => (len ? (Math.min(i, len - 1) - 1 + len) % len : 0));
      } else if (e.key === "Enter" && !e.isComposing) {
        e.preventDefault();
        const { filtered: items, safeActive: idx, execute: run } = stateRef.current;
        run(items[idx]);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener("keydown", onKey, true);
      const cur = document.activeElement;
      if (previous?.isConnected && (!cur || cur === document.body || dialogEl?.contains(cur))) {
        previous.focus();
      }
    };
  }, [open, setOpen]);

  useEffect(() => {
    if (!open || !scrollActive.current) return;
    scrollActive.current = false;
    activeItemRef.current?.scrollIntoView({ block: "nearest" });
  }, [open, safeActive]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={exit()}
          onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}
          className="fixed inset-0 z-[85] flex items-start justify-center bg-black/55 pt-[14vh] backdrop-blur-sm"
        >
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={enterFast()}
            className="w-full max-w-[500px] overflow-hidden rounded-[14px] border border-[var(--s-line2)] bg-[var(--bg-2)]/95 shadow-2xl backdrop-blur-xl"
            data-keys-own
          >
            <div className="flex items-center gap-2.5 border-b border-[var(--s-line)] px-4 py-3">
              <Icon name="search" size={16} className="shrink-0 text-muted" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                placeholder={`${t.search}...`}
                className="w-full bg-transparent text-sm text-text outline-none placeholder:text-muted"
              />
              <kbd className="rounded border border-[var(--s-line2)] bg-white/[0.06] px-1.5 py-0.5 font-mono text-[11px] text-muted">Esc</kbd>
            </div>

            <div className="max-h-[340px] overflow-y-auto p-1.5">
              {filtered.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted">—</p>
              ) : (
                filtered.map((item, idx) => (
                  <button
                    key={item.id}
                    type="button"
                    ref={idx === safeActive ? activeItemRef : undefined}
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => execute(item)}
                    className={`flex w-full items-center gap-3 rounded-[9px] px-3 py-2 text-left text-sm transition-colors ${
                      idx === safeActive ? "bg-white/[0.1] text-text" : "text-muted hover:bg-white/[0.05] hover:text-text"
                    }`}
                  >
                    <Icon name={item.icon} size={16} className="shrink-0 opacity-80" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{item.label}</span>
                      {item.sub && <span className="block truncate text-[11px] text-[var(--s-dim)]">{item.sub}</span>}
                    </span>
                    {item.shortcut && (
                      <kbd className="rounded border border-[var(--s-line2)] bg-white/[0.05] px-1.5 py-0.5 font-mono text-[11px] text-muted">
                        {item.shortcut}
                      </kbd>
                    )}
                  </button>
                ))
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
