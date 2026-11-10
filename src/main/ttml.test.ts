import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeEntities, MAX_TTML, parseTime, parseTtml, wordTimed } from "./ttml.ts";

test("times in every TTML form", () => {
  assert.equal(parseTime("00:01:30.500"), 90.5);
  assert.equal(parseTime("1:16.656"), 76.656);
  assert.equal(parseTime("12.5"), 12.5);
  assert.equal(parseTime("12.5s"), 12.5);
  assert.ok(Number.isNaN(parseTime("soon")));
});

test("entities", () => {
  assert.equal(decodeEntities("rock &amp; roll &#39;n&#x27; &quot;x&quot;"), `rock & roll 'n' "x"`);
});

test("word-timed lines keep their spaces and background vocals", () => {
  const ttml = `<tt><body><div><p begin="0:05.000" end="0:07.000" ttm:agent="v1"><span begin="0:05.000" end="0:05.500">word </span><span begin="0:05.500" end="0:06.000">one</span> <span ttm:role="x-bg"><span begin="0:06.000" end="0:07.000">(echo)</span></span></p><p begin="0:08.000" end="0:09.000"><span begin="0:08.000" end="0:08.400">be</span><span begin="0:08.400" end="0:09.000">cause</span></p></div></body></tt>`;
  const lines = parseTtml(ttml);
  assert.equal(lines.length, 2);
  assert.equal(lines[0]!.text, "word one (echo)");
  assert.deepEqual(
    lines[0]!.words!.map((w) => [w.t, w.text, !!w.bg]),
    [
      [5, "word ", false],
      [5.5, "one ", false],
      [6, "(echo)", true],
    ],
  );
  // syllables of one word stay together
  assert.equal(lines[1]!.text, "because");
  assert.ok(wordTimed(lines));
});

test("line-timed lines", () => {
  const lines = parseTtml(`<tt><body><div><p begin="00:00:01.320" end="00:00:03.410">I&apos;ve been so sober</p></div></body></tt>`);
  assert.deepEqual(lines, [{ t: 1.32, end: 3.41, text: "I've been so sober" }]);
  assert.equal(wordTimed(lines), false);
});

test("a hostile document can't hold the main process: unclosed lines, deep nesting, a huge size", () => {
  const time = (doc: string) => {
    const t = performance.now();
    parseTtml(doc);
    return performance.now() - t;
  };
  // half a megabyte of lines that never close took 2.6 s with the old pattern, and grew with the square of the size
  assert.ok(time("<body>" + '<p begin="1">'.repeat(40_000)) < 200);
  // spans nested 40 000 deep, each with text after it
  assert.ok(time('<body><p begin="1">' + '<span begin="1">a<i/>'.repeat(40_000) + "</p>") < 500);
  // past the size limit nothing is read at all
  assert.deepEqual(parseTtml(`<body><p begin="1">x</p>${" ".repeat(MAX_TTML)}`), []);
});

test("other tags starting with p are not lines; lines around them still are", () => {
  const lines = parseTtml('<body><param name="x"><pre>no</pre><p begin="1" end="2">one</p><p begin="3" end="4">two</p></body>');
  assert.deepEqual(
    lines.map((l) => l.text),
    ["one", "two"],
  );
});
