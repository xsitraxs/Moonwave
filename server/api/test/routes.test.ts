/**
 * The API's doors, checked through a real HTTP server: who may read or change what, and where the limits are. Each
 * request picks its own client address (the rate-limit buckets are per address and live for the whole file), and the
 * database is a throwaway folder, so nothing here touches real data.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { HttpError, send } from "../src/http.ts";

// db.ts reads DATA_DIR when it is first imported: set it before routing is loaded
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "moonwave-routes-"));
const { route } = await import("../src/routes.ts");

const server = createServer(async (req, res) => {
  try {
    await route({ req, res, ip: String(req.headers["x-test-ip"] ?? "192.0.2.1") });
  } catch (e) {
    if (res.headersSent) return void res.destroy();
    if (e instanceof HttpError) return send(res, e.status, { error: e.message });
    console.error(e);
    send(res, 500, { error: "server error" });
  }
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

after(() => {
  server.closeAllConnections();
  server.close();
  rmSync(process.env.DATA_DIR!, { recursive: true, force: true });
});

let n = 0;
/** an address no other request in this file uses */
const freshIp = () => `10.1.${Math.floor(++n / 250)}.${n % 250}`;

async function api(
  method: string,
  path: string,
  opts: { ip?: string; secret?: string; admin?: string; write?: string; body?: unknown; raw?: Buffer } = {},
) {
  const headers: Record<string, string> = { "x-test-ip": opts.ip ?? freshIp() };
  if (opts.secret) headers.authorization = `Bearer ${opts.secret}`;
  if (opts.admin !== undefined) headers.authorization = `Admin ${opts.admin}`;
  if (opts.write !== undefined) headers["x-backup-write"] = opts.write;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const r = await fetch(BASE + path, {
    method,
    headers,
    body: opts.raw ? new Uint8Array(opts.raw) : opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await r.text();
  return { status: r.status, body: text && r.headers.get("content-type")?.includes("json") ? JSON.parse(text) : text };
}

async function device(name = "") {
  const r = await api("POST", "/v1/register", { body: { name } });
  assert.equal(r.status, 201);
  return r.body as { code: string; secret: string; name: string };
}

/** everything look() asks for, at its plainest */
const LOOK = {
  design: "studio",
  bg: "none",
  bgBlur: 0,
  bgDim: 0,
  bgReact: 0,
  panelOpacity: 100,
  panelBlur: 0,
  neutralBg: false,
  accent: "",
  surface: "",
};
/** the first eight bytes of a PNG: enough for the type sniff */
const PNG = Buffer.from("89504e470d0a1a0a", "hex");
const SEALED = Buffer.concat([Buffer.from("SCB1"), Buffer.alloc(40)]);

test("a device the server doesn't know is refused with 401", async () => {
  assert.equal((await api("GET", "/v1/me", { secret: "n".repeat(43) })).status, 401, "a secret nobody has");
  assert.equal((await api("GET", "/v1/me")).status, 401, "no secret at all");
  assert.equal((await api("GET", "/v1/friends", { secret: "short" })).status, 401, "too short to be one");
  const a = await device("someone");
  assert.equal((await api("GET", "/v1/me", { secret: a.secret })).status, 200, "a real one still works");
});

test("another device's theme can be neither given a background nor deleted (403)", async () => {
  const owner = await device("owner");
  const other = await device("other");
  const made = await api("POST", "/v1/themes", { secret: owner.secret, body: { name: "Mine", description: "", look: LOOK, css: "" } });
  assert.equal(made.status, 201);
  const id = (made.body as { id: string }).id;

  assert.equal((await api("PUT", `/v1/themes/${id}/background`, { secret: other.secret, raw: PNG })).status, 403);
  assert.equal((await api("DELETE", `/v1/themes/${id}`, { secret: other.secret })).status, 403);

  // the owner may, so the 403 was about who asked and not about the route
  assert.equal((await api("PUT", `/v1/themes/${id}/background`, { secret: owner.secret, raw: PNG })).status, 204);
  assert.equal((await api("DELETE", `/v1/themes/${id}`, { secret: owner.secret })).status, 204);
});

test("registering is limited to five an hour per address (429)", async () => {
  const ip = freshIp();
  for (let i = 0; i < 5; i++) assert.equal((await api("POST", "/v1/register", { ip, body: {} })).status, 201, `register ${i + 1}`);
  assert.equal((await api("POST", "/v1/register", { ip, body: {} })).status, 429, "the sixth is over the limit");
  assert.equal((await api("POST", "/v1/register", { body: {} })).status, 201, "another address is not affected");
});

test("a device's own requests are limited too (429)", async () => {
  const a = await device("busy");
  let status = 0;
  // 600 a minute per device, whatever route: every request comes from its own address, so the per-address limit (300)
  // can't be what stops this one
  for (let i = 0; i < 601 && status !== 429; i++) status = (await api("GET", "/v1/me", { secret: a.secret })).status;
  assert.equal(status, 429);
});

test("an admin token shorter than 24 characters never opens the moderation routes", async () => {
  const kept = process.env.ADMIN_TOKEN;
  try {
    process.env.ADMIN_TOKEN = "short-admin-token";
    assert.equal((await api("GET", "/v1/admin/themes", { admin: "short-admin-token" })).status, 404, "the right value, but too short");
    assert.equal((await api("GET", "/v1/admin/themes", { admin: "short-admin-token-longer" })).status, 404);

    const long = "long-enough-admin-token-0123456789"; // 34 characters
    process.env.ADMIN_TOKEN = long;
    assert.equal((await api("GET", "/v1/admin/themes", { admin: long })).status, 200, "a long one works");
    assert.equal((await api("GET", "/v1/admin/themes", { admin: "x".repeat(long.length) })).status, 404, "a wrong one does not");
  } finally {
    if (kept === undefined) delete process.env.ADMIN_TOKEN;
    else process.env.ADMIN_TOKEN = kept;
  }
});

test("a backup belongs to the write token that put it there (403)", async () => {
  const id = "a".repeat(64);
  const token = "1".repeat(64);
  assert.equal((await api("PUT", `/v1/backup/${id}`, { write: token, raw: SEALED })).status, 204);

  const taken = await api("PUT", `/v1/backup/${id}`, { write: "2".repeat(64), raw: Buffer.concat([Buffer.from("SCB1"), Buffer.alloc(64, 0x41)]) });
  assert.equal(taken.status, 403, "another write token cannot replace it");

  const got = Buffer.from(await (await fetch(`${BASE}/v1/backup/${id}`)).arrayBuffer());
  assert.deepEqual(got, SEALED, "the copy is still the one the first token put there");
});

test("a put with a wrong write token is refused with 401", async () => {
  const id = "b".repeat(64);
  assert.equal((await api("PUT", `/v1/backup/${id}`, { raw: SEALED })).status, 401, "no token");
  assert.equal((await api("PUT", `/v1/backup/${id}`, { write: "not hex at all", raw: SEALED })).status, 401, "not a token's shape");
  assert.equal((await api("PUT", `/v1/backup/${id}`, { write: "1".repeat(63), raw: SEALED })).status, 401, "one character short");
  assert.equal((await api("PUT", `/v1/backup/${id}`, { write: "1".repeat(64), raw: Buffer.from("not a sealed copy") })).status, 400, "a token alone is not enough");
});
