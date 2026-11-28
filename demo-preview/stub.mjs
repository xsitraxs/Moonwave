// Builds app/ from ../out/renderer and writes demo-stub.js (kept out of index.html: the build's CSP allows
// same-origin scripts only, never inline ones). Run `npm run build` first, then `node demo-preview/stub.mjs`,
// then serve with `node demo-preview/serve.mjs` (defaults to port 4173).
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const DIR = fileURLToPath(new URL(".", import.meta.url));
const built = fileURLToPath(new URL("../out/renderer/", import.meta.url));
const app = DIR + "app";
const lyrics = JSON.parse(readFileSync(DIR + "lyrics.json", "utf8"));

// a moon over a dark sea, scratched as SVG, for the cover and the window icon
const coverSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1c1f42"/><stop offset="0.55" stop-color="#12142e"/><stop offset="1" stop-color="#07081a"/></linearGradient><radialGradient id="moon" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#fdf6dd"/><stop offset="0.72" stop-color="#efe3bd"/><stop offset="1" stop-color="#c9bd95"/></radialGradient><radialGradient id="halo" cx="0.62" cy="0.38" r="0.28"><stop offset="0" stop-color="#f5ead2" stop-opacity="0.55"/><stop offset="1" stop-color="#f5ead2" stop-opacity="0"/></radialGradient></defs><rect width="100" height="100" fill="url(#sky)"/><rect width="100" height="100" fill="url(#halo)"/><circle cx="62" cy="38" r="15" fill="url(#moon)"/><circle cx="58" cy="35" r="13" fill="#12142e" opacity="0.22"/><g fill="#fdf6dd"><circle cx="18" cy="16" r="0.5" opacity="0.9"/><circle cx="34" cy="8" r="0.4" opacity="0.7"/><circle cx="46" cy="20" r="0.6" opacity="0.8"/><circle cx="80" cy="14" r="0.5" opacity="0.9"/><circle cx="90" cy="30" r="0.4" opacity="0.6"/><circle cx="26" cy="30" r="0.4" opacity="0.7"/><circle cx="72" cy="24" r="0.35" opacity="0.6"/></g><path d="M0 74 Q 16 70 30 74 T 62 74 T 100 73 V100 H0 Z" fill="#0e1030"/><path d="M0 82 Q 20 77 38 82 T 74 82 T 100 81 V100 H0 Z" fill="#090a20"/><path d="M0 91 Q 25 88 45 91 T 100 90 V100 H0 Z" fill="#050614"/></svg>`;
const cover = `data:image/svg+xml;base64,${Buffer.from(coverSvg).toString("base64")}#-large.jpg`;

const track = {
  id: 90210,
  title: "Ночной экспресс (Midnight Express)",
  artist: "лунный кот",
  user: { id: 17, username: "lunnykot", permalinkUrl: "https://soundcloud.com/lunnykot" },
  durationMs: 96000,
  artworkUrl: cover,
  waveformUrl: null,
  permalinkUrl: "https://soundcloud.com/lunnykot/midnight-express",
  playability: "ok",
};
const demoLyrics = {
  id: 7,
  artist: track.artist,
  title: track.title,
  synced: lyrics.synced,
  plain: lyrics.plain,
  instrumental: false,
  source: "community",
  by: "демо",
};

