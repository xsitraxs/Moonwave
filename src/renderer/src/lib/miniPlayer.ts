import { tr } from "@/i18n";
import { call } from "@/lib/sky";
import { useUi } from "@/state/ui";

let changing = false;
/** Resize first; only switch the renderer if the native window accepted the change. */
export async function setMiniPlayer(enabled: boolean) {
  if (changing || useUi.getState().miniPlayer === enabled) return;
  changing = true;
  try {
    await call("win:mini", enabled);
    useUi.getState().setMiniPlayer(enabled);
  } catch {
    useUi.getState().showToast(tr.miniPlayerFailed);
  } finally {
    changing = false;
  }
}
