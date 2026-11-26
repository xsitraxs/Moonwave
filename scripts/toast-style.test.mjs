import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const toast = readFileSync(new URL("../src/renderer/src/components/ui/Toast.tsx", import.meta.url), "utf8");
const studio = readFileSync(new URL("../src/renderer/src/styles/studio.css", import.meta.url), "utf8");

test("Studio toasts have an opaque surface over controls behind them", () => {
  assert.match(toast, /className="[^"]*toast-notice[^"]*"/, "the toast must use its own surface class");
  assert.match(studio, /html\[data-design="studio"\] \.toast-notice\s*\{[^}]*background:\s*var\(--surface-3\);/, "Studio must override translucent paper-fill on the toast");
  assert.match(studio, /--surface-3:\s*#[\da-fA-F]{6};/, "the chosen Studio surface must be opaque");
});
