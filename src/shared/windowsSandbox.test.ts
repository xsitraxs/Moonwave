import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isStatusBreakpoint,
  mergeDisabledFeatures,
  nextAudioCrashFallback,
  nextGpuSandboxOffOnCrash,
  shouldDisableAudioSandbox,
  shouldDisableGpuSandbox,
  shouldRunAudioInProcess,
  windowsBuild,
} from "./windowsSandbox.ts";

describe("windowsSandbox", () => {
  it("parses the Windows build number from os.release()", () => {
    assert.equal(windowsBuild("10.0.26300"), 26300);
    assert.equal(windowsBuild("10.0.26200.9457"), 26200);
    assert.equal(windowsBuild("10.0.19045"), 19045);
    assert.equal(windowsBuild("6.8.0-49-generic"), 0);
    assert.equal(windowsBuild(""), 0);
  });

  it("recognises signed and unsigned 0x80000003 STATUS_BREAKPOINT exit codes", () => {
    assert.equal(isStatusBreakpoint(-2147483645), true);
    assert.equal(isStatusBreakpoint(0x80000003), true);
    assert.equal(isStatusBreakpoint(0), false);
    assert.equal(isStatusBreakpoint(1), false);
    assert.equal(isStatusBreakpoint(-1073741819), false);
  });

  it("disables AudioServiceSandbox only on Windows >= 26200 or after a recorded crash", () => {
    assert.equal(shouldDisableAudioSandbox({ platform: "win32", osRelease: "10.0.26300" }), true);
    assert.equal(shouldDisableAudioSandbox({ platform: "win32", osRelease: "10.0.26200" }), true);
    assert.equal(shouldDisableAudioSandbox({ platform: "win32", osRelease: "10.0.22631" }), false);
    assert.equal(shouldDisableAudioSandbox({ platform: "win32", osRelease: "10.0.19045", crashedBefore: true }), true);
    assert.equal(shouldDisableAudioSandbox({ platform: "darwin", osRelease: "24.6.0", crashedBefore: true }), false);
    assert.equal(shouldDisableAudioSandbox({ platform: "linux", osRelease: "6.8.0-49-generic", crashedBefore: true }), false);
  });

  it("keeps GPU sandbox on by default, enables fallback after STATUS_BREAKPOINT, and reverts if driver still crashes", () => {
    assert.equal(shouldDisableGpuSandbox({ platform: "win32", memorySaver: false, crashedBefore: false }), false);
    assert.equal(shouldDisableGpuSandbox({ platform: "win32", memorySaver: false, crashedBefore: true }), true);
    assert.equal(shouldDisableGpuSandbox({ platform: "win32", memorySaver: true, crashedBefore: true }), false);
    assert.equal(shouldDisableGpuSandbox({ platform: "linux", memorySaver: false, crashedBefore: true }), false);

    // first sandboxed GPU STATUS_BREAKPOINT records fallback for next start
    assert.equal(
      nextGpuSandboxOffOnCrash({
        platform: "win32",
        processType: "GPU",
        reason: "crashed",
        exitCode: -2147483645,
        gpuSandboxDisabledThisRun: false,
        currentSaved: false,
      }),
      true,
    );
    // already saved: no redundant disk flush
    assert.equal(
      nextGpuSandboxOffOnCrash({
        platform: "win32",
        processType: "GPU",
        reason: "crashed",
        exitCode: -2147483645,
        gpuSandboxDisabledThisRun: false,
        currentSaved: true,
      }),
      null,
    );
    // crashed even with --disable-gpu-sandbox active: not a sandbox fault, restore sandbox
    assert.equal(
      nextGpuSandboxOffOnCrash({
        platform: "win32",
        processType: "GPU",
        reason: "crashed",
        exitCode: -2147483645,
        gpuSandboxDisabledThisRun: true,
        currentSaved: true,
      }),
      false,
    );
    // clean exit or other process types never flip GPU sandbox
    assert.equal(
      nextGpuSandboxOffOnCrash({
        platform: "win32",
        processType: "GPU",
        reason: "clean-exit",
        exitCode: 0,
        gpuSandboxDisabledThisRun: false,
        currentSaved: false,
      }),
      null,
    );
  });

  it("merges --disable-features values without clobbering or duplicating existing flags", () => {
    assert.equal(mergeDisabledFeatures("", ["AudioServiceSandbox"]), "AudioServiceSandbox");
    assert.equal(
      mergeDisabledFeatures("HardwareMediaKeyHandling, Foo", ["AudioServiceSandbox", "Foo"]),
      "HardwareMediaKeyHandling,Foo,AudioServiceSandbox",
    );
  });

  it("runs AudioService in-process only on Windows after it crashed with AudioServiceSandbox already off", () => {
    assert.equal(shouldRunAudioInProcess({ platform: "win32" }), false);
    assert.equal(shouldRunAudioInProcess({ platform: "win32", crashedWithSandboxOff: false }), false);
    assert.equal(shouldRunAudioInProcess({ platform: "win32", crashedWithSandboxOff: true }), true);
    assert.equal(shouldRunAudioInProcess({ platform: "linux", crashedWithSandboxOff: true }), false);
    assert.equal(shouldRunAudioInProcess({ platform: "darwin", crashedWithSandboxOff: true }), false);
  });

  it("distinguishes missing portable runtime files, sandbox crashes, and post-sandbox AudioService crashes", () => {
    const base = {
      platform: "win32",
      isAudioUtility: true,
      reason: "crashed",
      exitCode: -2147483645,
      runtimeIntact: true,
      audioSandboxDisabledThisRun: false,
      audioInProcessThisRun: false,
      savedSandboxOff: false,
      savedInProcess: false,
    };

    // portable temp folder wiped while running (icudtl.dat gone): report missing-runtime without flipping settings
    assert.equal(nextAudioCrashFallback({ ...base, runtimeIntact: false }), "missing-runtime");
    assert.equal(nextAudioCrashFallback({ ...base, runtimeIntact: false, audioSandboxDisabledThisRun: true }), "missing-runtime");

    // Windows < 26200: first STATUS_BREAKPOINT disables AudioServiceSandbox; subsequent ones in same run are no-ops
    assert.equal(nextAudioCrashFallback(base), "disable-sandbox");
    assert.equal(nextAudioCrashFallback({ ...base, savedSandboxOff: true }), "none");

    // Windows >= 26200 (or second start): AudioServiceSandbox was already off, icudtl.dat intact -> run in-process next start
    assert.equal(nextAudioCrashFallback({ ...base, audioSandboxDisabledThisRun: true }), "run-in-process");
    assert.equal(nextAudioCrashFallback({ ...base, audioSandboxDisabledThisRun: true, savedInProcess: true }), "none");
    assert.equal(nextAudioCrashFallback({ ...base, audioSandboxDisabledThisRun: true, audioInProcessThisRun: true }), "none");

    // non-breakpoint exits, clean exits, non-audio helpers, or non-Windows platforms do nothing
    assert.equal(nextAudioCrashFallback({ ...base, exitCode: -1073741819 }), "none");
    assert.equal(nextAudioCrashFallback({ ...base, reason: "clean-exit", exitCode: 0 }), "none");
    assert.equal(nextAudioCrashFallback({ ...base, isAudioUtility: false }), "none");
    assert.equal(nextAudioCrashFallback({ ...base, platform: "linux" }), "none");
  });
});
