import test from "node:test";
import assert from "node:assert/strict";
import { acceptsQuietly, beginWait, idleWait, isWaiting, newSignInState, sameState, WAIT_MS } from "./browser-signin-state.ts";

const NOW = 1_700_000_000_000;

test("a new wait hands out a fresh 128-bit state and ends in 15 minutes", () => {
  const a = beginWait(NOW);
  const b = beginWait(NOW);
  assert.match(a.state!, /^[0-9a-f]{32}$/);
  assert.notEqual(a.state, b.state);
  assert.equal(a.until, NOW + WAIT_MS);
  assert.equal(isWaiting(a, NOW), true);
  assert.equal(isWaiting(a, NOW + WAIT_MS - 1), true);
  assert.equal(isWaiting(a, NOW + WAIT_MS), false);
});

test("the idle wait never matches anything", () => {
  assert.equal(isWaiting(idleWait, NOW), false);
  assert.equal(acceptsQuietly(idleWait, newSignInState(), NOW), false);
});

test("a link with this wait's state is taken without a question", () => {
  const wait = beginWait(NOW);
  assert.equal(acceptsQuietly(wait, wait.state, NOW), true);
  assert.equal(acceptsQuietly(wait, wait.state, NOW + 60_000), true);
});

test("a link without a state, or with someone else's, asks first", () => {
  const wait = beginWait(NOW);
  assert.equal(acceptsQuietly(wait, null, NOW), false);
  // a state from an earlier session (the previous wait), or a page's own guess
  assert.equal(acceptsQuietly(wait, newSignInState(), NOW), false);
  assert.equal(acceptsQuietly(wait, "0".repeat(32), NOW), false);
});

test("a link that comes after the wait asks first, even with the right state", () => {
  const wait = beginWait(NOW);
  assert.equal(acceptsQuietly(wait, wait.state, NOW + WAIT_MS), false);
});

test("states of different lengths are refused rather than compared", () => {
  assert.equal(sameState("0123456789abcdef", "0123456789abcdef00"), false);
  assert.equal(sameState("0123456789abcdef0123456789abcdef", ""), false);
  assert.equal(sameState("0123456789abcdef0123456789abcdef", "0123456789abcdef0123456789abcdef"), true);
});
