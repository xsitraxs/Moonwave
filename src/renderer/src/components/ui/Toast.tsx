import { AnimatePresence, motion } from "framer-motion";
import { enter, exit } from "@/lib/motion";
import { useUi } from "@/state/ui";

/** A short typewriter message above the player ("Link copied"), gone after a couple of seconds. */
export default function Toast() {
  const toast = useUi((s) => s.toast);
  const dismiss = useUi((s) => s.dismissToast);
  return (
    <div aria-live="polite" className="pointer-events-none absolute inset-x-0 bottom-4 z-50 flex justify-center">
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 4, rotate: 0 }}
            animate={{ opacity: 1, y: 0, rotate: -1, transition: enter() }}
            exit={{ opacity: 0, y: 4, transition: exit() }}
            style={{ pointerEvents: toast.action ? "auto" : "none" }}
            className="toast-notice paper-fill sketch sketch-thin flex items-center gap-2 rounded-md px-4 py-2 font-type text-sm text-text shadow-[3px_5px_0_rgba(0,0,0,0.45)]"
          >
            <span className="text-glow">✦</span>
            <span>{toast.text}</span>
            {toast.action && (
              <button
                type="button"
                onClick={() => {
                  const run = toast.action?.onClick;
                  dismiss();
                  run?.();
                }}
                className="ml-1 rounded bg-white/10 px-2 py-0.5 text-xs font-semibold text-[var(--accent)] transition-colors hover:bg-white/20"
              >
                {toast.action.label}
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
