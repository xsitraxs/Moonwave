import type { Track } from "@shared/types";

export type GreetingKey = "goodMorning" | "goodAfternoon" | "goodEvening" | "lateNight";

/**
 * Time-of-day greeting bucket:
 * - 05:00..11:59 -> goodMorning
 * - 12:00..16:59 -> goodAfternoon
 * - 17:00..23:59 -> goodEvening
 * - 00:00..04:59 -> lateNight (strictly deep night)
 */
export function greetingKey(hour: number): GreetingKey {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 5 && h < 12) return "goodMorning";
  if (h >= 12 && h < 17) return "goodAfternoon";
  if (h >= 17) return "goodEvening";
  return "lateNight";
}

export function formatGreeting(hello: string, name?: string): string {
  const cleanHello = hello.replace(/[?.,!]+$/, "").trim();
  return name ? `${cleanHello}, ${name}` : cleanHello;
}

/**
 * SoundCloud artwork URLs vary only by size suffix (`-large`, `-t300x300`, `-t500x500`, etc.).
 * Tracks from the same album/EP share the same base artwork URL and uploader id.
 */
export function albumKey(track: Track): string {
  if (track.artworkUrl) {
    const base = track.artworkUrl
      .split("?")[0]!
      .replace(/-(?:large|small|tiny|badge|mini|t\d+x\d+|crop|original)(\.[a-z0-9]+)$/i, "$1");
    return `art:${track.user.id}:${base}`;
  }
  return `track:${track.id}`;
}

/**
 * Deduplicate recent tracks by album (preserving most-recent-first order) and optionally skip
 * the hero track's album so it isn't immediately repeated underneath the hero card.
 */
export function dedupeRecentByAlbum(tracks: Track[], heroTrack?: Track | null): Track[] {
  const seen = new Set<string>();
  const heroKey = heroTrack ? albumKey(heroTrack) : null;
  const out: Track[] = [];
  for (const track of tracks) {
    const key = albumKey(track);
    if (seen.has(key)) continue;
    seen.add(key);
    if (heroKey && key === heroKey) continue;
    out.push(track);
  }
  return out;
}
