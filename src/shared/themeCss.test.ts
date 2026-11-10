import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeCssEscapes, MAX_THEME_CSS, sanitizeThemeCss, stripCssComments, themeCssProblems, THEME_SCOPE } from "./themeCss.ts";

/** What survived, for reading a failure quickly. */
const css = (input: string) => sanitizeThemeCss(input).css;
const reasons = (input: string) => sanitizeThemeCss(input).dropped.map((d) => d.reason).join(" | ");

test("a sober theme keeps its colours, glass and radii, scoped to the theme's container", () => {
  const out = css(".s-glass{background:rgba(14,14,17,.86);border-radius:10px;backdrop-filter:blur(30px)}");
  assert.match(out, new RegExp(`^${THEME_SCOPE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\.s-glass`));
  assert.match(out, /background: rgba\(14,14,17,.86\)/);
  assert.match(out, /border-radius: 10px/);
  assert.match(out, /backdrop-filter: blur\(30px\)/);
  assert.deepEqual(sanitizeThemeCss(".s-glass{color:#fff}").dropped, []);
});

test("a fixed overlay over the player is refused, and nothing else in the rule is lost", () => {
  const { css: out, dropped } = sanitizeThemeCss(".s-glass{position:fixed;top:0;color:#fff;z-index:2147483647}");
  assert.equal(out, "[data-theme-scope] .s-glass {\n  color: #fff;\n}");
  assert.ok(dropped.some((d) => /position/.test(d.reason)));
  assert.ok(dropped.some((d) => /z-index/.test(d.reason)));
});

test("a theme never places, sizes, orders or hides anything: the layout stays the app's (AUDIT F2)", () => {
  for (const decl of ["position:relative", "position:absolute", "position:sticky", "z-index:5", "top:-4px", "inset:0", "margin:0 0 0 -200px", "padding:900px", "width:0", "height:0", "max-height:0", "display:none", "visibility:hidden", "opacity:0", "transform:translateX(-4px)", "order:-1", "overflow:hidden", "flex:0", "gap:500px", "mix-blend-mode:difference", "font:0px onest,sans-serif"]) {
    assert.equal(css(`.a{${decl}}`), "", decl);
  }
});

test("content and pointer-events never get through", () => {
  assert.doesNotMatch(css('.a::before{content:"Delete"'), /content/);
  assert.ok(sanitizeThemeCss('.a::before{content:"x"}').dropped.some((d) => /content is not allowed/.test(d.reason)));
  assert.ok(sanitizeThemeCss(".a{pointer-events:none}").dropped.some((d) => /pointer-events is not allowed/.test(d.reason)));
});

test("urls, imports, fonts and images are refused after their escapes are decoded", () => {
  // \75 rl( is url( to a browser
  assert.equal(css(".a{background:\\75 rl(https://evil/x.png)}"), "");
  assert.ok(sanitizeThemeCss(".a{background:\\75 rl(https://evil/x.png)}").dropped.some((d) => /loads something/.test(d.reason)));
  // a comment inside the keyword
  assert.equal(css(".a{background:u/**/rl(https://evil/x.png)}"), "");
  assert.equal(css(".a{background:url(https://evil/x.png)}"), "");
  assert.equal(css("@im\\70 ort 'https://evil/x.css';"), "");
  assert.equal(css("@import url(x);"), "");
  assert.equal(css("@font-face{font-family:\"x\";src:url(x)}"), "");
  assert.equal(css(".a{background-image:image-set(url(x) 1x)}"), "");
  // a gradient is fine, an image is not
  assert.match(css(".a{background:linear-gradient(180deg,#000,#111)}"), /linear-gradient/);
});

test("html, body and :root are not selectors a theme may use", () => {
  assert.equal(css("body .a{color:red}"), "");
  assert.equal(css("html{color:red}"), "");
  assert.equal(css(":root{--x:1}"), "");
  // a class named like it is fine
  assert.match(css(".body-copy{color:#fff}"), /\.body-copy/);
});

