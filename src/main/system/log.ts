import { appendFileSync, chmodSync, mkdirSync, renameSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { app } from "electron";
import { redact } from "./redact";

/**
 * A small log file for bug reports (Settings → Diagnostics → Open logs): errors from main and from the page, one line
 * each. Kept under 1 MB (the previous one is kept as main.old.log). Every line is redacted (system/redact.ts) before it
 * is written: the file is meant to be attached to public issues.
 */
const MAX = 1024 * 1024;

export const logsDir = () => join(app.getPath("userData"), "logs");

let home: string | undefined;
let modeChecked = false;

export function log(source: "main" | "page", message: string) {
  try {
    const dir = logsDir();
    // this user only (ignored on Windows, where the profile folder is already private)
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = join(dir, "main.log");
    try {
      if (statSync(file).size > MAX) renameSync(file, join(dir, "main.old.log"));
    } catch {
      /* no file yet */
    }
    home ??= homedir();
    // cut first so a huge message (a whole response body) costs nothing to redact
    const line = redact(message.slice(0, 4000).replace(/\s+/g, " "), home).slice(0, 2000);
    appendFileSync(file, `${new Date().toISOString()} [${source}] ${line}\n`, { mode: 0o600 });
    // a log written by an older version keeps the mode it was created with
    if (!modeChecked) {
      modeChecked = true;
      chmodSync(file, 0o600);
    }
  } catch {
    /* logging must never break the app */
  }
}
