// Verifies a packaging result against what the auto-updater and Electron's runtime checks consume — called at the end
// of `npm run dist` and by the release workflow, so a broken build can never be treated as a release. Exits 1 (and
// says exactly what is missing) when:
//   Windows: dist/latest.yml is absent, versions don't match package.json, the NSIS installer or its .blockmap is
//            missing, a listed file is missing or its size differs, or the portable .exe leaked into latest.yml
//            (a portable build can never self-update — it would break every portable user);
//   macOS:   dist/latest-mac.yml with the same rules (zip + its .blockmap required — that is what Squirrel.Mac and
//            electron-updater's differential downloader consume);
//   Linux:   dist/latest-linux.yml listing the AppImage (whose embedded blockMapSize, when recorded, must fit inside
//            the file); the .deb is built for the package manager, not for updates.
//   All:     every unpacked app carries the fuses from scripts/fuses.mjs (RunAsNode, EnableNodeOptionsEnvironmentVariable
//            and EnableNodeCliInspectArguments off, EnableEmbeddedAsarIntegrityValidation and OnlyLoadAppFromAsar on),
//            a readable app.asar with SHA256 file integrity in its header, the matching header SHA256 recorded in
//            macOS Info.plist (ElectronAsarIntegrity) or Windows PE resources (INTEGRITY/ELECTRONASAR), and — when
//            checked on macOS — a valid `codesign --verify --deep --strict` signature over the modified bundle.
//
// Usage: node scripts/verify-dist.mjs [--platform=win32|darwin|linux] [--expect-version=2.3.2] [distdir]
// Importable for tests: import { parseLatestYml, verifyDist, verifyFuses } from "./verify-dist.mjs".
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

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
      cur = { url: unquote(item[1]), size: null, blockMapSize: null };
      files.push(cur);
      continue;
    }
    const size = /^\s+size:\s*([0-9]+)\s*$/.exec(line);
    if (size && cur) cur.size = Number(size[1]);
    const bmSize = /^\s+blockMapSize:\s*([0-9]+)\s*$/.exec(line);
    if (bmSize && cur) cur.blockMapSize = Number(bmSize[1]);
  }
  return { version, path, files };
}

const norm = (v) => v.split(".").concat(["0", "0", "0", "0"]).slice(0, 3).join(".");

/**
 * Every unpacked app inside a dist/ folder: both `dist/mac/sc player.app` (x64) and `dist/mac-arm64/sc player.app` on
 * macOS, `dist/win-unpacked` on Windows, `dist/linux-unpacked` on Linux. Empty when only the installers are there.
 */
export function unpackedApps(dir, platform) {
  if (!existsSync(dir)) return [];
  const names = readdirSync(dir).sort();
  const isDir = (n) => statSync(join(dir, n)).isDirectory();
  if (platform === "darwin") {
    const apps = [];
    for (const mac of names.filter((n) => /^mac(-|$)/.test(n) && isDir(n))) {
      const app = readdirSync(join(dir, mac)).find((n) => n.endsWith(".app"));
      if (app) apps.push(join(dir, mac, app));
    }
    return apps;
  }
  const want = platform === "win32" ? /^win-unpacked$/ : /^linux-unpacked$/;
  const unpacked = names.find((n) => want.test(n) && isDir(n));
  return unpacked ? [join(dir, unpacked)] : [];
}

