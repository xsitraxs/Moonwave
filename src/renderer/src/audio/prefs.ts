import { useSettings } from "@/state/settings";
import { call, on } from "@/lib/sky";
import * as engine from "./engine";

/**
 * Keeps the engine in step with the Settings screen: crossfade, the equalizer, the output device. The memory saver is
 * not here: it takes effect at start-up, so what matters to the engine is what this run actually started with, which
 * comes from main (see below) rather than from the setting a change would apply only after a restart.
 */
export function initAudioPrefs() {
  let last = "";
  const apply = () => {
    const { crossfade, eq, outputDevice } = useSettings.getState().prefs;
    const key = JSON.stringify([crossfade, eq, outputDevice]);
    if (key === last) return;
    last = key;
    engine.setCrossfade(crossfade);
    engine.setEq(eq);
    void engine.setOutput(outputDevice);
  };
  apply();
  useSettings.subscribe(apply);
  // How this run's graphics stack came up decides whether a deck may be handed to Web Audio at all: without hardware
  // rendering Chromium routes none of an element's media, and a routed element is silent. Main is the only one that
  // can ask Chromium, so the engine waits for its answer instead of guessing from the setting.
  void call("app:info")
    .then((info) => {
      engine.setMemorySaver(info.memorySaver);
      engine.setGraphicsStatus(info.graphics);
    })
    .catch(() => undefined);
  // the GPU process died since the start (or Chromium fell back to software on its own): re-decide whether routing
  // is safe instead of handing the sound to a chain that can no longer carry it
  on("graphics:status", (graphics) => engine.setGraphicsStatus(graphics));
}
