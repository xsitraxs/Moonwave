import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef } from "react";
import { useT } from "@/i18n";
import { enterFast, exit } from "@/lib/motion";
import { useUi } from "@/state/ui";
import { useSettings } from "@/state/settings";

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded-[6px] border border-[var(--s-line2)] bg-white/[0.06] px-1.5 font-mono text-[12px] font-medium text-text">
      {children}
    </kbd>
  );
}

/** The shortcut list behind the "?" button in the title bar (and the ? key itself). */
export default function HotkeysModal() {
  const t = useT();
  const open = useUi((s) => s.hotkeysOpen);
  const setOpen = useUi((s) => s.setHotkeysOpen);
  const closeRef = useRef<HTMLButtonElement>(null);
  const globalKeys = useSettings((s) => s.prefs.hotkeys);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        setOpen(false);
      } else if (e.key === "Tab") {
        e.preventDefault();
        closeRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      previous?.focus();
    };
  }, [open, setOpen]);

  const rows: { keys: string[]; label: string }[] = [
    { keys: ["Space"], label: `${t.play} / ${t.pause}` },
    { keys: ["←", "→"], label: t.hkSeek },
    { keys: ["Ctrl", "F"], label: t.hkSearch },
    { keys: ["Ctrl", "K"], label: t.hkSearch },
    { keys: ["Ctrl", "L"], label: t.hkOpenLink },
    { keys: ["?"], label: t.hkHelp },
    { keys: ["Esc"], label: t.hkClose },
  ];

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: enterFast() }}
          exit={{ opacity: 0, transition: exit() }}
          className="fixed inset-0 z-[90] grid place-items-center bg-black/55 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={t.hotkeysTitle}
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: enterFast() }}
            exit={{ opacity: 0, y: 6, scale: 0.98, transition: exit() }}
            className="s-pop s-glass max-h-[90vh] w-[390px] max-w-[92vw] overflow-y-auto p-4"
            onClick={(e) => e.stopPropagation()}
            data-keys-own
          >
            <div className="mb-1 flex items-baseline gap-2">
              <b className="text-[14px] font-semibold text-text">{t.hotkeysTitle}</b>
              <span className="ml-auto text-[12px] text-[var(--s-dim)]">{t.hotkeysHint}</span>
              <button ref={closeRef} type="button" onClick={() => setOpen(false)} aria-label={t.close} className="rounded px-2 py-1 text-text hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]">×</button>
            </div>
            <ul className="mt-2 divide-y divide-[var(--s-line)]">
              {rows.map((r) => (
                <li key={r.keys.join("+")} className="flex items-center gap-3 py-2">
                  <span className="flex w-24 shrink-0 items-center gap-1">
                    {r.keys.map((k) => (
                      <Kbd key={k}>{k}</Kbd>
                    ))}
                  </span>
                  <span className="min-w-0 text-[13px] text-muted">{r.label}</span>
                </li>
              ))}
            </ul>
            <h3 className="mt-4 text-[13px] font-semibold text-text">{t.secHotkeys}</h3>
            <ul className="mt-1 divide-y divide-[var(--s-line)]">
              {[[`${t.play} / ${t.pause}`, globalKeys.playPause], [t.previous, globalKeys.previous], [t.next, globalKeys.next], [t.hkShowWindow, globalKeys.showWindow]].map(([label, shortcut]) => (
                <li key={label} className="flex items-center justify-between gap-2 py-2 text-[12px] text-muted"><span>{label}</span><kbd className="break-all text-right font-mono text-text">{shortcut || "—"}</kbd></li>
              ))}
            </ul>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
