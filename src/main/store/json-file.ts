import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * A small JSON document on disk: read once, written atomically (tmp + rename) and debounced.
 *
 * A file that isn't valid JSON is never overwritten: it is renamed to `<path>.bad-<time>` before anything is written,
 * so the damaged copy can still be looked at (and the log says where it went). A write that fails keeps the changes in
 * memory and is tried again after the same delay, so a disk that is briefly busy or full doesn't lose them silently.
 */
export class JsonFile<T extends object> {
  private data: T;
  private timer: NodeJS.Timeout | null = null;
  private readonly path: string;
  private readonly delay: number;
  private readonly log: (message: string) => void;

  constructor(path: string, defaults: T, delay = 400, log: (message: string) => void = (m) => console.error(m)) {
    // plain fields instead of parameter properties: node --test runs these files with type stripping only
    this.path = path;
    this.delay = delay;
    this.log = log;
    let stored: Partial<T> = {};
    try {
      stored = JSON.parse(readFileSync(path, "utf8")) as Partial<T>;
    } catch (e) {
      // no file at all is the normal first run; anything else (bad JSON, unreadable file) is data worth keeping
      if ((e as NodeJS.ErrnoException | undefined)?.code !== "ENOENT") this.setAside(e);
    }
    this.data = { ...defaults, ...stored };
  }

  get(): Readonly<T> {
    return this.data;
  }

  patch(patch: Partial<T>) {
    this.data = { ...this.data, ...patch };
    this.schedule();
  }

  /** Writes now; a failure is logged and retried in the background — the data stays here, so nothing is lost. */
  flush() {
    this.cancel();
    try {
      this.write();
    } catch (e) {
      this.log(`store: writing ${this.path} failed (${reason(e)}), retrying in ${this.delay} ms`);
      this.schedule();
    }
  }

  private write() {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    // likes, playlists, history and settings are nobody else's business on a shared computer: this user only (the
    // rename keeps the mode; ignored on Windows)
    writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
    renameSync(tmp, this.path);
  }

  /** Keeps a damaged file for good (it may be the only copy of a library) and logs where it went. */
  private setAside(e: unknown) {
    const bad = `${this.path}.bad-${Date.now()}`;
    try {
      renameSync(this.path, bad);
      this.log(`store: ${this.path} is damaged (${reason(e)}); kept as ${bad}, starting from the defaults`);
    } catch (renameError) {
      // the copy couldn't be moved aside: writing would overwrite it, so say so loudly and keep reading from defaults
      this.log(`store: ${this.path} is damaged (${reason(e)}) and could not be kept (${reason(renameError)})`);
    }
  }

  private schedule() {
    this.cancel();
    this.timer = setTimeout(() => this.flush(), this.delay);
  }

  private cancel() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
