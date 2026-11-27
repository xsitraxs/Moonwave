import { useEffect, useRef, useState } from "react";
import logo from "../../../../../assets/app-icon-small.svg";
import { errorText, useT } from "@/i18n";
import { looksLikeLink, openLink } from "@/lib/links";
import { errorCode } from "@/lib/sky";
import { useUi } from "@/state/ui";
import { useNav } from "@/state/nav";
import { useSettings } from "@/state/settings";
import { unreadTotal, useSocial } from "@/state/social";
import { getViewValue, setViewValue, subscribeView } from "@/state/viewState";
import { WindowButtons } from "../chrome/TitleBar";
import Icon from "../ui/Icon";

const SEARCH_ROUTE = JSON.stringify({ name: "search" });
const POPULAR = ["Electronic", "Hip-Hop", "Lo-Fi", "Phonk", "Ambient", "Indie", "Rock", "House"] as const;

/**
 * The search box in the title bar: typing goes to Search with the words (Search keeps them as its own); Ctrl+K or
 * Ctrl+F puts the cursor here; Esc leaves it. On focus it offers recent searches and popular genres.
 */
function SearchBox() {
  const t = useT();
  const open = useNav((s) => s.open);
  const onSearch = useNav((s) => s.route.name === "search");
  const toast = useUi((s) => s.showToast);
  const history = useSettings((s) => s.searchHistory);
  const box = useRef<HTMLInputElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [text, setText] = useState(() => String(getViewValue(SEARCH_ROUTE, "text") ?? ""));
  const [focused, setFocused] = useState(false);

  // what Search itself shows (its own box, a recent search picked there) comes back here
  useEffect(
    () =>
      subscribeView(() => {
        if (document.activeElement !== box.current) setText(String(getViewValue(SEARCH_ROUTE, "text") ?? ""));
      }),
    [],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.defaultPrevented && !document.querySelector("[data-onboarding-dialog]") && !useUi.getState().hotkeysOpen && e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && e.code === "KeyK") {
        e.preventDefault();
        box.current?.focus();
        box.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const change = (v: string) => {
    setText(v);
    setViewValue(SEARCH_ROUTE, "text", v);
    if (!v.trim()) setViewValue(SEARCH_ROUTE, "query", "");
    if (!onSearch && v.trim()) open("search", { name: "search" });
  };

  const commit = (q: string) => {
    const clean = q.trim();
    if (!clean) return;
    setText(clean);
    setViewValue(SEARCH_ROUTE, "text", clean);
    setViewValue(SEARCH_ROUTE, "query", clean);
    useSettings.getState().recordSearch(clean);
    if (!onSearch) open("search", { name: "search" });
    setFocused(false);
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  };

  const clear = () => {
    setText("");
    setViewValue(SEARCH_ROUTE, "text", "");
    setViewValue(SEARCH_ROUTE, "query", "");
    box.current?.focus();
  };

  const showPanel = focused && !text.trim() && (history.length > 0 || POPULAR.length > 0);

  return (
    <div ref={wrap} className="s-search-wrap" onFocus={() => setFocused(true)} onBlur={(e) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
    }} onKeyDown={(e) => {
      if (!showPanel) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        box.current?.focus();
        setFocused(false);
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const options = Array.from(wrap.current?.querySelectorAll<HTMLButtonElement>("[data-search-suggestion]") ?? []);
        if (!options.length) return;
        e.preventDefault();
        e.stopPropagation();
        const current = options.indexOf(document.activeElement as HTMLButtonElement);
        const next = current < 0 ? (e.key === "ArrowDown" ? 0 : options.length - 1) : (current + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
        options[next]?.focus();
      }
    }}>
      <div
        className="s-search s-glass"
        data-titlebar-search
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest("button") === null && e.target !== box.current) {
            e.preventDefault();
            box.current?.focus();
          }
        }}
      >
        <Icon name="search" size={16} />
        <input
          ref={box}
          value={text}
          onClick={() => setFocused(true)}
          onChange={(e) => change(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              if (looksLikeLink(text)) {
                void openLink(text).catch((err) => toast(errorText(t, errorCode(err))));
              } else {
                commit(text);
              }
            }
          }}
          placeholder={t.searchEverywhere}
          aria-label={t.search}
          data-keys-own
        />
        {text ? (
          <button
            type="button"
            onClick={clear}
            aria-label={t.clearSearch}
            title={t.clearSearch}
            className="grid h-5 w-5 shrink-0 place-items-center rounded text-[var(--s-dim)] transition-colors motion-color hover:bg-white/[0.08] hover:text-text"
          >
            <Icon name="close" size={12} />
          </button>
        ) : (
          <kbd>Ctrl K</kbd>
        )}
      </div>
      {showPanel && (
        <div className="s-search-panel s-pop s-glass" role="group" aria-label={t.search}>
          {history.length > 0 && (
            <>
              <div className="s-lbl mx-2 mb-1.5 mt-1">{t.recentSearches}</div>
              <div className="flex flex-wrap gap-1.5 px-2 pb-2">
                {history.slice(0, 6).map((h) => (
                  <button
                    key={h}
                    type="button"
                    data-search-suggestion
                    onClick={() => commit(h)}
                    className="inline-flex max-w-[240px] items-center gap-1.5 rounded-full border border-[var(--s-line)] bg-white/[0.04] px-3 py-1 text-[12px] text-muted transition-colors motion-color hover:border-[var(--s-line2)] hover:bg-white/[0.08] hover:text-text"
                  >
                    <Icon name="history" size={12} className="shrink-0 opacity-70" />
                    <span className="truncate">{h}</span>
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="s-lbl mx-2 mb-1.5 mt-1">{t.searchQuickGenres}</div>
          <div className="flex flex-wrap gap-1.5 px-2 pb-1">
            {POPULAR.map((g) => (
              <button
                key={g}
                type="button"
                data-search-suggestion
                onClick={() => commit(g)}
                className="rounded-full border border-[var(--s-line)] bg-white/[0.03] px-3 py-1 text-[12px] font-medium text-muted transition-colors motion-color hover:border-[var(--s-line2)] hover:bg-white/[0.08] hover:text-text"
              >
                {g}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Status() {
  const t = useT();
  const open = useNav((s) => s.open);
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  if (online) return null;
  return (
    <button
      type="button"
      onClick={() => {
        setViewValue(JSON.stringify({ name: "settings" }), "settings:tab", "network");
        open("settings", { name: "settings" });
      }}
      className="s-stat s-glass bad cursor-pointer"
      role="status"
      title={t.secNetwork}
    >
      <i />
      {t.offline}
    </button>
  );
}

/** Studio title bar: the mark, back / forward, centered search, the connection, the inbox bell, the window buttons. */
export default function StudioTitleBar() {
  const t = useT();
  const canBack = useNav((s) => s.stack.length > 0);
  const canForward = useNav((s) => s.ahead.length > 0);
  const back = useNav((s) => s.back);
  const forward = useNav((s) => s.forward);
  const open = useNav((s) => s.open);
  const social = useSocial((s) => !!s.status?.available);
  const unread = useSocial((s) => unreadTotal(s.unread) + (s.friends?.incoming.length ?? 0));
  const setHotkeysOpen = useUi((s) => s.setHotkeysOpen);
  return (
    <header className="s-tb">
      <div className="s-brand">
        <img src={logo} alt="" draggable={false} />
        <span>{t.appName}</span>
      </div>
      <div className="s-hist">
        <button type="button" className="s-ib" onClick={back} disabled={!canBack} aria-label={t.back} title={t.back}>
          <Icon name="back" size={16} />
        </button>
        <button type="button" className="s-ib" onClick={forward} disabled={!canForward} aria-label={t.forward} title={t.forward}>
          <Icon name="forward" size={16} />
        </button>
      </div>
      <SearchBox />
      <div className="ml-auto flex h-full items-center gap-1.5">
        <Status />
        <button type="button" className="s-ib" onClick={() => setHotkeysOpen(true)} aria-label={t.hotkeysTitle} title={`${t.hotkeysTitle} (?)`}>
          <span aria-hidden="true" className="text-[13px] font-semibold">
            ?
          </span>
        </button>
        {social && (
          <button type="button" className="s-ib s-glass !h-[30px] !w-[30px]" onClick={() => open("inbox", { name: "inbox" })} aria-label={t.inbox} title={t.inbox}>
            <Icon name="bell" size={16} />
            {unread > 0 && <span className="dot" />}
          </button>
        )}
        <div className="ml-1 h-full">
          <WindowButtons />
        </div>
      </div>
    </header>
  );
}
