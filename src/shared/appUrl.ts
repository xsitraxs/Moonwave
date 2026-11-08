/**
 * Which page the main window may show, and which sender the IPC layer may answer. Kept free of imports so it can be
 * unit-tested and shared: the caller computes the one expected file URL (the built index.html, or the dev server's).
 *
 * The rule is exact, not "starts with file://" — any file on disk used to pass, so a link like file:///etc/passwd or a
 * page the app never shipped could navigate the window (and call main over IPC as if it were the app).
 */

/** True only for the app's own page: exactly the file, or it with a query/hash (the debug stores flag rides there). */
export function isOwnIndexFile(url: string, indexHref: string): boolean {
  if (!url || !indexHref) return false;
  if (url === indexHref) return true;
  return url.startsWith(`${indexHref}?`) || url.startsWith(`${indexHref}#`);
}
