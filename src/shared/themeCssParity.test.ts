import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * The app and the server run the same sanitiser. The server (`server/api/src/theme-css.ts`) has no dependencies and
 * cannot import from `src/`, so it carries an exact copy — and this test is what keeps "exact" true. When it fails,
 * copy the file over: `cp src/shared/themeCss.ts server/api/src/theme-css.ts` (or the other way around, if the server
 * is where the change belongs). The only difference allowed is the file name in the doc comment.
 */
test("the server's copy of the theme CSS sanitiser is the app's file, unchanged", () => {
  const app = readFileSync(join(import.meta.dirname, "themeCss.ts"), "utf8");
  const server = readFileSync(join(import.meta.dirname, "..", "..", "server", "api", "src", "theme-css.ts"), "utf8");
  assert.equal(
    server,
    app,
    "server/api/src/theme-css.ts has drifted from src/shared/themeCss.ts — copy the newer file over the older one",
  );
});
