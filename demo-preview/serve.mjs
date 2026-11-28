// Static server for the demo preview: / -> /index.html?sc-debug, /demo.wav, /lyrics.json, everything else from app/
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, normalize, extname } from "node:path";

const DIR = new URL(".", import.meta.url).pathname;
const ROOT = DIR + "app";
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".wav": "audio/wav", ".map": "application/json", ".ico": "image/x-icon" };

createServer((req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://x");
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
    if (path === "/") {
      res.writeHead(302, { Location: "/index.html?sc-debug" });
      return res.end();
    }
    if (path === "/demo.wav") return sendFile(DIR + "demo.wav", req, res);
    if (path === "/lyrics.json") return sendFile(DIR + "lyrics.json", req, res);
    let file = join(ROOT, path);
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(ROOT, "index.html");
    sendFile(file, req, res);
  } catch (err) {
    console.error(err);
    res.writeHead(500);
    res.end("error");
  }
}).listen(4173, "0.0.0.0", () => console.log("demo preview on 0.0.0.0:4173"));

function sendFile(file, req, res) {
  const type = TYPES[extname(file)] ?? "application/octet-stream";
  const data = readFileSync(file);
  const range = req.headers.range;
  res.setHeader("Content-Type", type);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "no-store");
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    const start = m?.[1] ? Number(m[1]) : 0;
    const end = m?.[2] ? Math.min(Number(m[2]), data.length - 1) : data.length - 1;
    res.writeHead(206, { "Content-Range": `bytes ${start}-${end}/${data.length}`, "Content-Length": end - start + 1 });
    return res.end(data.subarray(start, end + 1));
  }
  res.writeHead(200, { "Content-Length": data.length });
  res.end(data);
}
