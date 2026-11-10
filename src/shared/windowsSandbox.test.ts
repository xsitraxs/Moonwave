import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isStatusBreakpoint,
  mergeDisabledFeatures,
  nextGpuSandboxOffOnCrash,
  shouldDisableAudioSandbox,
  shouldDisableGpuSandbox,
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
});
