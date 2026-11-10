import assert from "node:assert/strict";
import { test } from "node:test";
import { ipOf, trustProxyFrom } from "../src/http.ts";

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
