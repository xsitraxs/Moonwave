// The README's «Разработка» section and CONTRIBUTING.md promise commands. A promise with no script behind it is worse
// than no documentation, so this keeps the two in step with package.json.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = join(import.meta.dirname, "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

test("every npm script the README's development section names exists in package.json", () => {
  const readme = readFileSync(join(root, "README.md"), "utf8");
  const start = readme.indexOf("## Разработка");
  assert.notEqual(start, -1, "README.md has no «Разработка» section");
  const next = readme.indexOf("\n## ", start + 1);
  const section = readme.slice(start, next === -1 ? undefined : next);

  const named = new Set([...section.matchAll(/npm run ([a-z][a-z:-]*)/g)].map((m) => m[1]));
  assert.ok(named.size >= 5, `the section names only ${named.size} npm scripts`);
  for (const name of named) assert.ok(pkg.scripts[name], `README.md says \`npm run ${name}\`, but package.json has no such script`);
  if (/\bnpm test\b/.test(section)) assert.ok(pkg.scripts.test, "README.md says `npm test`, but package.json has no test script");

  // the same promises in English, at the end of the file
  const english = readme.slice(readme.indexOf("## English"));
  for (const name of new Set([...english.matchAll(/npm run ([a-z][a-z:-]*)/g)].map((m) => m[1]))) {
    assert.ok(pkg.scripts[name], `the English part says \`npm run ${name}\`, but package.json has no such script`);
  }
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
