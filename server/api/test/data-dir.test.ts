import assert from "node:assert/strict";
import { isAbsolute, join } from "node:path";
import { test } from "node:test";
import { dataDir } from "../src/data-dir.ts";

test("without DATA_DIR the database lives in server/api/data, not in whatever folder the server started in", () => {
  // a src folder as anything would report it; the answer must not depend on the working directory
  const dir = dataDir(undefined, join("repo", "server", "api", "src"));
  assert.ok(isAbsolute(dir), `expected an absolute path, got ${dir}`);
  assert.equal(dir, join(process.cwd(), "repo", "server", "api", "data"));
});

test("DATA_DIR is still taken as given", () => {
  assert.equal(dataDir("/var/lib/moonwave", join("repo", "server", "api", "src")), "/var/lib/moonwave");
  // a relative one keeps its old meaning: from the working directory
  assert.equal(dataDir("./data-dev", join("repo", "server", "api", "src")), join(process.cwd(), "data-dev"));
});
