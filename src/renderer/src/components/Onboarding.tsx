import { useEffect, useRef, useState } from "react";
import { useT } from "@/i18n";
import { useNav } from "@/state/nav";
import { useSettings } from "@/state/settings";

/** A skippable first-run introduction; existing installations are migrated as completed. */
export default function Onboarding() {
  const t = useT();
  const done = useSettings((s) => s.prefs.onboardingDone);
  const look = useSettings((s) => s.prefs.look);
  const setPref = useSettings((s) => s.setPref);
  const go = useNav((s) => s.go);
  const [step, setStep] = useState(0);
  const [suspended, setSuspended] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (done || suspended) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const handle = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        useSettings.getState().setPref("onboardingDone", true);
      } else if (event.key === "Tab") {
        const buttons = Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
        if (!buttons.length) return;
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (index < 0 || (event.shiftKey && index === 0) || (!event.shiftKey && index === buttons.length - 1)) {
          event.preventDefault();
          (event.shiftKey ? buttons[buttons.length - 1] : buttons[0])?.focus();
        }
      }
    };
    window.addEventListener("keydown", handle, true);
    return () => { window.removeEventListener("keydown", handle, true); previous?.focus(); };
  }, [done, suspended]);

  if (done) return null;
  if (suspended) return <button type="button" onClick={() => setSuspended(false)} className="fixed bottom-28 right-6 z-[80] rounded-md border border-[var(--s-line2)] bg-[var(--bg-2)] px-4 py-3 text-sm font-semibold text-text shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]">{t.onboardResume}</button>;
  const titles = [t.onboardStep1Title, t.onboardStep2Title, t.onboardStep3Title];
  const descriptions = [t.onboardStep1Text, t.onboardStep2Text, t.onboardStep3Text];
  const finish = () => setPref("onboardingDone", true);
  const open = () => {
    setSuspended(true);
    go(step === 0 ? { name: "signin" } : { name: "import" });
  };
  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-black/60 p-6">
      <div ref={dialog} data-onboarding-dialog role="dialog" aria-modal="true" aria-labelledby="onboarding-title" data-keys-own className="s-pop w-[30rem] max-w-[92vw] p-6">
        <h1 id="onboarding-title" className="text-xl font-semibold text-text">{t.onboardTitle}</h1>
        <p className="mt-4 text-sm tabular-nums text-muted">{step + 1} / 3</p>
        <h2 className="mt-2 text-base font-semibold text-text">{titles[step]}</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">{descriptions[step]}</p>
        {step < 2 ? (
          <button type="button" onClick={open} className="mt-4 rounded-md border border-[var(--s-line2)] px-4 py-2 text-sm text-text hover:bg-white/10">{t.onboardGo}</button>
        ) : (
          <button type="button" role="switch" aria-checked={look.neutralBg} onClick={() => setPref("look", { ...useSettings.getState().prefs.look, neutralBg: !look.neutralBg })} className="mt-4 flex w-full items-center justify-between gap-3 rounded-md border border-[var(--s-line2)] p-3 text-left text-sm text-text hover:bg-white/10">
            <span>{t.neutralBg}</span><span className={`s-sw ${look.neutralBg ? "on" : ""}`} aria-hidden="true" />
          </button>
        )}
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <button type="button" onClick={finish} className="mr-auto rounded-md px-3 py-2 text-sm text-muted hover:text-text">{t.onboardSkip}</button>
          {step > 0 && <button type="button" onClick={() => setStep(step - 1)} className="rounded-md px-3 py-2 text-sm text-muted hover:text-text">{t.onboardBack}</button>}
          <button type="button" onClick={() => step === 2 ? finish() : setStep(step + 1)} className="marker-fill sketch sketch-thin rounded-md px-4 py-2 text-sm font-semibold">{step === 2 ? t.onboardDone : t.onboardNext}</button>
        </div>
      </div>
    </div>
  );
}
