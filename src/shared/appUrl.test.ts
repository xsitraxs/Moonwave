import assert from "node:assert/strict";
import { test } from "node:test";
import { isOwnIndexFile } from "./appUrl.ts";

const INDEX = "file:///app/out/renderer/index.html";

test("navigation: the app's own page is accepted, with or without a query/hash", () => {
  assert.equal(isOwnIndexFile(INDEX, INDEX), true);
  // the debug stores flag rides in the query string
  assert.equal(isOwnIndexFile(`${INDEX}?sc-debug`, INDEX), true);
  assert.equal(isOwnIndexFile(`${INDEX}#top`, INDEX), true);
});

test("navigation: any other file:// address is rejected — a page the app never shipped is not the app", () => {
  assert.equal(isOwnIndexFile("file:///etc/passwd", INDEX), false);
  assert.equal(isOwnIndexFile("file:///app/out/renderer/index2.html", INDEX), false);
  assert.equal(isOwnIndexFile("file:///app/out/renderer/index.html.evil", INDEX), false);
  assert.equal(isOwnIndexFile("file:///app/out/main/index.js", INDEX), false);
  // a prefix is not a match: the query must start at the boundary
  assert.equal(isOwnIndexFile(`${INDEX}evil`, INDEX), false);
});

test("navigation: remote, opaque and about URLs are rejected", () => {
  assert.equal(isOwnIndexFile("https://example.com/", INDEX), false);
  assert.equal(isOwnIndexFile("https://moonwave.example.com/out/renderer/index.html", INDEX), false);
  assert.equal(isOwnIndexFile("data:text/html,<h1>hi</h1>", INDEX), false);
  assert.equal(isOwnIndexFile("about:blank", INDEX), false);
  assert.equal(isOwnIndexFile("", INDEX), false);
});
