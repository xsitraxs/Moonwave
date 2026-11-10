import { sanitizeThemeCss, THEME_SCOPE } from "@shared/themeCss";

/**
 * A workshop theme's CSS, applied to the window.
 *
 * The server checks a sheet before it is published, but a theme published before that check existed (or by a version
 * that had a bug) is still out there, and an installed theme's sheet arrives over the network every time. So it is
 * sanitised here again, on this machine, and only what survives is put into the page — inside the element carrying
 * THEME_SCOPE, which is the app's shell: a theme can restyle what is in it, never anything outside.
 *
 * The sheet goes into a single `<style>` element owned by this module. It is replaced, not appended to, so applying
 * three themes in a row leaves one sheet behind.
 */

const OWNER = "data-theme-css";
let styleEl: HTMLStyleElement | null = null;

/** The `<style>` element the theme's sheet lives in, created on first use and kept for the window's lifetime. */
function styleElement(): HTMLStyleElement {
  if (styleEl?.isConnected) return styleEl;
  styleEl?.remove();
  const el = document.createElement("style");
  el.setAttribute(OWNER, "");
  // the scoped selectors the sanitiser writes start with THEME_SCOPE, so the sheet belongs right after the app's own
  document.head.appendChild(el);
  styleEl = el;
  return el;
}

/**
 * Puts a theme's CSS into the page, sanitised and scoped. Returns what was left out (the caller may show a note), and
 * an empty list when the whole sheet was usable. An empty or missing sheet removes the previous theme's.
 */
export function applyThemeCss(raw: string | null | undefined): { dropped: number } {
  const { css, dropped } = sanitizeThemeCss(raw ?? "");
  const el = styleElement();
  // textContent, never innerHTML: a `<` that got this far must not become markup
  el.textContent = css;
  return { dropped: dropped.length };
}

/** Removes the applied theme's sheet (Settings → Appearance → Reset, or a theme whose CSS turned out unusable). */
export function clearThemeCss() {
  styleEl?.remove();
  styleEl = null;
}

/** What the client's sanitiser keeps, for a test or a diagnostic: the scoped sheet, without touching the page. */
export function themeCssFor(raw: string | null | undefined): string {
  return sanitizeThemeCss(raw ?? "").css;
}

export { THEME_SCOPE };