test("@media is kept, nested @media is refused, and other at-rules are refused", () => {
  const out = css("@media (max-width: 900px){.s-side{color:#888}}");
  assert.match(out, /^@media \(max-width: 900px\)/);
  assert.match(out, /color: #888/);
  const nested = sanitizeThemeCss("@media (min-width:1px){@media (max-width:2px){.a{color:red}}}");
  assert.equal(nested.css, "");
  assert.ok(nested.dropped.some((d) => /nested too deeply/.test(d.reason)));
  assert.equal(css("@supports (display:grid){.a{color:red}}"), "");
  assert.equal(css("@charset \"utf-8\";"), "");
  // a refused at-rule does not take the theme's own rules with it
  assert.equal(css("@layer x;.a{color:red}"), css(".a{color:red}"));
  assert.deepEqual(sanitizeThemeCss("@layer x;.a{color:red}").dropped.map((d) => d.reason), ["@layer is not allowed"]);
});

test("@keyframes are kept and an animation may only name the theme's own", () => {
  const out = css("@keyframes pulse{from{color:#888}to{color:#fff}}.a{animation:pulse 2s ease-in-out infinite}");
  assert.match(out, /@keyframes pulse/);
  assert.match(out, /color: #888/);
  assert.match(out, /animation: pulse 2s ease-in-out infinite/);
  // an app animation is not the theme's to drive
  assert.doesNotMatch(css(".a{animation-name:sc-marker}"), /animation/);
  // and a keyframe that writes content is cut down to nothing
  assert.doesNotMatch(css("@keyframes x{to{content:\"x\";color:#fff}}"), /content/);
  // nor one that moves or hides what it animates
  assert.doesNotMatch(css("@keyframes x{to{opacity:0;transform:translateX(-9999px)}}"), /opacity|transform/);
});

test("a value with an unexpected function is dropped, with the function named", () => {
  assert.equal(css(".a{color:expression(alert(1))}"), "");
  assert.ok(/expression/.test(reasons(".a{color:expression(alert(1))}")));
  assert.equal(css(".a{background:linear-gradient(red,blue),element(#x)}"), "");
  assert.ok(/function element\(\) is not allowed/.test(reasons(".a{background:linear-gradient(red,blue),element(#x)}")));
});

test("fonts: only the app's own families (and the system stacks it already uses)", () => {
  assert.match(css('.a{font-family:"Onest",system-ui,sans-serif}'), /font-family/);
  assert.match(css(".a{font-family:Onest}"), /font-family: Onest/);
  assert.equal(css(".a{font-family:\"Comic Sans MS\",cursive}"), "");
  assert.ok(/font the app does not have/.test(reasons(".a{font-family:\"Comic Sans MS\",cursive}")));
  // naming a family the app has but smuggling a second one behind it
  assert.equal(css(".a{font-family:Onest,\"Arial Black\"}"), "");
});

test("unicode variations of a forbidden keyword are refused (full-width, confusable and escaped forms)", () => {
  // fullwidth letters are not CSS keywords at all: they are just an unusable value
  assert.equal(css(".a{position:ｆｉｘｅｄ}"), "");
  // a Cyrillic 'о' in "position" is a different property name, and the value behind it is a length
  assert.doesNotMatch(css(".а{position:fixed}"), /position/);
  // escapes spell fixed
  assert.equal(css(".a{position:\\66 ixed}"), "");
  assert.equal(css(".a{position:\\000066ixed}"), "");
  // case does not matter
  assert.equal(css(".a{PoSiTiOn:FiXeD}"), "");
  // a zero-width space splits the keyword: not a valid value, so dropped
  assert.equal(css(".a{position:fi\u200Bxed}"), "");
});

test("comments inside keywords and between a property and its value are read like a browser reads them", () => {
  assert.equal(stripCssComments("a{color:red/**/}"), "a{color:red}");
  assert.equal(css(".a{position:/**/fixed}"), "");
  assert.equal(css(".a{posi/**/tion:fixed}"), "");
  // an unterminated comment eats the rest, so nothing after it applies
  assert.equal(css(".a{color:red}.b{position:fixed}/*"), css(".a{color:red}.b{position:fixed}"));
});

test("huge values are refused; a huge sheet is refused whole", () => {
  const long = `.a{background:linear-gradient(${"#111,".repeat(500)}#222)}`;
  assert.equal(css(long), "");
  assert.ok(/longer than 1000/.test(reasons(long)));
  const huge = `.a{color:red}` + " ".repeat(MAX_THEME_CSS);
  assert.deepEqual(sanitizeThemeCss(huge), { css: "", dropped: [{ where: "theme", reason: `longer than ${MAX_THEME_CSS} characters` }] });
});

test("the result is always a sheet a theme scope can hold: every top-level selector starts with the scope", () => {
  const sheet = [
    ".a{color:#fff}",
    ".b,.c{color:#aaa}",
    "@media (min-width: 600px){.d{color:red}}",
    "@keyframes k{to{color:#fff}}",
    ".e{animation:k 1s linear}",
  ].join("\n");
  const out = css(sheet);
  for (const block of out.split("@keyframes")[0]!.split("@media")[0]!.split("\n").filter((l) => l.includes("{"))) {
    assert.ok(block.startsWith(THEME_SCOPE), `not scoped: ${block}`);
  }
  assert.match(out, /@media \(min-width: 600px\) \{\n\s+\[data-theme-scope\] \.d/);
});

test("a broken sheet loses its broken parts and keeps the rest; the parser never throws", () => {
  for (const broken of ["}}}", "{{{", ".a{", "a{;}", "@", "@media", ".a{color}", "\\", ".a{content:'\\'}", "@keyframes x{", ".".repeat(500)]) {
    assert.doesNotThrow(() => sanitizeThemeCss(broken), broken);
  }
  const out = css(".a{color:#fff}.b{position:fixed}.c{color:#aaa}");
  assert.match(out, /\.a/);
  assert.doesNotMatch(out, /\.b\b/);
  assert.match(out, /\.c/);
});

test("themeCssProblems lists what a publication would be refused for", () => {
  assert.deepEqual(themeCssProblems(""), []);
  assert.deepEqual(themeCssProblems(undefined), []);
  assert.deepEqual(themeCssProblems(42), ["css must be text"]);
  assert.deepEqual(themeCssProblems(".a{color:#fff}"), []);
  const problems = themeCssProblems(".a{position:fixed;color:#fff}");
  assert.equal(problems.length, 1);
  assert.match(problems[0]!, /^\.a: property position is not allowed/);
});

test("escapes decode the way a browser decodes them", () => {
  assert.equal(decodeCssEscapes("\\75 rl"), "url");
  assert.equal(decodeCssEscapes("\\000075rl"), "url");
  assert.equal(decodeCssEscapes("\\0"), "\uFFFD");
  assert.equal(decodeCssEscapes("a\\\nb"), "ab");
  assert.equal(decodeCssEscapes("\\{" ), "{");
});

test("the golden themes: a workshop theme built from the app's own design survives intact", () => {
  // these are the kinds of rules the studio design itself uses (styles/studio.css), written the way a theme author would
  const golden = `
    .s-glass { background: rgba(14, 14, 17, 0.86); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 10px;
               box-shadow: 0 18px 50px rgba(0, 0, 0, 0.5); backdrop-filter: blur(30px) saturate(1.2); }
    .s-btn { color: #ececef; font-family: "Onest", system-ui, sans-serif; font-weight: 600; letter-spacing: -0.003em; }
    .s-row:hover { background: rgba(255, 255, 255, 0.05); transition: background 0.15s ease-out; }
    .s-side { background: linear-gradient(180deg, #16161a, #0e0e11); border-radius: 9999px; line-height: 1.4; font-size: 13px; }
    @media (max-width: 900px) { .s-side { color: #a0a0a8; } }
    @keyframes breathe { from { color: #888; } to { color: #fff; } }
    .s-card { --accent: #ff5500; --accent-rgb: 255, 85, 0; --glass: rgba(20, 20, 24, 0.7); --text: var(--paper); }
    .s-np { animation: breathe 4s ease-in-out infinite alternate; }
  `;
  const { css: out, dropped } = sanitizeThemeCss(golden);
  assert.deepEqual(dropped, [], "a theme in the app's own design language must not lose a line");
  assert.match(out, /backdrop-filter: blur\(30px\) saturate\(1.2\)/);
  assert.match(out, /box-shadow: 0 18px 50px rgba\(0, 0, 0, 0.5\)/);
  assert.match(out, /animation: breathe 4s ease-in-out infinite alternate/);
});

test("attacks that dress up the interface: overlays, disguised buttons, and hiding the app's own chrome", () => {
  // a full-window scrim that swallows clicks on the player
  assert.doesNotMatch(css(".x{position:fixed;inset:0;z-index:9;background:#000}"), /fixed/);
  // a fake "Sign in" button painted over the real one
  const fake = css('.x::after{content:"Sign in with SoundCloud";position:absolute;background:#f00}');
  assert.doesNotMatch(fake, /content:/);
  // the theme's container cannot be pushed off-screen to leave a bare background where the app should be
  assert.equal(css(".x{top:-9999px}"), "");
  assert.equal(css(".x{transform:translate(999999px)}"), "");
});

test("what is left can't hide or bury a button either: type, filters, variables, borders and shadows are bounded", () => {
  // text too small to see, or spaced off its button
  for (const v of ["font-size:0", "font-size:1px", "font-size:0.1rem", "font-size:200px", "letter-spacing:500px", "word-spacing:-900px", "text-indent:-9999px", "line-height:0", "line-height:0.1", "line-height:500px"]) {
    assert.equal(css(`.a{${v}}`), "", v);
  }
  for (const v of ["font-size:13px", "font-size:0.875rem", "font-size:120%", "letter-spacing:-0.01em", "line-height:1.5", "line-height:normal", "line-height:20px"]) {
    assert.notEqual(css(`.a{${v}}`), "", v);
  }
  // an invisible button that still takes the click
  assert.equal(css(".a{filter:opacity(0)}"), "");
  assert.equal(css(".a{filter:brightness(0)}"), "");
  assert.equal(css(".a{backdrop-filter:opacity(0)}"), "");
  assert.match(css(".a{backdrop-filter:blur(20px) saturate(1.4)}"), /backdrop-filter/);
  // the app's own variables size and move things: a theme gives them colours only
  for (const v of ["--k:0", "--rest:9999px", "--r:0", "--drift-dur:0s", "--font-sans:x", "--x:none"]) assert.equal(css(`.a{${v}}`), "", v);
  for (const v of ["--accent:#f50", "--accent-rgb:255, 85, 0", "--glass:rgba(0,0,0,.5)", "--text:var(--paper)", "--line:hsl(0 0% 100% / 8%)"]) assert.notEqual(css(`.a{${v}}`), "", v);
  // a border or a shadow wide enough to paint over the neighbours
  assert.equal(css(".a{border:4000px solid #000}"), "");
  assert.equal(css(".a{box-shadow:0 0 0 4000px #000}"), "");
  assert.equal(css(".a{outline-offset:-500px}"), "");
  assert.match(css(".a{border:1px solid rgba(255,255,255,.08);box-shadow:0 18px 50px rgba(0,0,0,.5)}"), /border: 1px solid/);
});

test("a theme cannot smuggle a rule or an @import through a quoted brace or a stray closing brace", () => {
  // the brace inside the string does not end the block, and the declaration is refused for its content
  const quoted = sanitizeThemeCss('.a{content:"}@import url(x);/*"}.b{color:#fff}');
  assert.doesNotMatch(quoted.css, /@import/);
  assert.match(quoted.css, /\.b/);
  assert.match(quoted.css, /color: #fff/);
  // a stray closing brace leaves the sheet readable: the rule after it still applies, the @import does not
  assert.equal(css('}@import url("x");.a{color:red}'), css(".a{color:red}"));
});

test("an animation is bounded: the keyframes may stay, an attempted flash speed may not", () => {
  // a 200 s fade is outside what a theme may run: the declaration goes, the (harmless) keyframes may stay unused
  assert.doesNotMatch(css("@keyframes flash{to{color:#000}}.x{animation:flash 200s}"), /animation:/);
  assert.match(css("@keyframes glow{to{color:#fff}}.x{animation:glow 2s linear infinite}"), /animation: glow 2s linear infinite/);
});
