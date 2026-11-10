/**
 * Windows child-process sandbox workarounds for Chromium's STATUS_BREAKPOINT (0x80000003 / -2147483645) crashes on
 * Windows 11 builds 26200+ (Chromium #577213782, electron#51761, electron#54614), where AppContainer / restricted
 * child tokens fail early initialization when %LOCALAPPDATA% carries third-party sandbox SIDs or OEM audio APOs.
 *
 * The renderer sandbox (`sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`) is never weakened here:
 * untrusted streams and pages stay inside the sandboxed renderer.
 */

/** Windows 11 24H2/25H2/26H2 build threshold where Chromium #577213782 / electron#51761 reproduce. */
export const WINDOWS_SANDBOX_BUG_BUILD = 26200;

/** Windows NTSTATUS 0x80000003 (STATUS_BREAKPOINT), reported by Electron as signed int32 -2147483645. */
export const STATUS_BREAKPOINT_UINT32 = 0x80000003;

/**
 * Extracts the Windows build number from `os.release()` (e.g. `"10.0.26300"` → `26300`), or `0` if unrecognised.
 */
export function windowsBuild(osRelease: string): number {
  const parts = osRelease.trim().split(".");
  if (parts.length < 3) return 0;
  const n = Number.parseInt(parts[2] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * True when an Electron child-process `exitCode` is Windows `0x80000003 STATUS_BREAKPOINT` (`-2147483645`).
 */
export function isStatusBreakpoint(exitCode: number): boolean {
  return typeof exitCode === "number" && Number.isFinite(exitCode) && (exitCode >>> 0) === STATUS_BREAKPOINT_UINT32;
}

/**
 * Whether Chromium's `AudioServiceSandbox` feature should be disabled for this launch.
 *
 * `AudioService` still runs out-of-process (`AudioServiceOutOfProcess` stays enabled) and only hands already-decoded
 * PCM samples from the mixer to Windows WASAPI; media demuxing and decoding remain inside the sandboxed renderer.
 * Disabled proactively on Windows builds >= 26200 so playback works on the first click, and on older Windows builds
 * once `AudioService` has crashed with `STATUS_BREAKPOINT`.
 */
export function shouldDisableAudioSandbox(input: {
  platform: string;
  osRelease: string;
  crashedBefore?: boolean;
}): boolean {
  if (input.platform !== "win32") return false;
  if (input.crashedBefore === true) return true;
  return windowsBuild(input.osRelease) >= WINDOWS_SANDBOX_BUG_BUILD;
}

/**
 * Next persisted `winGpuSandboxOff` flag after a Windows `GPU` child-process exit, or `null` when nothing changes.
 *
 * - GPU sandbox stays ON by default for everyone.
 * - If the sandboxed GPU process dies with `STATUS_BREAKPOINT`, `true` is persisted so the next launch passes
 *   `--disable-gpu-sandbox` on this machine (restoring hardware compositing, WebGL, equalizer and reactive sky).
 * - If `--disable-gpu-sandbox` was already active on this launch and the GPU process still dies with
 *   `STATUS_BREAKPOINT`, the fault is in the driver rather than the sandbox, so `false` restores the sandbox.
 */
export function nextGpuSandboxOffOnCrash(input: {
  platform: string;
  processType: string;
  reason: string;
  exitCode: number;
  gpuSandboxDisabledThisRun: boolean;
  currentSaved: boolean;
}): boolean | null {
  if (input.platform !== "win32") return null;
  if (input.processType !== "GPU") return null;
  if (input.reason === "clean-exit") return null;
  if (!isStatusBreakpoint(input.exitCode)) return null;
  const want = !input.gpuSandboxDisabledThisRun;
  return want === input.currentSaved ? null : want;
}

/**
 * Whether `--disable-gpu-sandbox` should be passed on this launch.
 */
export function shouldDisableGpuSandbox(input: {
  platform: string;
  memorySaver: boolean;
  crashedBefore?: boolean;
}): boolean {
  if (input.platform !== "win32" || input.memorySaver) return false;
  return input.crashedBefore === true;
}

/**
 * Appends feature names to an existing comma-separated `--disable-features` value without losing or duplicating flags.
 */
export function mergeDisabledFeatures(existing: string, additions: readonly string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [...existing.split(","), ...additions]) {
    const item = raw.trim();
    if (!item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out.join(",");
}
