import { useSettings } from "@/state/settings";
import * as engine from "./engine";

/**
 * Keeps the engine in step with the Settings screen: crossfade, equalizer, output device, and the memory saver (which
 * turns hardware acceleration off and with it the ability to route an element through Web Audio).
 */
export function initAudioPrefs() {
  let last = "";
  const apply = () => {
    const { crossfade, eq, outputDevice, memorySaver } = useSettings.getState().prefs;
    const key = JSON.stringify([crossfade, eq, outputDevice, memorySaver]);
    if (key === last) return;
    last = key;
    engine.setCrossfade(crossfade);
    engine.setMemorySaver(memorySaver);
    engine.setEq(eq);
    void engine.setOutput(outputDevice);
  };
  apply();
  useSettings.subscribe(apply);
}
