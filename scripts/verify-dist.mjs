// Verifies a packaging result against what the auto-updater consumes — called at the end of `npm run dist` and by
// the release workflow, so a build missing the update metadata can never be treated as a release. Exits 1 (and says
// exactly what is missing) when:
//   Windows: dist/latest.yml is absent, versions don't match package.json, the NSIS installer is not listed there,
//            a listed file is missing or its size differs, or the portable .exe leaked into latest.yml
//            (a portable build can never self-update — it would break every portable user);
//   macOS:   dist/latest-mac.yml with the same rules (zip required — that is what Squirrel.Mac consumes);
//   Linux:   dist/latest-linux.yml listing the AppImage; the .deb is built for the package manager, not for updates.
//
// Usage: node scripts/verify-dist.mjs [--platform=win32|darwin|linux] [--expect-version=2.3.2] [distdir]
// Importable for tests: import { parseLatestYml, verifyDist } from "./verify-dist.mjs" — the CLI runs only when executed.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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

function main() {
  const args = process.argv.slice(2);
  const platformArg = args.find((a) => a.startsWith("--platform="))?.split("=")[1];
  const expectArg = args.find((a) => a.startsWith("--expect-version="))?.split("=")[1];
  const dir = args.find((a) => !a.startsWith("--")) ?? "dist";
  const platform = platformArg ?? (process.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "linux");
  const { version } = JSON.parse(readFileSync("package.json", "utf8"));
  const expectVersion = expectArg ?? version;
  const problems = verifyDist({ dir, platform, expectVersion });
  if (problems.length) {
    console.error(`verify-dist (${platform}): ${problems.length} problem(s)`);
    for (const p of problems) console.error(`  ✗ ${p}`);
    process.exit(1);
  }
  console.log(`verify-dist (${platform}): ok — ${dir} carries the installers and ${platform === "win32" ? "latest.yml" : platform === "darwin" ? "latest-mac.yml" : "latest-linux.yml"} for v${expectVersion}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
