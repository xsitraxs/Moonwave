/**
 * What a log line must not carry. The log ends up in "Report a problem" files that people attach to public GitHub
 * issues, so anything that names the person or opens their accounts is blanked before it is written — at the one
 * place every line passes, rather than trusting each of the many callers to remember.
 *
 * Kept free of Electron so it can be tested on its own (redact.test.ts).
 */

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * @param home the user's home folder: paths in stacks and errors name the account ("C:\Users\Anna\…"), so it becomes "~"
 */
export function redact(message: string, home = ""): string {
  let s = message;
  if (home.length > 2) {
    // Windows paths come with either slash and any letter case; a stack may also show it as a file:// URL
    const variants = new Set([home, home.replace(/\\/g, "/")]);
    for (const v of variants) s = s.replace(new RegExp(escape(v), process.platform === "win32" || /^[a-z]:/i.test(v) ? "gi" : "g"), "~");
  }
  return (
    s
      // sign-in headers quoted in an error
      .replace(/\b(Bearer|OAuth)\s+[^\s,;"']+/gi, "$1 …")
      // a query string or fragment can hold a client_id, an oauth_token, a code or a search the person typed;
      // the address up to it is enough to tell what failed
      .replace(/\b((?:https?|wss?|moonwave):\/\/[^\s?#"'<>]*)[?#][^\s"'<>]*/gi, "$1?…")
      // an address ends in a name ("…@mail.ru"), a package version does not ("electron@44.4.1")
      .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[A-Za-z]{2,}\b/g, "…@…")
      // a friend code is all it takes to message someone
      .replace(/\bSKY-[2-9A-HJ-NP-Z]{5}\b/g, "SKY-…")
      // token-like runs (OAuth tokens, client ids, secrets, hashes): letters and digits together, 20 or more; plain
      // words in stacks ("SoundCloudWebSessionProvider") and long numeric track ids stay readable
      .replace(/(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{20,}/g, "…")
  );
}
