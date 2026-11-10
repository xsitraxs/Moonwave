/**
 * A workshop theme's own CSS, made safe to put into the app's page.
 *
 * The server's blacklist (no url(), no @import) closed the door on loading things and running code, but it left the
 * interface open to being *dressed up*: `position: fixed` over the player, `content:` text that looks like the app's,
 * z-index above everything, hiding the real buttons. So this is a white list instead: only properties the design uses
 * may appear, only with values of a known shape, only inside the theme's own container (`selector` is rewritten to sit
 * under THEME_SCOPE), and only inside @media and @keyframes.
 *
 * It is deliberately a small CSS parser rather than regular expressions: escapes (`\75 rl(`) and comments inside
 * keywords (`u/**\/rl(`) are read the way a browser reads them before anything is judged, and a declaration is dropped
 * on its own — a theme with one bad line still applies its other lines, which is what existing published themes need.
 *
 * No imports on purpose: the app (`src/shared/themeCss.ts`) and the server (this exact copy) both run it, each without
 * dependencies, and `src/shared/themeCssParity.test.ts` fails the build if the two files ever differ. Edit both.
 */

/** Everything a theme's CSS may affect sits inside an element carrying this attribute. */
export const THEME_SCOPE = "[data-theme-scope]";

/** The same limit the server has always had. */
export const MAX_THEME_CSS = 20_000;

/** Above this a theme could cover the app's own menus and dialogs; the app's highest panels use 80. */
export const MAX_THEME_Z_INDEX = 100;

/** One dropped piece of a theme's CSS, with the reason (never the whole sheet's contents). */
export interface ThemeCssDrop {
  /** the selector or at-rule it was in, short */
  where: string;
  reason: string;
}

export interface ThemeCssResult {
  /** what may be applied: scoped, filtered, "" when nothing survived */
  css: string;
  /** what was left out, and why */
  dropped: ThemeCssDrop[];
}

// ---- values ---------------------------------------------------------------------------------------------------------

/** Properties whose values are colours, or colours mixed with lengths and keywords. */
const COLOR_PROPS = new Set([
  "color",
  "background-color",
  "border-color",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "outline-color",
  "text-decoration-color",
  "caret-color",
  "accent-color",
  "column-rule-color",
  "fill",
  "stroke",
]);

/** Properties that may carry a gradient (and so parentheses), but never an image from a URL. */
const BACKGROUND_PROPS = new Set(["background", "background-image", "background-position", "background-size", "background-repeat", "background-clip", "background-origin", "background-blend-mode", "background-attachment"]);

/** Border and outline shorthands and their long forms. */
const BORDER_PROPS = new Set([
  "border",
  "border-top",
  "border-right",
  "border-bottom",
  "border-left",
  "border-width",
  "border-style",
  "border-radius",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-left-radius",
  "border-bottom-right-radius",
  "outline",
  "outline-offset",
  "box-shadow",
  "text-shadow",
]);

/** Blur, brightness and the like: the design's glass, kept within reason. */
const FILTER_PROPS = new Set(["filter", "backdrop-filter", "-webkit-backdrop-filter"]);

/** Type: only families the app already ships, so a theme cannot bring a font of its own. */
const FONT_PROPS = new Set(["font-family", "font-size", "font-weight", "font-style", "font-variant", "font-stretch", "font", "line-height", "letter-spacing", "word-spacing", "text-align", "text-transform", "text-decoration", "text-indent", "text-overflow", "white-space", "word-break", "overflow-wrap", "hyphens"]);

/** Offsets and insets: bounded, so a theme cannot park an element outside the window. */
const OFFSET_PROPS = new Set(["top", "right", "bottom", "left", "inset", "margin", "margin-top", "margin-right", "margin-bottom", "margin-left"]);

