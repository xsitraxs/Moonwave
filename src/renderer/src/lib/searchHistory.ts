export const SEARCH_HISTORY_LIMIT = 12;

const SC_LINK = /^\s*(https?:\/\/)?([\w-]+\.)?soundcloud\.com\//i;

/**
 * Add an explicitly committed search query to history (deduplicated case-insensitively, ignoring short strings and
 * SoundCloud URLs). Returns the updated array or `null` if nothing changed.
 */
export function mergeSearchHistory(current: readonly string[], raw: string, limit = SEARCH_HISTORY_LIMIT): string[] | null {
  const q = raw.trim();
  if (q.length < 2 || SC_LINK.test(q)) return null;
  if (current[0]?.toLowerCase() === q.toLowerCase() && current[0] === q) return null;
  return [q, ...current.filter((item) => item.toLowerCase() !== q.toLowerCase())].slice(0, limit);
}

export function removeFromSearchHistory(current: readonly string[], target: string): string[] {
  return current.filter((item) => item !== target);
}
