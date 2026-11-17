import type { ClientId } from "./client-id";
import { log } from "../system/log";
import { reportNetTrouble } from "../system/net-trouble";
import { ScError } from "./errors";
import { API_HOST, API_V2, chromeUserAgent, scSession } from "./session";

type Params = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions {
  method?: "GET" | "PUT" | "POST" | "DELETE";
  body?: unknown;
  /** "required" fails fast without a session; "optional" sends the token when there is one */
  auth?: "required" | "optional" | "none";
  /** cache GET responses this long (ms) */
  ttl?: number;
}

const MAX_PARALLEL = 4;
const MAX_TRIES = 4;
const CACHE_LIMIT = 300;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** same redaction everywhere: no token-like runs anywhere in a log line */
const redactSecrets = (s: string) => s.replace(/[A-Za-z0-9_-]{20,}/g, "…").slice(0, 240);

/**
 * The only way to api-v2. Gentle with SoundCloud: at most 4 requests at a time, identical GETs share one request and
 * a short cache, a 429 pauses every request for as long as the server asks (or with growing waits), a rejected
 * client_id is looked up again once. Every failure becomes an ScError with a code the UI understands.
 */
export class ScHttp {
  private cache = new Map<string, { at: number; ttl: number; data: unknown }>();
  private inflight = new Map<string, Promise<unknown>>();
  private pausedUntil = 0;
  private active = 0;
  private waiting: (() => void)[] = [];

  constructor(
    private readonly clientId: ClientId,
    private readonly token: () => string | null,
    /** a refused token: look for a newer one (the session's cookie); true when there is one to try */
    private readonly renew?: () => Promise<boolean>,
  ) {}

  clearCache() {
    this.cache.clear();
  }

  /** `pathOrUrl` is an api-v2 path or a full api-v2 URL (next_href, transcoding URLs); nothing else is fetched. */
  async json<T>(pathOrUrl: string, params: Params = {}, opts: RequestOptions = {}): Promise<T> {
    const url = new URL(pathOrUrl, API_V2);
    if (url.protocol !== "https:" || url.host !== API_HOST) throw new ScError("unknown", `refusing to fetch ${url.host}`);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    url.searchParams.delete("client_id");

    const method = opts.method ?? "GET";
    const auth = opts.auth ?? "optional";
    const token = auth === "none" ? null : this.token();
    if (auth === "required" && !token) throw new ScError("unauthorized", "not signed in");

    const key = `${method} ${token ? "1" : "0"} ${url.href}`;
    if (method === "GET") {
      const hit = this.cache.get(key);
      if (hit && Date.now() - hit.at < hit.ttl) return hit.data as T;
      const running = this.inflight.get(key);
      if (running) return running as Promise<T>;
    }

    const run = this.slot(() => this.send<T>(url, method, token, opts.body)).then((data) => {
      if (method === "GET" && opts.ttl) {
        if (this.cache.size > CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(key, { at: Date.now(), ttl: opts.ttl, data });
      }
      return data;
    });
    if (method === "GET") {
      this.inflight.set(key, run);
      void run.catch(() => undefined).finally(() => this.inflight.delete(key));
    } else {
      // a write changes what lists show
      this.cache.clear();
    }
    return run;
  }

  private async slot<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= MAX_PARALLEL) await new Promise<void>((r) => this.waiting.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }

  private async send<T>(url: URL, method: string, token: string | null, body: unknown): Promise<T> {
    let clientIdRetried = false;
    let tokenRenewed = false;
    let networkRetried = false;
    let serverRetried = false;
    for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
      const pause = this.pausedUntil - Date.now();
      if (pause > 0) await sleep(pause);

      url.searchParams.set("client_id", await this.clientId.get());
      const headers: Record<string, string> = { Accept: "application/json", "User-Agent": chromeUserAgent() };
      if (token) headers.Authorization = `OAuth ${token}`;
      if (body !== undefined) headers["Content-Type"] = "application/json";

      let res: Response;
      try {
        // actions carry the session's cookies, so a check passed on soundcloud.com in the app counts (DataDome)
        // 15 s ceiling so a dead socket/proxy can't hold one of the 4 slots for ever
        res = await scSession().fetch(url.href, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(15_000),
          ...(method === "GET" ? {} : { credentials: "include" as const }),
        });
      } catch (err) {
        // writes are never repeated: the request may have reached SoundCloud and a retry would do it twice
        if (method !== "GET") {
          log("main", `http: ${method} ${url.pathname} → network error: ${redactSecrets((err as Error).message)}`);
          throw new ScError("offline", redactSecrets((err as Error).message));
        }
        if (!networkRetried) {
          networkRetried = true;
          // the proxy's "auto" mode may switch to Moonwave's proxy meanwhile: the retry then goes that way
          if (!(await reportNetTrouble())) await sleep(1000);
          continue;
        }
        log("main", `http: ${method} ${url.pathname} → network error: ${redactSecrets((err as Error).message)}`);
        throw new ScError("offline", redactSecrets((err as Error).message));
      }

