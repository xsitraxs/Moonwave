import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanThemeLook, type ThemeLook } from "./social.ts";

const fallback: ThemeLook = { design: "studio", bg: "liquid", bgBlur: 14, bgDim: 72, bgReact: 40, panelOpacity: 58, panelBlur: 30, accent: "", surface: "" };

test("a theme's look keeps only the knobs a theme sets, each in its range", () => {
  const look = cleanThemeLook(
    { design: "og", bg: "file", bgBlur: 400, bgDim: -5, bgReact: 12.6, panelOpacity: 0, panelBlur: "30", accent: "#A1b2C3", surface: "red; background: url(https://evil.example/x)", css: ".a{}", bgFile: "../../x", lite: true, proxy: "x" },
    fallback,
  );
  assert.deepEqual(look, { design: "studio", bg: "file", bgBlur: 40, bgDim: 0, bgReact: 13, panelOpacity: 10, panelBlur: 30, accent: "#A1b2C3", surface: "" });
  assert.equal("css" in look || "bgFile" in look || "lite" in look, false);
});

test("nothing usable falls back to this machine's look", () => {
  assert.deepEqual(cleanThemeLook(null, fallback), fallback);
  assert.deepEqual(cleanThemeLook({ bg: "javascript:", bgBlur: NaN }, fallback), fallback);
});
