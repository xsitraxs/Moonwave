import { AnimatePresence, motion } from "framer-motion";
import { useT } from "@/i18n";
import { useSettings } from "@/state/settings";

/**
 * The one-time question about the two sharing switches, shown on a new install.
 *
 * Both start off: nothing goes to sc player's server until the person says so. The card offers the two things that
 * would send something — the running-app count and the shared "Listening on sc player" — as one yes, and says plainly
 * what each does; "Not now" keeps them off and the question never comes back (Settings → Messenger keeps both at any
 * time). It is recorded on the same page that sets the switches, so a crash before the answer shows it again.
 */
export default function SharingPrompt() {
  const t = useT();
  const asked = useSettings((s) => s.prefs.telemetryAsked);

  const answer = (yes: boolean) => {
    // one write for both switches and the "asked" mark: a crash can never leave the mark set without the choice it
    // records, and the person is never shown the question twice
    const prefs = { ...useSettings.getState().prefs, countMe: yes, shareListening: yes, telemetryAsked: true };
    useSettings.getState().save({ prefs });
  };

  return (
    <AnimatePresence>
      {!asked && (
        <motion.div
          className="fixed inset-0 z-[85] grid place-items-center bg-black/60 p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.12 } }}
          role="dialog"
          aria-modal="true"
          aria-label={t.sharingAskTitle}
        >
          <motion.div
            initial={{ y: 8, scale: 0.98 }}
            animate={{ y: 0, scale: 1 }}
            className="s-pop w-[30rem] max-w-[92vw] rounded-[var(--r,10px)] p-6 shadow-[0_18px_50px_rgba(0,0,0,0.55)]"
          >
            <h2 className="text-lg font-semibold text-text">{t.sharingAskTitle}</h2>
            <p className="mt-2 text-[14px] leading-relaxed text-text/85">{t.sharingAskLead}</p>
            <ul className="mt-3 space-y-2 text-[13px] leading-relaxed text-muted">
              <li>{t.sharingAskCount}</li>
              <li>{t.sharingAskListening}</li>
            </ul>
            <p className="mt-3 text-[13px] leading-relaxed text-muted">{t.sharingAskChange}</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => answer(false)} className="rounded-md px-4 py-2 text-sm text-muted hover:text-text">
                {t.sharingAskNo}
              </button>
              <button type="button" onClick={() => answer(true)} className="marker-fill sketch sketch-thin rounded-md px-4 py-2 text-sm font-semibold">
                {t.sharingAskYes}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