      if (res.status === 429) {
        const header = Number(res.headers.get("retry-after"));
        const asked = Number.isFinite(header) && header > 0 ? header * 1000 : 0;
        // the backoff branch is capped at 30 s; a server-imposed pause is capped at 60 s and never sat out in a slot
        const wait = asked ? Math.min(60_000, asked) : Math.min(30_000, 2000 * 2 ** attempt);
        if (asked && asked > 15_000) {
          log("main", `http: ${method} ${url.pathname} → 429 (Retry-After ${header} s: failing fast instead of sleeping a slot)`);
          throw new ScError("rate_limited", `SoundCloud asks to slow down (retry in ${Math.round(wait / 1000)} s)`);
        }
        this.pausedUntil = Math.max(this.pausedUntil, Date.now() + wait);
        if (attempt < MAX_TRIES - 1) continue;
        log("main", `http: ${method} ${url.pathname} → ${res.status} (retry budget spent, asked for ${res.headers.get("retry-after") ?? "?"} s)`);
        throw new ScError("rate_limited", `SoundCloud asks to slow down (retry in ${Math.round(wait / 1000)} s)`);
      }
      if (res.status === 401 || res.status === 403) {
        // what refused it, for the log: SoundCloud itself or its bot protection (DataDome); no tokens, no query
        const text = redactSecrets(await res.text().catch(() => ""));
        const datadome = res.headers.has("x-datadome") || /datadome|captcha-delivery/i.test(text);
        log("main", `http: ${method} ${url.pathname} → ${res.status}${datadome ? " [DataDome]" : ""} ${res.headers.get("content-type") ?? ""} ${text}`);
        // the bot protection wants a person checked (actions: likes, playlists); not the token's fault
        if (datadome) throw new ScError("verify", "SoundCloud's bot protection asks for a check");
        // an outdated client_id is rejected the same way as a bad token: look the id up again once first
        if (!clientIdRetried) {
          clientIdRetried = true;
          if (await this.clientId.recheck()) continue;
        }
        // the site may have given the session a newer token (its check page): that one, once
        if (token && !tokenRenewed && this.renew) {
          tokenRenewed = true;
          if (await this.renew()) {
            token = this.token();
            continue;
          }
        }
        throw new ScError(token ? "unauthorized" : "unavailable", `SoundCloud answered ${res.status}`);
      }
      if (res.status === 404) {
        // deliberately visible: a not_found that isn't logged is indistinguishable from a wrong method or path
        const text = redactSecrets(await res.text().catch(() => ""));
        log("main", `http: ${method} ${url.pathname} → 404 ${text}`);
        throw new ScError("not_found", `not found: ${url.pathname}`);
      }
      if (res.status >= 500) {
        // writes are never repeated: 5xx may have arrived after the write already happened
        if (method !== "GET") {
          const text = redactSecrets(await res.text().catch(() => ""));
          log("main", `http: ${method} ${url.pathname} → ${res.status} ${text}`);
          throw new ScError("unknown", `SoundCloud server error ${res.status}`);
        }
        if (!serverRetried) {
          serverRetried = true;
          await sleep(1500);
          continue;
        }
        const text = redactSecrets(await res.text().catch(() => ""));
        log("main", `http: ${method} ${url.pathname} → ${res.status} ${text}`);
        throw new ScError("unknown", `SoundCloud server error ${res.status}`);
      }
      if (!res.ok) {
        const text = redactSecrets(await res.text().catch(() => ""));
        log("main", `http: ${method} ${url.pathname} → ${res.status} ${res.headers.get("content-type") ?? ""} ${text}`);
        throw new ScError("unknown", `SoundCloud answered ${res.status}`);
      }

      const text = await res.text();
      if (!text) return undefined as T;
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new ScError("api_changed", `not JSON from ${url.pathname}`);
      }
    }
    throw new ScError("unknown", "too many retries");
  }
}
