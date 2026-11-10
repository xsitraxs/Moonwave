// Writes dist/SHA256SUMS.txt — one line per file that goes into a release, in the exact `sha256sum` format, so that
// `sha256sum -c SHA256SUMS.txt` (or `shasum -a 256 -c` on macOS) works on a downloaded set. The release workflow
// attests the provenance of the same list, which makes the checksums themselves verifiable, not just published.
//
// Only the files the release attaches are summed: installers, the updater's blockmaps, latest*.yml and the list. The
// unpacked app and builder leftovers (builder-*.yml, *.blockmap of unpacked dirs, logs) are deliberately not published,
// so listing them would only invite a download that does not exist.
//
// Usage: node scripts/checksums.mjs [distdir]   (default: dist)
// Importable for tests: import { publishedFiles, sumsFor } from "./checksums.mjs".
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

const RELEASE_FILE = /\.(exe|dmg|zip|AppImage|deb)$|^latest[^/]*\.yml$|\.blockmap$/;

/**
 * The release-attached files of a dist/ folder, sorted by name: installers, update metadata, blockmaps. Directories
 * (the unpacked app) and anything else are skipped — a name is only listed if it is a regular file.
 */
export function publishedFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => RELEASE_FILE.test(n))
    .filter((n) => statSync(join(dir, n)).isFile())
    .sort();
}

/** `sha256  name` lines (two spaces, as sha256sum writes them) for the given files of dir. */
export function sumsFor(dir, names = publishedFiles(dir)) {
  return names.map((n) => {
    const hash = createHash("sha256").update(readFileSync(join(dir, n))).digest("hex");
    return `${hash}  ${basename(n)}`;
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2] ?? "dist";
  const names = publishedFiles(dir);
  if (names.length === 0) {
    console.error(`checksums: no release files in ${dir} — nothing was built?`);
    process.exit(1);
  }
  const text = `${sumsFor(dir, names).join("\n")}\n`;
  writeFileSync(join(dir, "SHA256SUMS.txt"), text);
  console.log(`checksums: ${names.length} files -> ${join(dir, "SHA256SUMS.txt")}`);
  for (const line of text.trimEnd().split("\n")) console.log(`  ${line}`);
}