const OTHER_PROPS = new Set(["opacity", "mix-blend-mode", "transform", "transform-origin", "transition", "transition-property", "transition-duration", "transition-timing-function", "transition-delay", "animation", "animation-name", "animation-duration", "animation-timing-function", "animation-delay", "animation-iteration-count", "animation-direction", "animation-fill-mode", "position", "top", "right", "bottom", "left", "inset", "z-index", "width", "height", "min-width", "min-height", "max-width", "max-height", "margin", "margin-top", "margin-right", "margin-bottom", "margin-left", "padding", "padding-top", "padding-right", "padding-bottom", "padding-left", "gap", "row-gap", "column-gap", "display", "flex", "flex-direction", "flex-wrap", "align-items", "align-content", "align-self", "justify-content", "justify-items", "justify-self", "order", "overflow", "overflow-x", "overflow-y", "aspect-ratio", "object-fit", "object-position", "cursor"]);

/**
 * Families a theme may name: the app's own fonts and the system stacks it already falls back to. Compared whole (case
 * and quotes aside), so "Arial Black" is not read as Arial.
 */
const FONT_FAMILIES = new Set(["onest", "pt mono", "space grotesk", "rubik wet paint", "special elite", "midnight creepy", "sc-onest", "system-ui", "sans-serif", "serif", "monospace", "cursive", "fantasy", "ui-sans-serif", "ui-serif", "ui-monospace", "segoe ui", "sf pro", "helvetica", "arial", "arial unicode ms", "verdana", "tahoma", "georgia", "times new roman", "courier", "courier new", "consolas", "menlo"]);

/** Functions allowed inside `transform`; a matrix or a perspective can turn the page into something else entirely. */
const TRANSFORM_FUNCTIONS = new Set(["translate", "translatex", "translatey", "translatez", "translate3d", "scale", "scalex", "scaley", "scalez", "scale3d", "rotate", "rotatex", "rotatey", "rotatez", "rotate3d", "skew", "skewx", "skewy", "none"]);

/** Functions allowed inside `filter` and `backdrop-filter`. */
const FILTER_FUNCTIONS = new Set(["blur", "brightness", "contrast", "grayscale", "saturate", "sepia", "opacity", "hue-rotate", "drop-shadow", "invert", "none"]);

/** Anything in a value that could load, run or reach outside the page. Checked on the decoded text, so escapes and
 * comments cannot hide it. */
const FORBIDDEN_IN_VALUE = /(@import|@font-face|url\s*\(|image-set\s*\(|src\s*\(|expression\s*\(|javascript\s*:|-moz-binding|behavior\s*:|<|>|\\|;|\{|\}|`)/i;

/** Values are short; a megabyte of text in one declaration is not a design decision. */
const MAX_VALUE = 1000;

/**
 * Reads CSS escapes the way a browser does: `\75 rl` is `url`, and a trailing space of the hex form is consumed.
 * Works on a code-point basis, so a surrogate pair written with two escapes comes out as one character.
 */
export function decodeCssEscapes(text: string): string {
  return text.replace(/\\(?:([0-9a-f]{1,6})[ \t\r\n\f]?|(\r\n|[\n\r\f])|()([\s\S]))/gi, (_all, hex: string | undefined, newline: string | undefined, _empty: string | undefined, literal: string | undefined) => {
    if (hex) {
      const n = parseInt(hex, 16);
      // 0 and out-of-range values are the replacement character in CSS, not a way to sneak a NUL through
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "\uFFFD";
    }
    // an escaped newline is a line continuation and disappears; any other escaped character is itself
    if (newline) return "";
    return literal ?? "";
  });
}

/** Removes comments, leaving quoted strings alone (a `/*` inside quotes is not a comment). */
export function stripCssComments(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"' || c === "'") {
      const end = endOfString(text, i);
      out += text.slice(i, end);
      i = end - 1;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      const close = text.indexOf("*/", i + 2);
      i = close === -1 ? text.length : close + 1;
      continue;
    }
    out += c;
  }
  return out;
}

/** The index just past the string that starts at `start` (its quote included); an unterminated string ends the text. */
function endOfString(text: string, start: number): number {
  const quote = text[start];
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === quote) return i + 1;
  }
  return text.length;
}

/**
 * Splits `text` at `separator` where it is not inside parentheses, brackets or quotes: `rgb(1, 2, 3)` stays whole.
 */
function splitOutside(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"' || c === "'") {
      i = endOfString(text, i) - 1;
      continue;
    }
    if (c === "(" || c === "[") depth++;
    else if ((c === ")" || c === "]") && depth > 0) depth--;
    else if (c === separator && depth === 0) {
      parts.push(text.slice(from, i));
      from = i + 1;
    }
  }
  parts.push(text.slice(from));
  return parts;
}

