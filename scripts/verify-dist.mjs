// Verifies a packaging result against what the auto-updater consumes — called at the end of `npm run dist` and by
// the release workflow, so a build missing the update metadata can never be treated as a release. Exits 1 (and says
// exactly what is missing) when:
//   Windows: dist/latest.yml is absent, versions don't match package.json, the NSIS installer is not listed there,
//            a listed file is missing or its size differs, or the portable .exe leaked into latest.yml
//            (a portable build can never self-update — it would break every portable user);
//   macOS:   dist/latest-mac.yml with the same rules (zip required — that is what Squirrel.Mac consumes);
//   Linux:   dist/latest-linux.yml listing the AppImage; the .deb is built for the package manager, not for updates.
//   All:     the unpacked app carries the fuses from scripts/fuses.mjs: RunAsNode, EnableNodeOptionsEnvironmentVariable
//            and EnableNodeCliInspectArguments off, EnableEmbeddedAsarIntegrityValidation and OnlyLoadAppFromAsar on.
//            A build that silently lost them (a hook that did not run, an Electron upgrade that moved the fuse wire)
//            fails here instead of shipping. A dist/ with only installers in it has nothing to read and is not a
//            problem (a release check in this repository always has the unpacked app, since it builds it).
//
// Usage: node scripts/verify-dist.mjs [--platform=win32|darwin|linux] [--expect-version=2.3.2] [distdir]
// Importable for tests: import { parseLatestYml, verifyDist } from "./verify-dist.mjs" — the CLI runs only when executed.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** Minimal, honest view of an electron-builder *-yml file (no YAML dependency): version, the files list, sizes. */
export function parseLatestYml(text) {
  const unquote = (s) => s.replace(/^["']|["']$/g, "");
  const version = /^version:\s*([0-9A-Za-z.+-]+)\s*$/m.exec(text)?.[1] ?? null;
  const pathLine = /^path:\s*(\S+)\s*$/m.exec(text)?.[1];
  const path = pathLine ? unquote(pathLine) : null;
  const files = [];
  let cur = null;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    const item = /^\s*-\s*url:\s*(\S+)\s*$/.exec(line);
    if (item) {
      cur = { url: unquote(item[1]), size: null };
      files.push(cur);
      continue;
    }
    const size = /^\s+size:\s*([0-9]+)\s*$/.exec(line);
    if (size && cur) cur.size = Number(size[1]);
  }
  return { version, path, files };
}

const norm = (v) => v.split(".").concat(["0", "0", "0", "0"]).slice(0, 3).join(".");

/**
 * The unpacked app inside a dist/ folder, if electron-builder left one: `dist/mac-arm64/sc player.app` on macOS,
 * `dist/win-unpacked` on Windows, `dist/linux-unpacked` on Linux. Null when only the installers are there (a dist/
 * copied from a release, say) — then there is nothing to read the fuses from and nothing to complain about.
 */
export function unpackedApp(dir, platform) {
  const names = readdirSync(dir);
  const folder = (re) => names.find((n) => re.test(n) && statSync(join(dir, n)).isDirectory());
  if (platform === "darwin") {
    const mac = folder(/^mac(-|$)/);
    const app = mac ? readdirSync(join(dir, mac)).find((n) => n.endsWith(".app")) : null;
    return app ? join(dir, mac, app) : null;
  }
  const unpacked = folder(platform === "win32" ? /^win-unpacked$/ : /^linux-unpacked$/);
  return unpacked ? join(dir, unpacked) : null;
}

/**
 * The executable @electron/fuses reads the wire from: the .app bundle (it finds the framework binary inside itself),
 * the branded .exe, or the Linux executable, whose name comes from build.linux.executableName.
 */
export function fusesTarget(unpacked, platform, productFilename = "sc player") {
  if (platform === "darwin") return unpacked;
  if (platform === "win32") return join(unpacked, `${productFilename}.exe`);
  const files = readdirSync(unpacked, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name);
  return join(unpacked, files.includes("sc-player") ? "sc-player" : files.find((n) => !n.includes(".")) ?? "sc-player");
}

/** The fuses a release must carry, in @electron/fuses' wire numbering; 48 = off, 49 = on, as the wire reports them. */
const REQUIRED_FUSES = { 0: false, 2: false, 3: false, 4: true, 5: true };
const FUSE_NAMES = { 0: "RunAsNode", 2: "EnableNodeOptionsEnvironmentVariable", 3: "EnableNodeCliInspectArguments", 4: "EnableEmbeddedAsarIntegrityValidation", 5: "OnlyLoadAppFromAsar" };

/**
 * Checks a packed app's fuse wire (scripts/fuses.mjs sets it after packing). Returns a list of problems, empty = ok.
 * An unpacked app that is not there is not a problem: the installers are what a release ships.
 */
export async function verifyFuses({ dir, platform, productFilename = "sc player" }) {
  const unpacked = existsSync(dir) ? unpackedApp(dir, platform) : null;
  if (!unpacked) return [];
  const { getCurrentFuseWire } = await import("@electron/fuses");
  let wire;
  try {
    wire = await getCurrentFuseWire(fusesTarget(unpacked, platform, productFilename));
  } catch (e) {
    return [`the packed app in ${unpacked} has no readable fuse wire (${e.message}) — scripts/fuses.mjs did not run`];
  }
  const problems = [];
  for (const [fuse, want] of Object.entries(REQUIRED_FUSES)) {
    const state = wire[Number(fuse)];
    if (state !== (want ? 49 : 48)) problems.push(`fuse ${FUSE_NAMES[fuse]} is ${state === 49 ? "on" : "off"} in ${unpacked} but must be ${want ? "on" : "off"}`);
  }
  return problems;
}

/** The checks. Returns a list of problems (empty = ok). `readYml` matches the shape parseLatestYml produces. */
export function verifyDist({ dir, platform, expectVersion }) {
  const problems = [];
  const want = norm(expectVersion);
  const ymlName = { win32: "latest.yml", darwin: "latest-mac.yml", linux: "latest-linux.yml" }[platform];
  const say = (msg) => problems.push(msg);
  if (!ymlName) return [`unknown platform "${platform}" (expected win32, darwin or linux)`];
  if (!existsSync(dir)) return [`${dir} does not exist — the packaging step did not run (or was cleaned)`];

  const names = readdirSync(dir);
  const pick = (re) => names.filter((n) => re.test(n));

  // ---- the update metadata itself
  const ymlFile = join(dir, ymlName);
  if (!existsSync(ymlFile)) {
    say(`${ymlName} is missing — the update would be invisible to installed apps`);
  } else {
    const yml = parseLatestYml(readFileSync(ymlFile, "utf8"));
    if (!yml.version) say(`${ymlName} has no version line`);
    else if (norm(yml.version) !== want) say(`${ymlName} version ${yml.version} != package.json ${expectVersion}`);
    if (platform === "win32") {
      const listed = yml.files.map((f) => f.url);
      if (!listed.some((u) => /setup.*\.exe$/i.test(u)) && !(yml.path && /setup.*\.exe$/i.test(yml.path)))
        say(`${ymlName} does not list the NSIS installer — the app would "update" to nothing`);
      if (listed.some((u) => /portable/i.test(u))) say(`${ymlName} lists the portable .exe — a portable build cannot replace itself and must never be offered as an update`);
    }
    if (platform === "darwin" && !yml.files.some((f) => /\.zip$/i.test(f.url)) && !(yml.path && /\.zip$/i.test(yml.path)))
      say(`${ymlName} does not list a .zip — that is what Squirrel.Mac downloads`);
    if (platform === "linux" && !yml.files.some((f) => /\.AppImage$/i.test(f.url)) && !(yml.path && /\.AppImage$/i.test(yml.path)))
      say(`${ymlName} does not list the AppImage — the update check would find nothing`);
    // every file the metadata points at must exist, and with the size electron-builder recorded
    for (const f of yml.files) {
      const file = join(dir, f.url);
      if (!existsSync(file)) say(`${ymlName} lists ${f.url} but it is not in ${dir}`);
      else if (f.size !== null) {
        const actual = statSync(file).size;
        if (actual !== f.size) say(`${f.url} size ${actual} != ${ymlName} size ${f.size}`);
      }
    }
  }

  // ---- the installers themselves, per platform
  if (platform === "win32") {
    if (pick(/setup.*\.exe$/i).length === 0) say("no NSIS installer (sc-player-setup-*.exe) in the output");
    if (pick(/portable.*\.exe$/i).length === 0) say("no portable .exe (sc-player-portable-*.exe) in the output");
  } else if (platform === "darwin") {
    if (pick(/\.dmg$/i).length === 0) say("no .dmg in the output");
    if (pick(/\.zip$/i).length === 0) say("no .zip in the output (Squirrel.Mac needs it)");
  } else if (platform === "linux") {
    if (pick(/\.AppImage$/i).length === 0) say("no AppImage in the output");
    if (pick(/\.deb$/i).length === 0) say("no .deb in the output");
  }
  return problems;
}

async function main() {
  const args = process.argv.slice(2);
  const platformArg = args.find((a) => a.startsWith("--platform="))?.split("=")[1];
  const expectArg = args.find((a) => a.startsWith("--expect-version="))?.split("=")[1];
  const dir = args.find((a) => !a.startsWith("--")) ?? "dist";
  const platform = platformArg ?? (process.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "linux");
  const { version } = JSON.parse(readFileSync("package.json", "utf8"));
  const expectVersion = expectArg ?? version;
  const problems = [...verifyDist({ dir, platform, expectVersion }), ...(await verifyFuses({ dir, platform }))];
  if (problems.length) {
    console.error(`verify-dist (${platform}): ${problems.length} problem(s)`);
    for (const p of problems) console.error(`  ✗ ${p}`);
    process.exit(1);
  }
  console.log(`verify-dist (${platform}): ok — ${dir} carries the installers, ${platform === "win32" ? "latest.yml" : platform === "darwin" ? "latest-mac.yml" : "latest-linux.yml"} and the fuses, for v${expectVersion}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // a failed promise must still exit non-zero (a check that crashes before printing must not look like a pass)
  main().catch((e) => {
    console.error(`verify-dist: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  });
}
