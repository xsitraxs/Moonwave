#!/usr/bin/env node
/**
 * Tiny loopback-only static file server for CI.
 *
 * Serves the pre-fetched, checksum-verified Electron dist files (see scripts/prefetch-tools.sh)
 * to electron-builder when github.com's release-asset CDN is unhealthy (it returned HTTP 504 to
 * every CI runner on 2026-11-08). electron-builder always re-fetches SHASUMS256.txt — even on a
 * full cache hit — so merely populating the cache is not enough; this server answers those
 * requests from 127.0.0.1 instead of the flaky CDN.
 *
 * Trust properties (deliberately strict):
 *   - binds 127.0.0.1 only — never reachable off-host;
 *   - serves exclusively the regular files under --root, resolved against path traversal;
 *   - no directory listings, no writes, no methods other than GET/HEAD;
 *   - the files served are the official Electron artifacts, verified by prefetch-tools.sh
 *     against the official SHASUMS256.txt moments before the server starts, and they are
 *     re-validated by @electron/get/sumchecker against that same SHASUMS256.txt on download;
 *   - no TLS setting is weakened or bypassed anywhere (loopback HTTP needs no certificate).
 */
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
function opt(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const root = path.resolve(opt('root', path.join(fileURLToPath(new URL('..', import.meta.url)), '.ci-electron-mirror')));
const port = Number(opt('port', '8137'));
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`invalid --port: ${opt('port', '8137')}`);
  process.exit(2);
}

const TYPES = new Map([
  ['.zip', 'application/zip'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.yml', 'text/yaml; charset=utf-8'],
  ['.blockmap', 'application/octet-stream'],
  ['.gz', 'application/gzip'],
  ['.7z', 'application/x-7z-compressed'],
]);
const contentType = (file) => {
  const base = file.toLowerCase();
  for (const [ext, type] of TYPES) if (base.endsWith(ext)) return type;
  return 'application/octet-stream';
};

const server = http.createServer((req, res) => {
  void (async () => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405).end();
        return;
      }
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      let pathname;
      try {
        pathname = decodeURIComponent(url.pathname);
      } catch {
        res.writeHead(400).end();
        return;
      }
      // resolve against root and refuse anything that escapes it
      const file = path.resolve(root, `.${pathname.split(path.posix.sep).join(path.sep)}`);
      if (file !== root && !file.startsWith(root + path.sep)) {
        res.writeHead(403).end();
        return;
      }
      const st = await stat(file).catch(() => null);
      if (!st || !st.isFile()) {
        res.writeHead(404).end('not found');
        return;
      }
      res.writeHead(200, {
        'Content-Length': st.size,
        'Content-Type': contentType(file),
        'Cache-Control': 'no-store',
      });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      createReadStream(file).pipe(res);
    } catch (err) {
      console.error('mirror error:', err);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  })();
});

server.listen(port, '127.0.0.1', () => {
  console.log(`serving ${root} on http://127.0.0.1:${port}`);
});