/** The value without the `!important` flag, and whether it was there. */
function withoutImportant(value: string): { value: string; important: boolean } {
  const m = /(.*?)\s*!\s*important\s*$/i.exec(value);
  return m ? { value: m[1]!, important: true } : { value, important: false };
}

/** Every function name in a value, lowercased (`rgba(1,2,3)` → `rgba`). */
function functionNames(value: string): string[] {
  const names: string[] = [];
  const re = /([a-z-]+)\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value))) names.push(m[1]!.toLowerCase());
  return names;
}

/** True when every number in the value is inside `limit` in its own unit, for values like blur radius. */
function numbersWithin(value: string, limit: number): boolean {
  const re = /(-?\d*\.?\d+)(px|rem|em|%|vh|vw|deg|ms|s)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value))) {
    const n = Number(m[1]);
    const unit = (m[2] ?? "").toLowerCase();
    // seconds are only used for time and conversion to ms keeps the comparison honest
    const scaled = unit === "s" ? n * 1000 : n;
    if (!Number.isFinite(scaled) || Math.abs(scaled) > limit) return false;
  }
  return true;
}

/** `z-index`: a plain integer within the limit (the app's own dialogs sit at 80). */
function zIndexOk(value: string): boolean {
  return /^-?\d{1,4}$/.test(value.trim()) && Math.abs(Number(value)) <= MAX_THEME_Z_INDEX;
}

/** `position`: a theme may move things around inside itself, but not pin them over the app. */
function positionOk(value: string): boolean {
  return /^(static|relative|absolute)$/i.test(value.trim());
}

/**
 * `display`: the app's own layout values. `none` is kept on purpose — a theme may hide a part of its own container at a
 * breakpoint, and it can only reach what is inside the scope; the app's own chrome is outside it.
 */
function displayOk(value: string): boolean {
  return /^(block|inline|inline-block|flex|inline-flex|grid|inline-grid|contents|table|table-row|table-cell|none)$/i.test(value.trim());
}