/** First unpacked app in `dir` (kept for single-folder callers and tests), or null when none is present. */
export function unpackedApp(dir, platform) {
  return unpackedApps(dir, platform)[0] ?? null;
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

/** Reads the raw JSON header string out of an ASAR archive's Chromium pickle framing. */
function readRawAsarHeader(asarPath) {
  const fd = openSync(asarPath, "r");
  try {
    const prefix = Buffer.alloc(16);
    if (readSync(fd, prefix, 0, 16, 0) !== 16) throw new Error("truncated pickle prefix");
    const strLen = prefix.readUInt32LE(12);
    const total = statSync(asarPath).size;
    if (strLen === 0 || 16 + strLen > total) throw new Error(`invalid header length ${strLen}`);
    const body = Buffer.alloc(strLen);
    if (readSync(fd, body, 0, strLen, 16) !== strLen) throw new Error("truncated header JSON");
    return body.toString("utf8");
  } finally {
    closeSync(fd);
  }
}

/** Counts packed files in an ASAR header tree and returns any that lack a SHA256 integrity entry. */
function checkAsarTreeIntegrity(node, prefix = "") {
  let packedCount = 0;
  const missing = [];
  for (const [name, child] of Object.entries(node?.files ?? {})) {
    const rel = prefix ? `${prefix}/${name}` : name;
    if (child && typeof child === "object" && child.files) {
      const sub = checkAsarTreeIntegrity(child, rel);
      packedCount += sub.packedCount;
      missing.push(...sub.missing);
    } else if (child && typeof child === "object" && !child.unpacked && !child.link) {
      packedCount++;
      const ok = child.integrity?.algorithm === "SHA256" && /^[0-9a-f]{64}$/i.test(child.integrity?.hash ?? "");
      if (!ok) missing.push(rel);
    }
  }
  return { packedCount, missing };
}

/**
 * Verifies that `app.asar` exists, carries per-file SHA256 integrity inside its header, and matches the header SHA256
 * embedded in the platform binary (`ElectronAsarIntegrity` in macOS Info.plist, `INTEGRITY`/`ELECTRONASAR` PE resource
 * on Windows) — without which `EnableEmbeddedAsarIntegrityValidation` terminates the app on start.
 */
function verifyAsarAndSignature({ unpacked, platform, productFilename, checkCodesign }) {
  const problems = [];
  const asarPath = platform === "darwin" ? join(unpacked, "Contents", "Resources", "app.asar") : join(unpacked, "resources", "app.asar");
  if (!existsSync(asarPath)) {
    problems.push(`app.asar is missing in ${unpacked} — OnlyLoadAppFromAsar is on, so the app cannot start`);
    return problems;
  }
  let headerString;
  let tree;
  try {
    headerString = readRawAsarHeader(asarPath);
    tree = JSON.parse(headerString);
  } catch (e) {
    problems.push(`app.asar in ${unpacked} has an unreadable header (${e instanceof Error ? e.message : e})`);
    return problems;
  }
  const { packedCount, missing } = checkAsarTreeIntegrity(tree);
  if (packedCount === 0) problems.push(`app.asar in ${unpacked} contains no packed files`);
  else if (missing.length > 0) problems.push(`app.asar in ${unpacked} has ${missing.length} file(s) without SHA256 integrity (first: ${missing[0]})`);

  const expectedHash = createHash("sha256").update(headerString).digest("hex");

  if (platform === "darwin") {
    const plistPath = join(unpacked, "Contents", "Info.plist");
    if (!existsSync(plistPath)) {
      problems.push(`${unpacked} is missing Contents/Info.plist (ElectronAsarIntegrity cannot be checked)`);
    } else {
      try {
        const plist = require("plist");
        const parsed = plist.parse(readFileSync(plistPath, "utf8"));
        const entry = parsed?.ElectronAsarIntegrity?.["Resources/app.asar"];
        if (!entry || entry.algorithm !== "SHA256" || typeof entry.hash !== "string") {
          problems.push(`${unpacked} Info.plist has no SHA256 ElectronAsarIntegrity entry for Resources/app.asar`);
        } else if (entry.hash.toLowerCase() !== expectedHash) {
          problems.push(`${unpacked} Info.plist ElectronAsarIntegrity hash ${entry.hash} != app.asar header hash ${expectedHash}`);
        }
      } catch (e) {
        problems.push(`${unpacked} Info.plist could not be parsed (${e instanceof Error ? e.message : e})`);
      }
    }
    if (checkCodesign) {
      const r = spawnSync("codesign", ["--verify", "--deep", "--strict", unpacked], { encoding: "utf8" });
      if (r.status !== 0) {
        problems.push(`codesign --verify failed for ${unpacked}: ${(r.stderr || r.stdout || `exit ${r.status}`).trim()}`);
      }
    }
  } else if (platform === "win32") {
    const exePath = fusesTarget(unpacked, "win32", productFilename);
    try {
      const resedit = require("resedit");
      const exe = resedit.NtExecutable.from(readFileSync(exePath));
      const res = resedit.NtExecutableResource.from(exe);
      const entry = res.entries.find((e) => String(e.type).toUpperCase() === "INTEGRITY" && String(e.id).toUpperCase() === "ELECTRONASAR");
      if (!entry) {
        problems.push(`${exePath} has no INTEGRITY/ELECTRONASAR PE resource — EnableEmbeddedAsarIntegrityValidation will abort on start`);
      } else {
        const list = JSON.parse(Buffer.from(entry.bin).toString("utf8"));
        const item = Array.isArray(list) ? list.find((x) => String(x?.file ?? "").toLowerCase() === "resources\\app.asar") : null;
        if (!item || String(item.alg ?? "").toLowerCase() !== "sha256" || typeof item.value !== "string") {
          problems.push(`${exePath} INTEGRITY resource has no sha256 entry for resources\\app.asar`);
        } else if (item.value.toLowerCase() !== expectedHash) {
          problems.push(`${exePath} INTEGRITY hash ${item.value} != app.asar header hash ${expectedHash}`);
        }
      }
    } catch (e) {
      problems.push(`${exePath} PE resources could not be read (${e instanceof Error ? e.message : e})`);
    }
  }
  return problems;
}

/** The fuses a release must carry, in @electron/fuses' wire numbering; 48 = off, 49 = on, as the wire reports them. */
const REQUIRED_FUSES = { 0: false, 2: false, 3: false, 4: true, 5: true };
const FUSE_NAMES = { 0: "RunAsNode", 2: "EnableNodeOptionsEnvironmentVariable", 3: "EnableNodeCliInspectArguments", 4: "EnableEmbeddedAsarIntegrityValidation", 5: "OnlyLoadAppFromAsar" };

/**
 * Checks every packed app's fuse wire, ASAR integrity metadata, and (when running on macOS) ad-hoc signature.
 * Returns a list of problems, empty = ok. An unpacked app that is not there is not a problem: the installers are what
 * a release ships.
 */
export async function verifyFuses({ dir, platform, productFilename = "sc player", checkCodesign = process.platform === "darwin" }) {
  const apps = unpackedApps(dir, platform);
  if (!apps.length) return [];
  const { getCurrentFuseWire } = await import("@electron/fuses");
  const problems = [];
  for (const unpacked of apps) {
    let wire;
    try {
      wire = await getCurrentFuseWire(fusesTarget(unpacked, platform, productFilename));
    } catch (e) {
      problems.push(`the packed app in ${unpacked} has no readable fuse wire (${e.message}) — scripts/fuses.mjs did not run`);
      continue;
    }
    for (const [fuse, want] of Object.entries(REQUIRED_FUSES)) {
      const state = wire[Number(fuse)];
      if (state !== (want ? 49 : 48)) problems.push(`fuse ${FUSE_NAMES[fuse]} is ${state === 49 ? "on" : "off"} in ${unpacked} but must be ${want ? "on" : "off"}`);
    }
    problems.push(...verifyAsarAndSignature({ unpacked, platform, productFilename, checkCodesign }));
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
    // every file the metadata points at must exist, with the size recorded, and with its differential blockmap
    for (const f of yml.files) {
      const file = join(dir, f.url);
      if (!existsSync(file)) say(`${ymlName} lists ${f.url} but it is not in ${dir}`);
      else if (f.size !== null) {
        const actual = statSync(file).size;
        if (actual !== f.size) say(`${f.url} size ${actual} != ${ymlName} size ${f.size}`);
      }
      if (platform === "darwin" && /\.zip$/i.test(f.url)) {
        const bm = join(dir, `${f.url}.blockmap`);
        if (!existsSync(bm) || statSync(bm).size === 0) say(`missing blockmap ${f.url}.blockmap for differential macOS updates`);
      }
      if (platform === "linux" && /\.AppImage$/i.test(f.url) && f.blockMapSize !== null) {
        if (f.blockMapSize <= 0 || (f.size !== null && f.blockMapSize >= f.size))
          say(`${f.url} has an invalid embedded blockMapSize (${f.blockMapSize}) in ${ymlName}`);
      }
    }
  }

  // ---- the installers themselves, per platform
  if (platform === "win32") {
    const setups = pick(/setup.*\.exe$/i);
    if (setups.length === 0) say("no NSIS installer (sc-player-setup-*.exe) in the output");
    for (const s of setups) {
      const bm = join(dir, `${s}.blockmap`);
      if (!existsSync(bm) || statSync(bm).size === 0) say(`missing blockmap ${s}.blockmap for differential Windows updates`);
    }
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
  console.log(`verify-dist (${platform}): ok — ${dir} carries the installers, blockmaps, ${platform === "win32" ? "latest.yml" : platform === "darwin" ? "latest-mac.yml" : "latest-linux.yml"}, the fuses and ASAR integrity, for v${expectVersion}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // a failed promise must still exit non-zero (a check that crashes before printing must not look like a pass)
  main().catch((e) => {
    console.error(`verify-dist: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  });
}
