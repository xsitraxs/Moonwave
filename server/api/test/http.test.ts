import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { test } from "node:test";
import { HttpError, ipOf, readBody, send, trustProxyFrom } from "../src/http.ts";

// A client must not be able to choose the bucket its rate limits are counted in: behind no proxy (or a proxy that
// does not set X-Forwarded-For) the header is whatever the client sent, so it is ignored unless the deployment opts in.
const req = (headers: Record<string, string>) => ({ headers, socket: { remoteAddress: "192.0.2.9" } });

test("X-Forwarded-For is off unless the deployment asks for it in so many words", () => {
  for (const v of [undefined, "", "0", "false", "no", "yes", "2", " 1", "1 "]) {
    assert.equal(trustProxyFrom(v), false, `TRUST_PROXY=${JSON.stringify(v)} must not trust the header`);
  }
  for (const v of ["1", "true"]) assert.equal(trustProxyFrom(v), true);
});

test("with no proxy trusted, the direct peer is the address and the header is ignored", () => {
  const r = req({ "x-forwarded-for": "203.0.113.7" });
  assert.equal(ipOf(r as never, false), "192.0.2.9");
});

test("behind the proxy, the first hop of the header wins", () => {
  assert.equal(ipOf(req({ "x-forwarded-for": "203.0.113.7, 10.0.0.2" }) as never, true), "203.0.113.7");
  // Caddy was not configured to forward, or the request came from something else on the network: fall back to the peer
  assert.equal(ipOf(req({}) as never, true), "192.0.2.9");
});

/** A server whose only route reads the body with a small limit: a 413 is written the way main.ts writes errors. */
async function bodyServer(limit: number) {
  const server = createServer(async (req, res) => {
    try {
      const body = await readBody(req, limit);
      send(res, 200, { bytes: body.length });
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      throw e;
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections(); // a kept-alive connection from a passing case would hold server.close() open
        server.close(() => resolve());
      }),
  };
}

/** Sends `body` (chunked when `declared` is false) and reports the answer and whether the socket then closed. */
function post(port: number, body: Buffer, declared: boolean) {
  return new Promise<{ status: number; text: string; connection: string; closed: boolean }>((resolve, reject) => {
    const req = request(
      // agent: false — a one-shot socket, so a kept-alive one cannot keep this test (or the server) open
      { host: "127.0.0.1", port, method: "POST", path: "/", agent: false, headers: declared ? { "content-length": String(body.length) } : {} },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (text += chunk));
        res.on("end", () => {
          const done = () => resolve({ status: res.statusCode ?? 0, text, connection: String(res.headers.connection ?? ""), closed: true });
          if (res.socket?.destroyed) done();
          else res.socket?.once("close", done);
        });
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

test("a body past the limit is answered 413 and the connection is closed", async () => {
  const { port, close } = await bodyServer(64);
  try {
    const answer = await post(port, Buffer.alloc(256 * 1024, 0x61), true);
    assert.equal(answer.status, 413, "the declared size is refused before anything is buffered");
    assert.match(answer.text, /too large/);
    assert.equal(answer.connection, "close", "the connection is not reused");
    assert.equal(answer.closed, true, "the socket closes with the answer");
  } finally {
    await close();
  }
});

test("a chunked body that grows past the limit is drained, then answered 413", async () => {
  const { port, close } = await bodyServer(64);
  try {
    // nothing declares the size: the limit is hit while the body is arriving, and the rest must not be left unread
    const answer = await post(port, Buffer.alloc(256 * 1024, 0x62), false);
    assert.equal(answer.status, 413);
    assert.equal(answer.closed, true);
  } finally {
    await close();
  }
});

test("a body within the limit still arrives whole", async () => {
  const { port, close } = await bodyServer(64);
  try {
    const answer = await post(port, Buffer.alloc(64, 0x63), true);
    assert.deepEqual(JSON.parse(answer.text), { bytes: 64 });
    assert.equal(answer.status, 200);
  } finally {
    await close();
  }
});
