import { useSettings } from "@/state/settings";
import { usePlayer } from "@/state/player";
import { on } from "@/lib/sky";
import * as engine from "./engine";

/**
 * Keeps the sound healthy from the page's side.
 *
 * Chromium restarts a crashed media helper on its own, but nothing in the page learns that the decoders and the
 * AudioContext went with it: the <audio> element goes on reporting "playing" over silence. Main watches the helpers and
 * tells the page; here that turns into a bounded rebuild of the tract (see engine.recoverSound), and into a plain
 * "the sound stopped" with Retry when rebuilding doesn't help.
 *
 * A device service that keeps dying points at the output chosen in Settings rather than at the stream, so after a
 * second death the app falls back to the system default and says so in the log — silence is worse than a device reset.
 */
export function initAudioRecovery() {
  /**
   * The helpers can die in a loop. The watchdog watches for that too: once the recovery budget for the last minute is
   * spent, the player is told the sound is broken instead of every event buying another stream reload. Retry in the
   * player is the person's own decision and resets the budget.
   */
  setInterval(() => {
    const { spent, max } = engine.recoveryBudget();
    if (spent < max) return;
    if (usePlayer.getState().status !== "playing") return;
    usePlayer.setState({ status: "error", error: "audio" });
  }, 10_000);

  on("audio:crashed", (e) => {
    const chosen = useSettings.getState().prefs.outputDevice;
    const what = e.role === "audio" ? "the audio service" : "the video capture helper";
    const why = `${what} died (${e.reason}, exit ${e.exitCode}), ${e.count}× this session`;

    // the device service only matters while a device is chosen: with the system default there is nothing it decides
    if (e.role === "capture" && !chosen) return;

    if (e.role === "capture" && e.count >= 2 && chosen) {
      // rebuilds won't fix a device that keeps taking the helper down: play on the system default instead
      useSettings.getState().setPref("outputDevice", "");
      return;
    }
    void engine.recoverSound(why);
  });

  // the report and the log get the engine's account whenever the answer can have changed
  usePlayer.subscribe((s, prev) => s.status !== prev.status && engine.reportHealth());
  useSettings.subscribe((s, prev) => {
    const a = prev.prefs;
    const b = s.prefs;
    if (a.outputDevice !== b.outputDevice || a.eq !== b.eq || a.memorySaver !== b.memorySaver) engine.reportHealth();
  });
  engine.reportHealth();
}