// the stub is written to its own file and loaded with a plain <script src>: the build's CSP allows same-origin
// scripts only, an inline script would be refused
const stub = `const TRACK = ${JSON.stringify(track)};
const LYRICS = ${JSON.stringify(demoLyrics)};
const page = (items) => ({ items, next: null });
const empty = page([]);
const routes = {
  "store:get": () => ({ prefs: {} }),
  "store:set": () => null,
  "app:info": () => ({ version: "2.6.1 (демо)", portable: false, packaged: false, logsDir: "/tmp", builtinProxy: false, proxyRoute: null, memorySaver: false, secretsPersist: true, graphics: { gpuCompositing: "enabled", webgl: "enabled" }, demo: true }),
  "auth:status": () => ({ mode: "public", user: null }),
  "quality:apply": () => null,
  "lyrics:get": () => LYRICS,
  "lyrics:search": () => [],
  "lyrics:pick": () => LYRICS,
  "lyrics:setOwn": () => null,
  "lyrics:suggestion": () => "",
  "lyrics:suggest": () => "pending",
  "lyricsSync:status": () => ({ name: "base", model: "missing", progress: 0, error: "", sizeMb: 145, busy: false }),
  "data:tracks": () => [TRACK],
  "data:stream": () => ({ url: "/demo.wav", protocol: "progressive", mime: "audio/wav", snipped: false }),
  "data:alternatives": () => [],
  "data:fetch": () => null,
  "data:resolve": () => null,
  "data:feed": () => empty,
  "data:likes": () => empty,
  "data:userLikes": () => empty,
  "data:playlists": () => empty,
  "data:userPlaylists": () => empty,
  "data:following": () => empty,
  "data:followings": () => empty,
  "data:userTracks": () => empty,
  "data:related": () => page([TRACK]),
  "data:search": () => empty,
  "data:track": () => null,
  "data:stats": () => ({ likes: 1284, reposts: 96, plays: 45210 }),
  "data:comments": () => empty,
  "data:user": () => null,
  "likes:list": () => [],
  "likes:set": () => null,
  "follows:list": () => [],
  "local:list": () => [],
  "room:state": () => ({ room: null, me: "", offset: 0, connected: false, closed: false }),
  "room:follow": () => null,
  "room:leave": () => null,
  "social:status": () => ({ available: true, profile: null }),
  "social:listening": () => [],
  "social:recent": () => [],
  "social:friends": () => [],
  "social:now": () => null,
  "social:poll": () => ({ messages: [], unread: {}, states: {}, now: {}, arrived: [], invites: [] }),
  "social:seen": () => null,
  "social:send": () => ({ id: 1 }),
  "ws:list": () => [],
  "ws:get": () => null,
  "backup:status": () => ({ available: false, key: null, at: null, error: null }),
  "update:check": () => ({ state: "idle" }),
  "hotkeys:suspend": () => null,
  "log:write": () => null,
  "shell:open": () => true,
  "clipboard:write": () => true,
  "win:minimize": () => null,
  "win:maximize": () => null,
  "win:close": () => null,
  "win:mini": () => null,
  "window:controls": () => null,
  "app:relaunch": () => null,
  "diag:report": () => null,
  "popup:state": () => null,
  "audio:started": () => null,
};
window.sky = {
  platform: "linux",
  invoke: (channel, ...args) => {
    const fn = routes[channel];
    return Promise.resolve().then(() => {
      if (!fn) { console.debug("[demo] unhandled channel:", channel); return { ok: true, data: null }; }
      return { ok: true, data: fn(...args) };
    });
  },
  on: () => () => {},
  pathOf: () => "",
};
// once the app is up, queue the demo track and open the full screen player (Autoplay is kept off: the browser
// refuses sound without a gesture — press Play)
const open = () => {
  const sc = window.__sc;
  if (!sc) return setTimeout(open, 150);
  try {
    sc.player.playFrom([TRACK], 0, { kind: "static" });
    sc.useUi.getState().openFull();
    sc.useUi.getState().setFullTab("lyrics");
  } catch (err) { console.warn("[demo]", err); }
};
window.addEventListener("load", open);
// the demo pointer, dismissable
window.addEventListener("load", () => {
  const el = document.createElement("div");
  el.innerHTML = '<span>Moonwave · демо караоке — нажми <b>Play</b>: слова подсветятся в такт</span><button aria-label="Скрыть" style="margin-left:10px;background:none;border:none;color:inherit;cursor:pointer;font-size:14px;line-height:1">✕</button>';
  el.style.cssText = "position:fixed;left:14px;bottom:14px;z-index:99999;display:flex;align-items:center;padding:8px 12px;border-radius:999px;background:rgba(10,10,16,0.82);color:#e8e6f2;font:13px/1.35 system-ui;border:1px solid rgba(255,255,255,0.12);backdrop-filter:blur(8px)";
  el.querySelector("button").addEventListener("click", () => el.remove());
  document.body.appendChild(el);
});
`;

rmSync(app, { recursive: true, force: true });
mkdirSync(app, { recursive: true });
cpSync(built, app, { recursive: true });
writeFileSync(join(app, "demo-stub.js"), stub);
const html = readFileSync(join(app, "index.html"), "utf8");
if (!html.includes("<head>")) throw new Error("index.html has no <head>");
writeFileSync(join(app, "index.html"), html.replace("<head>", `<head>\n<script src="/demo-stub.js"></script>`));
console.log("demo app written to", app);
