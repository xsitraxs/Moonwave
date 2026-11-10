export const PROTOCOL = "moonwave";

/**
 * Any printable token without spaces is taken: SoundCloud checks it right after (the account is asked for), and
 * some accounts' cookies are longer or carry other characters than "2-123-456-abc" — those links were refused here.
 */
export const TOKEN = /^[\x21-\x7e]{8,4096}$/;

/** The code from a friend link (`moonwave://friend/SKY-XXXXX`) among arguments, if there is one. */
export function parseFriendFromArgs(argv: string[]): string | null {
  for (const arg of argv) {
    if (!arg.toLowerCase().startsWith(`${PROTOCOL}://friend/`)) continue;
    const code = arg.slice(`${PROTOCOL}://friend/`.length).replace(/\/+$/, "").toUpperCase();
    if (/^SKY-[2-9A-HJ-NP-Z]{5}$/.test(code)) return code;
  }
  return null;
}

/** A sign-in link's contents: the SoundCloud token, and the one-time state the helper page put into it. */
export interface SignInLink {
  token: string;
  /** the one-time state, or null for a bookmark made by an older version (it has none) */
  state: string | null;
}

/**
 * The token and state from a `moonwave://signin?token=…&state=…` link among arguments, if there is a usable one.
 *
 * The state is kept as it came (only quotes and trailing slashes are dropped) because it is compared, never used as
 * a value itself. A link without one is still returned — the caller asks the person first before such a sign-in.
 */
export function parseSignInLinkFromArgs(argv: string[], onLog?: (msg: string) => void): SignInLink | null {
  for (const arg of argv) {
    if (!arg.toLowerCase().startsWith(`${PROTOCOL}://signin`)) continue;
    let url: URL;
    try {
      url = new URL(arg);
    } catch {
      onLog?.("login: browser link that isn't a link");
      continue;
    }
    const rawState = (url.searchParams.get("state") ?? "").trim().replace(/\/+$/, "");
    let token = (url.searchParams.get("token") ?? "").trim().replace(/\/+$/, "");
    // a cookie kept percent-encoded arrives encoded once more
    if (/%[0-9a-f]{2}/i.test(token)) {
      try {
        token = decodeURIComponent(token);
      } catch {
        /* kept as it came */
      }
    }
    // a cookie value may come in quotes
    token = token.replace(/^"(.*)"$/, "$1");
    if (TOKEN.test(token)) return { token, state: rawState ? rawState.replace(/^"(.*)"$/, "$1") : null };
    // what was wrong with it, never the token itself
    const odd = [...new Set(token.replace(/[\w.-]/g, ""))].map((c) => (c.charCodeAt(0) < 0x21 || c.charCodeAt(0) > 0x7e ? `U+${c.charCodeAt(0).toString(16)}` : c)).join(" ");
    onLog?.(`login: browser link without a usable token (length ${token.length}${odd ? `, other characters: ${odd}` : ""})`);
  }
  return null;
}

/** The token from a `moonwave://signin?token=…` link among arguments, if there is one. */
export function parseTokenFromArgs(argv: string[], onLog?: (msg: string) => void): string | null {
  return parseSignInLinkFromArgs(argv, onLog)?.token ?? null;
}
