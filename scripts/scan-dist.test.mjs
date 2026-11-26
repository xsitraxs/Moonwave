// The scanner's note about a build that carries the project's proxy: a warning, never a failure (the credentials are
// in the bundle on purpose in a private build), and never the host or the credentials in the output.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const scanScript = join(import.meta.dirname, "scan-dist.mjs");
const HOST = "proxy.example.test";

/** A throwaway build folder (and, when asked, the local proxy settings next to it) as a custom build leaves them. */
function workspace(files, proxy) {
  const dir = mkdtempSync(join(tmpdir(), "moonwave-scan-"));
  mkdirSync(join(dir, "build"), { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    const path = join(dir, "build", name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  if (proxy) writeFileSync(join(dir, "proxy.local.json"), JSON.stringify(proxy));
  return dir;
}

async function scan(dir) {
  try {
    const { stdout, stderr } = await promisify(execFile)(process.execPath, [scanScript, "build"], { cwd: dir });
    return { code: 0, output: stdout + stderr };
  } catch (e) {
    return { code: e.code, output: `${e.stdout}${e.stderr}` };
  }
}

const withProxy = () =>
  workspace(
    {
      "main/index.js": `const proxy={scheme:"https",host:"${HOST}",port:443,username:"someone",password:"secret"};`,
      "renderer/index.html": "<html><body>Moonwave</body></html>",
    },
    { host: HOST, port: 443, username: "someone", password: "secret" },
  );

test("a build made with proxy.local.json gets a warning, and the scan still passes", async () => {
  const dir = withProxy();
  try {
    const { code, output } = await scan(dir);
    assert.equal(code, 0, output);
    assert.match(output, /warning/, "the scanner must say something");
    assert.match(output, /built with the project's proxy/, "the warning must name the reason");
    assert.match(output, /scan: ok/, "a warning is not a failure");
    assert.ok(!output.includes(HOST), `the host must not be printed: ${output}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("without proxy.local.json there is nothing to warn about", async () => {
  const dir = workspace({ "main/index.js": `const x="${HOST}";` });
  try {
    const { code, output } = await scan(dir);
    assert.equal(code, 0, output);
    assert.doesNotMatch(output, /warning/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a real secret still fails the scan, next to the warning", async () => {
  const dir = withProxy();
  try {
    // not a literal token in this file: the scan would have to find it here too
    writeFileSync(join(dir, "build", "main", "leak.js"), `const t="${"ghp_" + "a".repeat(36)}";`);
    const { code, output } = await scan(dir);
    assert.equal(code, 1, "a secret is a failure");
    assert.match(output, /warning/, "the proxy note is printed too");
    assert.match(output, /GitHub personal access token/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
