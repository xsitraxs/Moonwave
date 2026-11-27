// The development guide and CONTRIBUTING.md promise commands. A promise with no script behind it is worse
// than no documentation, so this keeps the two in step with package.json.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = join(import.meta.dirname, "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

test("every npm script the development guide names exists in package.json", () => {
  const file = "docs/development.md";
  const text = readFileSync(join(root, file), "utf8");
  const named = new Set([...text.matchAll(/npm run ([a-z][a-z:-]*)/g)].map((m) => m[1]));
  assert.ok(named.size >= 5, `the guide names only ${named.size} npm scripts`);
  for (const name of named) assert.ok(pkg.scripts[name], `${file} says \`npm run ${name}\`, but package.json has no such script`);
  if (/\bnpm test\b/.test(text)) assert.ok(pkg.scripts.test, `${file} says \`npm test\`, but package.json has no test script`);
});

test("CONTRIBUTING.md tells people what to run before a pull request", () => {
  const file = join(root, "CONTRIBUTING.md");
  assert.ok(existsSync(file), "CONTRIBUTING.md is missing");
  const text = readFileSync(file, "utf8");
  for (const cmd of ["npm test", "npm run test:server", "npm run typecheck", "npm run typecheck:server", "npm run lint"]) {
    assert.ok(text.includes(cmd), `CONTRIBUTING.md never mentions \`${cmd}\``);
  }
  assert.ok(text.includes("Node.js 24"), "CONTRIBUTING.md must say which Node is needed");
});
