// Guards the supply-chain rules of .github/workflows/ and .github/ — a pinned action is only pinned until someone
// adds a step with `@v4`, and the rules about who may write what are easy to widen by accident. These are the parts a
// machine can check; branch protection and the environment's reviewers live in GitHub's settings and cannot be.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const WORKFLOWS = join(import.meta.dirname, "..", ".github", "workflows");
const read = (name) => readFileSync(join(WORKFLOWS, name), "utf8");
const workflowNames = readdirSync(WORKFLOWS).filter((n) => /\.ya?ml$/.test(n));

/** every `uses:` line, with the step's own `name:` (or its action) for a readable failure */
function usesLines(text) {
  return text
    .split("\n")
    .filter((l) => /^\s*(-\s+)?uses:/.test(l))
    .map((l) => l.trim().replace(/^-\s+/, ""));
}

test("every action is pinned to a full commit SHA with the version in a comment", () => {
  for (const file of workflowNames) {
    for (const line of usesLines(read(file))) {
      // local actions (./path) have nothing to pin
      if (/^uses:\s*\.\//.test(line)) continue;
      assert.match(
        line,
        /^uses:\s+[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)?@[0-9a-f]{40}\s+#\s+v?[0-9][0-9A-Za-z.]*\s*$/,
        `${file}: not a pinned SHA with a version comment: ${line}`,
      );
    }
  }
});

test("no tag, branch or @main anywhere in a uses line", () => {
  for (const file of workflowNames) {
    for (const line of usesLines(read(file))) {
      assert.doesNotMatch(line, /@(v\d+\b|main|master|latest)(\s|$)/, `${file}: floating ref: ${line}`);
    }
  }
});

test("the release job is the only one with write access, and it runs in the release environment", () => {
  const release = read("release.yml");
  assert.match(release, /^permissions:\n {2}contents: read$/m, "the workflow default must be read-only");
  assert.match(release, /environment: release/);
  const jobPerm = /permissions:\n((?: {6}\S+: \S+\n)+)/.exec(release)?.[1] ?? "";
  for (const want of ["contents: write", "id-token: write", "attestations: write"]) {
    assert.ok(jobPerm.includes(want), `the release job needs ${want}`);
  }
  assert.ok(!/pull_request_target/.test(release), "pull_request_target would hand the write token to a fork");
  // CI and build never get a write token
  for (const file of ["ci.yml", "build.yml"]) {
    const text = read(file);
    assert.doesNotMatch(text, /contents: write|id-token: write|attestations: write/, `${file}: write access`);
    assert.match(text, /^permissions:\n {2}contents: read$/m, `${file}: no explicit read-only default`);
  }
});

test("the release attaches what it was built from: checksums, attestation, and the metadata", () => {
  const release = read("release.yml");
  assert.match(release, /node scripts\/checksums\.mjs dist/, "the checksum list is never made");
  assert.match(release, /subject-path:[\s\S]*dist\/SHA256SUMS\.txt/, "the checksum list is not attested");
  assert.match(release, /files=\([^)]*dist\/SHA256SUMS\.txt[^)]*\)/, "the checksum list is not attached to the release");
  assert.match(release, /dist\/latest\*\.yml/, "the updater metadata is not attached");
});

test("dependabot keeps both the actions and the app's packages current", () => {
  const file = readFileSync(join(WORKFLOWS, "..", "dependabot.yml"), "utf8");
  assert.match(file, /package-ecosystem: github-actions/);
  assert.match(file, /package-ecosystem: npm/);
  assert.match(file, /interval: weekly/);
});

test("code scanning is a workflow of its own, on the languages this repository is written in", () => {
  const codeql = read("codeql.yml");
  assert.match(codeql, /github\/codeql-action\/init@[0-9a-f]{40} # v/);
  assert.match(codeql, /github\/codeql-action\/analyze@[0-9a-f]{40} # v/);
  assert.match(codeql, /languages: javascript-typescript/);
  assert.match(codeql, /security-events: write/);
});
