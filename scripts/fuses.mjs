// Electron's fuses are switches inside the Electron binary that take features away from whatever starts this
// executable: with them set, the .exe/.app can no longer be turned into a Node.js interpreter, a debuggee, or a loader
// of code that is not the app's own app.asar. electron-builder packs the app, then runs this hook, then signs (macOS)
// and builds the installers — the fuses are flipped in the window between packing and signing, which is exactly where
// they belong: the ad-hoc macOS signature ("identity": "-") is made afterwards, over the changed bytes.
//
// What is set, and why RunAsNode can be off here:
//   RunAsNode = false                  — ELECTRON_RUN_AS_NODE no longer turns the app into a plain Node. Nothing in the
//                                        app relies on it: the lyrics-sync worker is an Electron utilityProcess
//                                        (src/main/lyrics-sync/index.ts), a child of the app's own runtime that does not
//                                        go through this fuse. Only process.fork-style spawning of the Electron binary
//                                        as Node would need it, and nothing does that.
//   EnableNodeOptionsEnvironmentVariable = false — NODE_OPTIONS/NODE_EXTRA_CA_CERTS in the environment cannot inject
//                                        code into the main process.
//   EnableNodeCliInspectArguments = false        — --inspect and SIGUSR1 cannot open a debugger on the main process.
//   EnableEmbeddedAsarIntegrityValidation = true — the app.asar header hash is checked when it is loaded. The expected
//                                        hash is written by electron-builder, which computes it from the same header it
//                                        packed (the macOS plist and the Windows INTEGRITY resource) — so the order
//                                        here matters: this hook must not touch app.asar itself; it does not.
//   OnlyLoadAppFromAsar = true         — only app.asar is loaded: no plain "app" folder next to it, no default_app.asar.
//                                        The app.asar.unpacked part (onnxruntime-node's binaries, package.json's
//                                        asarUnpack) is still read from inside the loaded app.asar, so unpacked native
//                                        modules keep working — they are opened by path derived from the asar, not by
//                                        Electron's app-location search.
//
// The hook verifies its own work by reading the fuse wire back out of the binary and failing the build when it does not
// match; verify-dist.mjs repeats the check on a finished dist/, so a release cannot ship with a fuse still open.
import { flipFuses, FuseV1Options, FuseVersion, getCurrentFuseWire } from "@electron/fuses";
import { join } from "node:path";

/** The fuses this build sets. verify-dist.mjs checks the same list in a packed binary. */
export const FUSES = {
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
};

/** What @electron/fuses reads from a wire: '0' (48) off, '1' (49) on. */
const ON = 49;

/**
 * The Electron executable a packed app carries, given electron-builder's layout: an .app bundle on macOS, the branded
 * .exe on Windows, and the executable name (linux.executableName) on Linux. @electron/fuses itself resolves the
 * framework binary inside a macOS .app, so the .app path is what it wants there.
 */
export function electronBinaryIn(appOutDir, { productFilename, executableName, platform }) {
  if (platform === "darwin") return join(appOutDir, `${productFilename}.app`);
  if (platform === "win32") return join(appOutDir, `${productFilename}.exe`);
  return join(appOutDir, executableName);
}

/** True when every fuse in `want` has exactly that state in `wire` (as @electron/fuses reads it). */
export function fuseWireMatches(wire, want) {
  return Object.entries(want).every(([fuse, enabled]) => wire[Number(fuse)] === (enabled ? ON : 48));
}

/**
 * electron-builder's afterPack hook: sets the fuses on the freshly packed app and proves they took. A build whose
 * fuses did not take fails here, not silently at the user's machine.
 */
export default async function setElectronFuses(context) {
  const { appOutDir, packager } = context;
  const platform = context.electronPlatformName || packager.platform?.name || process.platform;
  const binary = electronBinaryIn(appOutDir, {
    productFilename: packager.appInfo.productFilename,
    // Linux takes the executable name from build.linux.executableName ("sc-player"); electron-builder's default is the
    // lowercased product name
    executableName: packager.platformSpecificBuildOptions?.executableName || packager.appInfo.productFilename.toLowerCase().replace(/\s+/g, "-"),
    platform,
  });
  const wireCount = await flipFuses(binary, {
    version: FuseVersion.V1,
    ...FUSES,
    // macOS: the signature covers the binary's bytes, so the ad-hoc one is made again right here, before
    // electron-builder's own signing step runs over the app
    resetAdHocDarwinSignature: platform === "darwin",
  });
  const wire = await getCurrentFuseWire(binary);
  if (!fuseWireMatches(wire, FUSES)) {
    throw new Error(`fuses: ${binary} does not carry the expected fuse wire after flipping (${JSON.stringify(wire)})`);
  }
  // a universal (arm64 + x64) macOS build has two Electron binaries inside one file and therefore two fuse wires
  console.log(`fuses: ${platform}, ${wireCount} wire(s) in ${binary} — set and verified`);
}
