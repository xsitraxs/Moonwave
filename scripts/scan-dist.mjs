// Scans the built output (out/, and dist/ when present) for secrets that must never ship:
//   private keys and well-known token formats — high signal, no guesswork about what a bundle "means";
//   and aborts if any build picked up the local-only files (proxy.local.json, server.local.json, .env*, secrets.bin, *.pem …).
// Exits 1 on any finding; findings print the file and the rule, never the value.
//
// Note: the built-in proxy's credentials ARE embedded in the main bundle when the build has proxy.local.json — that is
// this project's deliberate design (a shared proxy account for installed copies, see server/README.md), so they are
// not flagged. Everything else must be clean. Run after `electron-vite build`, and again on dist/ in CI.
//
// app.asar is unpacked and scanned too: the release build's app.asar is what ships to users, and skipping it by
// extension made the scanner a silent no-op on exactly what matters (see P2-9).
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname, basename as pathBasename } from "node:path";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extractAll } from "@electron/asar";

const roots = process.argv.slice(2);
const targets = roots.length > 0 ? roots : ["out", "dist"];

const TEXT_EXT = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".json", ".html", ".css", ".map", ".yml", ".yaml", ".txt", ".md", ".svg"]);
// files inside app.asar can be big bundles — don't skip them, just cap each at 100 MB
const MAX_TEXT_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_BYTES_INSIDE_ASAR = 100 * 1024 * 1024;
/** basenames that must never appear in a build (they are local inputs or user data, not package contents).
 *  server/.env.example is explicitly committed as a template, so it is the one allowed dot-env file. */
const ALLOWED_BASENAMES = new Set([".env.example"]);
const FORBIDDEN_FILES = [/^proxy\.local\.json$/i, /^server\.local\.json$/i, /^\.env($|\.[^.]*$)/i, /^secrets\.bin$/i, /\.(pem|p12|pfx|key)$/i, /^id_rsa/i, /^\.npmrc$/i, /^\.netrc$/i];
const forbidden = (base) => !ALLOWED_BASENAMES.has(base) && FORBIDDEN_FILES.some((re) => re.test(base));
const PATTERNS = [
  [/-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/, "private key"],
  [/ghp_[A-Za-z0-9]{36,255}/, "GitHub personal access token"],
  [/github_pat_[A-Za-z0-9_]{22,255}/, "GitHub fine-grained token"],
  [/gho_[A-Za-z0-9]{36,255}/, "GitHub OAuth token"],
  [/ghu_[A-Za-z0-9]{36,255}/, "GitHub user-to-server token"],
  [/ghs_[A-Za-z0-9]{36,255}/, "GitHub server-to-server token"],
  [/ghr_[A-Za-z0-9]{36,255}/, "GitHub refresh token"],
  [/AKIA[0-9A-Z]{16}/, "AWS access key id"],
  [/AIza[0-9A-Za-z_-]{35}/, "Google API key"],
  [/xox[aboprs]-[A-Za-z0-9-]{10,}/, "Slack token"],
  [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, "JSON Web Token"],
];

const findings = [];
const scanned = { files: 0, bytes: 0 };

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

const cwd = process.cwd();

/** One text file: forbidden-name check, then pattern scan. `rel` is the path shown in findings (e.g. `app.asar!/leak.js`). */
function scanFile(file, rel, maxBytes) {
  const base = pathBasename(file);
  // 1. files that should never be part of a build
  if (forbidden(base)) {
    findings.push(`${rel}: forbidden file in the build (${base})`);
    return;
  }
  // 2. secret-shaped strings in text files
  const ext = extname(file);
  if (!TEXT_EXT.has(ext)) return;
  const size = statSync(file).size;
  if (size > maxBytes) return;
  const text = readFileSync(file, "utf8");
  scanned.files++;
  scanned.bytes += size;
  for (const [re, name] of PATTERNS) {
    if (re.test(text)) findings.push(`${rel}: ${name}`);
  }
}

/** app.asar is a zip-like archive: unpack it and scan the files inside as if they were at `label` paths. */
async function scanAsar(asarFile) {
  const tmp = mkdtempSync(join(tmpdir(), "scan-asar-"));
  try {
    await extractAll(asarFile, tmp);
    for (const file of walk(tmp)) scanFile(file, `${relative(cwd, asarFile)}!/${relative(tmp, file)}`, MAX_TEXT_BYTES_INSIDE_ASAR);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

for (const root of targets) {
  if (!existsSync(root)) {
    console.log(`scan: ${root} not present — skipped`);
    continue;
  }
  for (const file of walk(root)) {
    scanFile(file, relative(cwd, file), MAX_TEXT_BYTES);
    // 3. the archive itself: unpack and scan what ships inside it
    if (extname(file) === ".asar") await scanAsar(file);
  }
}

// 4. nothing local or secret is tracked in git either (fast, cheap, always on)
try {
  const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean);
  for (const f of tracked) {
    const base = pathBasename(f);
    if (forbidden(base)) findings.push(`${f}: forbidden file tracked in git`);
  }
} catch {
  console.log("scan: git not available — tracked-files check skipped");
}

if (findings.length) {
  console.error(`scan: ${findings.length} problem(s) found`);
  for (const f of findings) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`scan: ok — ${scanned.files} text files (${(scanned.bytes / 1024 / 1024).toFixed(1)} MB) under ${targets.join(", ")}, no secrets found`);
