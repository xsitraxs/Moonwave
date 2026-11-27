import { resolve } from "node:path";

/**
 * Where the database and the theme files live: `DATA_DIR` as given (a relative one is still taken from the working
 * directory), or, when it is unset, `server/api/data` next to the source — absolute, so the folder does not move with
 * the directory the server happens to be started from (`node src/main.ts` and `node server/api/src/main.ts` must use
 * the same database).
 */
export function dataDir(env: string | undefined, here: string): string {
  return env ? resolve(env) : resolve(here, "..", "data");
}