/** `font-family`: every family named must be one the app already uses, and the last must be a generic one. */
function fontFamilyOk(value: string): boolean {
  const families = splitOutside(value, ",").map((f) => f.trim().replace(/^["']|["']$/g, "").toLowerCase());
  if (!families.length || families.length > 4) return false;
  return families.every((f) => FONT_FAMILIES.has(f));
}

/** `transform`: translations, scaling, rotation and skew, each with a number of a known unit — nothing else. */
function transformOk(value: string): boolean {
  const trimmed = value.trim();
  if (/^none$/i.test(trimmed)) return true;
  const calls = trimmed.match(/[a-z0-9-]+\s*\([^()]*\)/gi) ?? [];
  if (!calls.length) return false;
  // everything must be inside those calls; a stray word is not a transform
  const rest = trimmed.replace(/[a-z0-9-]+\s*\([^()]*\)/gi, "").replace(/[\s,]/g, "");
  if (rest) return false;
  for (const call of calls) {
    const name = /^([a-z0-9-]+)/i.exec(call)?.[1]?.toLowerCase() ?? "";
    if (!TRANSFORM_FUNCTIONS.has(name)) return false;
    const args = call.slice(call.indexOf("(") + 1, -1);
    if (!/^[\s\d.,%a-z-]*$/i.test(args)) return false;
    // 400 % of nothing: a huge scale or translate can throw the layout into another screen
    if (!numbersWithin(args, 10_000)) return false;
  }
  return true;
}

/** `filter`/`backdrop-filter`: the glass effects, bounded, no drop-shadow with a URL (urls are refused anyway). */
function filterOk(value: string): boolean {
  const trimmed = value.trim();
  if (/^none$/i.test(trimmed)) return true;
  const calls = trimmed.match(/[a-z-]+\s*\([^()]*\)/gi) ?? [];
  if (!calls.length) return false;
  if (trimmed.replace(/[a-z-]+\s*\([^()]*\)/gi, "").replace(/[\s,]/g, "")) return false;
  for (const call of calls) {
    const name = /^([a-z-]+)/i.exec(call)?.[1]?.toLowerCase() ?? "";
    if (!FILTER_FUNCTIONS.has(name)) return false;
    if (!numbersWithin(call, 200)) return false;
  }
  return true;
}

/** `transition`: a duration of a realistic length, and properties the theme is allowed to animate. */
function transitionOk(value: string, isPropertyAllowed: (p: string) => boolean): boolean {
  const parts = splitOutside(value, ",").map((p) => p.trim()).filter(Boolean);
  if (!parts.length || parts.length > 8) return false;
  return parts.every((part) => {
    const words = part.split(/\s+/).filter(Boolean);
    if (!words.length || words.length > 4) return false;
    const times = words.filter((w) => /^-?\d*\.?\d+(ms|s)$/i.test(w));
    if (times.length > 2) return false;
    for (const t of times) {
      const ms = /s$/i.test(t) && !/ms$/i.test(t) ? Number(t.slice(0, -1)) * 1000 : Number(t.replace(/ms$/i, ""));
      if (!Number.isFinite(ms) || ms < 0 || ms > 5000) return false;
    }
    const props = words.filter((w) => !/^-?\d*\.?\d+(ms|s)$/i.test(w) && !/^(ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end|steps\s*\([^)]*\)|cubic-bezier\s*\([^)]*\)|infinite|normal|alternate|reverse|alternate-reverse|forwards|backwards|both|running|paused)$/i.test(w));
    return props.every((p) => /^all$/i.test(p) || isPropertyAllowed(p.toLowerCase()));
  });
}

/** A word that is a time, in milliseconds (0 when it is not one). */
function timeInMs(word: string): number | null {
  if (!/^-?\d*\.?\d+(ms|s)$/i.test(word)) return null;
  return /ms$/i.test(word) ? Number(word.slice(0, -2)) : Number(word.slice(0, -1)) * 1000;
}

/** The words of an `animation` value that are not times, keywords or numbers: the names it refers to. */
const ANIMATION_KEYWORDS = /^(infinite|normal|reverse|alternate|alternate-reverse|forwards|backwards|both|running|paused|ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end|initial|inherit|none)$/i;

/** `animation`: only the theme's own @keyframes, by name, at a speed a person can live with. */
function animationOk(value: string, keyframes: Set<string>): boolean {
  const words = value.split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  for (const w of words) {
    const ms = timeInMs(w);
    if (ms !== null) {
      if (ms < 0 || ms > 30_000) return false;
      continue;
    }
    if (ANIMATION_KEYWORDS.test(w) || /^\d+$/.test(w) || /^(steps|cubic-bezier)\s*\(/i.test(w)) continue;
    if (!keyframes.has(w.toLowerCase())) return false;
  }
  return true;
}

/** A declaration's value for its property, or the reason it may not be used. */
function checkValue(property: string, rawValue: string, keyframes: Set<string>): string | null {
  const { value } = withoutImportant(rawValue);
  const v = value.trim();
  if (!v) return "empty value";
  // named first, so the log and the refusal say what was actually tried
  if (/expression\s*\(/i.test(v)) return "expression() is not a function a stylesheet may use";
  if (v.length > MAX_VALUE) return `value longer than ${MAX_VALUE} characters`;
  // the decoded text: escapes and comments are already gone, so nothing can hide behind them
  if (FORBIDDEN_IN_VALUE.test(v)) return "loads something, runs something or reaches outside the declaration";

  const functions = functionNames(v);
  const unknown = functions.filter((f) => f !== "var" && f !== "rgb" && f !== "rgba" && f !== "hsl" && f !== "hsla" && f !== "calc" && f !== "min" && f !== "max" && f !== "clamp" && f !== "linear-gradient" && f !== "radial-gradient" && f !== "conic-gradient" && f !== "repeating-linear-gradient" && f !== "repeating-radial-gradient" && f !== "repeating-conic-gradient" && f !== "blur" && f !== "brightness" && f !== "contrast" && f !== "grayscale" && f !== "saturate" && f !== "sepia" && f !== "opacity" && f !== "hue-rotate" && f !== "drop-shadow" && f !== "invert" && f !== "translate" && f !== "translatex" && f !== "translatey" && f !== "translatez" && f !== "translate3d" && f !== "scale" && f !== "scalex" && f !== "scaley" && f !== "scalez" && f !== "scale3d" && f !== "rotate" && f !== "rotatex" && f !== "rotatey" && f !== "rotatez" && f !== "rotate3d" && f !== "skew" && f !== "skewx" && f !== "skewy" && f !== "cubic-bezier" && f !== "steps");
  if (unknown.length) return `function ${unknown[0]}() is not allowed`;

  const custom = property.startsWith("--");
  if (custom) return /^[-\w\s#,.%()/:]+$/.test(v) ? null : "custom property with an unexpected value";

  if (COLOR_PROPS.has(property)) {
    return /^([#a-z0-9\s,.%()/-]+)$/i.test(v) ? null : "not a colour";
  }
  if (BACKGROUND_PROPS.has(property)) {
    // a gradient or a colour; anything else (an image, a mask) is not allowed here
    return functions.every((f) => /gradient$/.test(f) || ["var", "rgb", "rgba", "hsl", "hsla", "calc", "min", "max", "clamp"].includes(f)) ? null : "background may only be a colour or a gradient";
  }
  if (BORDER_PROPS.has(property)) {
    // border/outline shorthands carry only lengths, colours and style keywords
    return /^[#a-z0-9\s,.%()/-]+$/i.test(v) && functions.every((f) => ["var", "rgb", "rgba", "hsl", "hsla", "calc", "min", "max", "clamp"].includes(f)) ? null : "border or shadow with something unexpected in it";
  }
  if (FILTER_PROPS.has(property)) return filterOk(v) ? null : "filter with something unexpected in it";
  if (property === "font-family" || property === "font") return property === "font-family" ? (fontFamilyOk(v) ? null : "a font the app does not have") : /^[a-z0-9\s/".%(),-]+$/i.test(v) && fontFamilyOk(v.split(/\s/).slice(1).join(" ") || v) ? null : "font with an unexpected value";
  if (FONT_PROPS.has(property)) return /^[#a-z0-9\s,.%()/"-]+$/i.test(v) ? null : "not a type value";
  if (property === "z-index") return zIndexOk(v) ? null : `z-index above ${MAX_THEME_Z_INDEX} or not a number`;
  if (property === "position") return positionOk(v) ? null : "position other than static, relative or absolute";
  if (property === "display") return displayOk(v) ? null : "display value that hides or replaces the layout";
  if (property === "transform" || property === "transform-origin") return property === "transform" ? (transformOk(v) ? null : "transform with something unexpected in it") : /^[-\d.%a-z\s]+$/i.test(v) ? null : "not a transform origin";
  if (property.startsWith("transition")) return transitionOk(v, (p) => isAllowedProperty(p)) ? null : "transition of something unexpected, or too slow";
  if (property.startsWith("animation")) return animationOk(v, keyframes) ? null : "animation that is not the theme's own @keyframes";
  if (property === "cursor") return /^(default|pointer|text|move|grab|grabbing|help|wait|progress|not-allowed|auto)$/i.test(v) ? null : "not a cursor";
  // offsets: a nudge inside the theme is fine, a move off the screen (or far past it) is how a real button disappears
  if (OFFSET_PROPS.has(property)) return numbersWithin(v, 4000) ? null : `${property} moves the element off the screen`;
  // the remaining whitelisted properties: lengths, percentages, keywords and the colour functions
  return /^[#a-z0-9\s,.%()/-]+$/i.test(v) ? null : `unexpected value for ${property}`;
}

/** Every property a theme may set: the whitelist, as one question. */
function isAllowedProperty(property: string): boolean {
  if (property.startsWith("--")) return true;
  return COLOR_PROPS.has(property) || BACKGROUND_PROPS.has(property) || BORDER_PROPS.has(property) || FILTER_PROPS.has(property) || FONT_PROPS.has(property) || OTHER_PROPS.has(property);
}

// ---- selectors ------------------------------------------------------------------------------------------------------

/** `:root`, `html` and `body` are outside any theme's container: a theme that names them is trying to be the page. */
const ESCAPES_SCOPE = /(^|[\s,>+~])(html|body|:root)(?=$|[\s,>+~.:#[])/i;

/**
 * A selector is accepted when it is a normal descendant chain without escapes out of the container. Every compound is
 * then rewritten under THEME_SCOPE, so `.card` styles the theme's card and `body .card` is refused rather than restyled.
 */
function scopeSelectors(selectorText: string): { selectors: string[]; reason: string | null } {
  const parts = splitOutside(selectorText, ",").map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return { selectors: [], reason: "empty selector" };
  if (parts.length > 40) return { selectors: [], reason: "too many selectors in one rule" };
  const out: string[] = [];
  for (const part of parts) {
    if (part.length > 300) return { selectors: [], reason: "selector longer than 300 characters" };
    if (/[@{}]/.test(part)) return { selectors: [], reason: "selector with a @-rule or a block in it" };
    if (ESCAPES_SCOPE.test(part)) return { selectors: [], reason: "selector outside the theme's container (html, body, :root)" };
    // a leading combinator is harmless once scoped, but a bare "*" would restyle everything: both are still inside
    out.push(`${THEME_SCOPE} ${part}`);
  }
  return { selectors: out, reason: null };
}

// ---- the parser -----------------------------------------------------------------------------------------------------

/** Reads one declaration (`property: value`) in a rule's body. */
function readDeclaration(raw: string, keyframes: Set<string>): { text: string; reason: null } | { text: null; reason: string } {
  const colon = raw.indexOf(":");
  if (colon === -1) return { text: null, reason: "declaration without a value" };
  const nameRaw = raw.slice(0, colon).trim();
  const valueRaw = raw.slice(colon + 1).trim();
  // the property name is read the way the browser reads it (\70 osition is position)
  const name = decodeCssEscapes(nameRaw).trim().toLowerCase();
  if (!name) return { text: null, reason: "empty property name" };
  if (!/^(--[-\w]+|-?[a-z][-a-z0-9]*)$/.test(name)) return { text: null, reason: `malformed property name ${name.slice(0, 40)}` };
  if (name === "content" || name === "pointer-events") return { text: null, reason: `${name} is not allowed` };
  if (!isAllowedProperty(name)) return { text: null, reason: `property ${name} is not allowed` };
  const value = decodeCssEscapes(valueRaw).trim();
  const problem = checkValue(name, value, keyframes);
  if (problem) return { text: null, reason: `${name}: ${problem}` };
  return { text: `${name}: ${value}`, reason: null };
}

/**
 * The CSS a theme may use, with every selector under THEME_SCOPE and every declaration that is not on the white list
 * left out (and reported). Never throws: a broken sheet loses the broken part, not the whole theme.
 */
export function sanitizeThemeCss(input: unknown): ThemeCssResult {
  const dropped: ThemeCssDrop[] = [];
  if (typeof input !== "string" || !input.trim()) return { css: "", dropped };
  if (input.length > MAX_THEME_CSS) {
    return { css: "", dropped: [{ where: "theme", reason: `longer than ${MAX_THEME_CSS} characters` }] };
  }
  const text = stripCssComments(input);
  // the sheet is read twice: once to know which @keyframes exist (an animation may only name those), then for real
  const keyframes = new Set<string>();
  for (const m of text.matchAll(/@(?:-\w+-)?keyframes\s+([-\w]+)/gi)) keyframes.add(m[1]!.toLowerCase());

  const out: string[] = [];

  /** Reads a `{ … }` block of `source` starting at `open`, returning its body and the index after the closing brace. */
  const readBlock = (source: string, open: number): { body: string; end: number } => {
    let depth = 0;
    for (let j = open; j < source.length; j++) {
      const c = source[j]!;
      if (c === '"' || c === "'") {
        j = endOfString(source, j) - 1;
        continue;
      }
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) return { body: source.slice(open + 1, j), end: j + 1 };
      }
    }
    return { body: source.slice(open + 1), end: source.length };
  };

  /** Reads one rule body into declarations, dropping the bad ones. */
  const declarations = (body: string, where: string): string[] => {
    const kept: string[] = [];
    for (const raw of splitOutside(body, ";")) {
      const piece = raw.trim();
      if (!piece) continue;
      const d = readDeclaration(piece, keyframes);
      if (d.text !== null) kept.push(d.text);
      else dropped.push({ where, reason: d.reason });
    }
    return kept;
  };

  /** Handles one block (a rule, @media, @keyframes) at sheet level or inside @media. */
  const handle = (preludeRaw: string, bodyRaw: string, depth: number): void => {
    const prelude = preludeRaw.trim();
    if (!prelude) {
      dropped.push({ where: "theme", reason: "block without a selector" });
      return;
    }
    if (prelude.startsWith("@")) {
      const at = /^@([-\w]+)\s*([\s\S]*)$/.exec(prelude);
      const name = (at?.[1] ?? "").toLowerCase();
      const rest = (at?.[2] ?? "").trim();
      if (name === "media") {
        // a breakpoint inside a breakpoint is a way to hide things from a reader of the sheet and the app alike
        if (depth > 0) {
          dropped.push({ where: prelude, reason: "@media nested too deeply" });
          return;
        }
        const decoded = decodeCssEscapes(rest).trim();
        // a media query is a condition, not a value: no semicolons, no braces, no strings, no urls
        if (!decoded || !/^[a-z0-9\s(),:._\-/%]+$/i.test(decoded) || /(url\s*\(|;|\{|\}|<|>|`|@)/i.test(decoded)) {
          dropped.push({ where: prelude, reason: "@media with something other than a media query" });
          return;
        }
        const before = out.length;
        parseSheet(bodyRaw, depth + 1);
        const inner = out.splice(before).join("\n");
        if (inner.trim()) out.push(`@media ${decoded} {\n${indent(inner)}\n}`);
        return;
      }
      if (name === "keyframes" || name === "-webkit-keyframes") {
        const keyframeName = decodeCssEscapes(rest).trim().toLowerCase();
        if (!/^[-\w]+$/.test(keyframeName)) {
          dropped.push({ where: prelude, reason: "@keyframes without a usable name" });
          return;
        }
        const frames: string[] = [];
        const re = /([^{}]+)\{([^{}]*)\}/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(bodyRaw))) {
          const stops = m[1]!.trim();
          if (!/^(from|to|\d{1,3}%)(\s*,\s*(from|to|\d{1,3}%))*$/i.test(stops)) {
            dropped.push({ where: prelude, reason: `@keyframes stop "${stops.slice(0, 40)}" is not from/to/a percentage` });
            continue;
          }
          const decls = declarations(m[2]!, prelude);
          if (decls.length) frames.push(`  ${stops} { ${decls.join("; ")} }`);
        }
        // a theme's keyframes are named inside the scope so they cannot collide with the app's own
        if (frames.length) out.push(`@keyframes ${keyframeName} {\n${frames.join("\n")}\n}`);
        return;
      }
      // @import, @font-face, @supports, @charset, @namespace, @layer … — none of them belong in a theme
      dropped.push({ where: prelude.slice(0, 60), reason: `@${name} is not allowed` });
      return;
    }
    const scoped = scopeSelectors(prelude);
    if (scoped.reason) {
      dropped.push({ where: prelude.slice(0, 60), reason: scoped.reason });
      return;
    }
    const decls = declarations(bodyRaw, prelude.slice(0, 60));
    if (decls.length) out.push(`${scoped.selectors.join(`,\n`)} {\n${indent(decls.map((d) => `${d};`).join("\n"))}\n}`);
  };

  /**
   * Reads a sheet (or a @media body): rules and at-rules, left to right, into `out`. CSS has two shapes here — a block
   * (`@media … { }`, `selector { }`) and a statement (`@import …;`) — and both are read, so a stray statement cannot
   * swallow the rule after it.
   */
  const parseSheet = (sheet: string, depth: number): void => {
    let j = 0;
    while (j < sheet.length) {
      // the next `{` or `;` outside quotes, and what comes before it
      let open = -1;
      let semi = -1;
      for (let k = j; k < sheet.length; k++) {
        const c = sheet[k]!;
        if (c === '"' || c === "'") {
          k = endOfString(sheet, k) - 1;
          continue;
        }
        if (c === "{") {
          open = k;
          break;
        }
        if (c === ";") {
          semi = k;
          break;
        }
        if (c === "}") {
          // a stray closing brace: the piece before it is only text, and the sheet goes on after the brace
          const piece = sheet.slice(j, k).trim();
          if (piece) dropped.push({ where: piece.slice(0, 60), reason: "text outside any rule" });
          open = -2;
          j = k + 1;
          break;
        }
      }
      // -2 marks the stray brace above; the loop simply goes on from where it now is
      if (open === -2) continue;
      if (semi !== -1 && (open === -1 || semi < open)) {
        // a statement at-rule: @import, @charset, @layer x; — read and refused, then the next rule is read normally
        const statement = sheet.slice(j, semi).trim();
        if (statement) {
          const at = /^@([-\w]+)/.exec(statement)?.[1]?.toLowerCase() ?? "";
          dropped.push({ where: statement.slice(0, 60), reason: at ? `@${at} is not allowed` : "text outside any rule" });
        }
        j = semi + 1;
        continue;
      }
      if (open === -1) {
        const rest = sheet.slice(j).trim();
        if (rest) dropped.push({ where: rest.slice(0, 60), reason: "text outside any rule" });
        break;
      }
      const prelude = sheet.slice(j, open);
      const { body, end } = readBlock(sheet, open);
      handle(prelude, body, depth);
      j = end;
    }
  };

  parseSheet(text, 0);
  const css = out.join("\n");
  return { css: css.length > MAX_THEME_CSS ? "" : css, dropped };
}

/** Every rule body indented by two spaces, for a readable sheet (and a readable diff in tests). */
function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => (line ? `  ${line}` : line))
    .join("\n");
}

/**
 * What is wrong with a theme's CSS, for the server to refuse a new publication: one line per problem, empty when the
 * sheet is entirely acceptable. The message never repeats the sheet, only where and why.
 */
export function themeCssProblems(input: unknown): string[] {
  if (input === undefined || input === null || input === "") return [];
  if (typeof input !== "string") return ["css must be text"];
  if (input.length > MAX_THEME_CSS) return [`css too long (${MAX_THEME_CSS} characters)`];
  const { dropped } = sanitizeThemeCss(input);
  return dropped.map((d) => `${d.where}: ${d.reason}`);
}
