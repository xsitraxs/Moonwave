import assert from "node:assert/strict";
import { test } from "node:test";
import type { Track } from "../../../shared/types.ts";
import { albumKey, dedupeRecentByAlbum, formatGreeting, greetingKey } from "./homeHelpers.ts";

function makeTrack(id: number, overrides: Partial<Track> = {}): Track {
  return {
    id,
    title: `Track ${id}`,
    artist: `Artist ${id}`,
    user: { id: 100 + id, username: `Artist ${id}`, permalinkUrl: `https://soundcloud.com/a${id}` },
    durationMs: 180_000,
    artworkUrl: `https://i1.sndcdn.com/artworks-abc${id}-large.jpg`,
    waveformUrl: null,
    permalinkUrl: `https://soundcloud.com/a${id}/t${id}`,
    playability: "ok",
    ...overrides,
  };
}

test("greetingKey maps hours cleanly without premature lateNight", () => {
  assert.equal(greetingKey(0), "lateNight");
  assert.equal(greetingKey(4), "lateNight");
  assert.equal(greetingKey(5), "goodMorning");
  assert.equal(greetingKey(11), "goodMorning");
  assert.equal(greetingKey(12), "goodAfternoon");
  assert.equal(greetingKey(16), "goodAfternoon");
  assert.equal(greetingKey(17), "goodEvening");
  assert.equal(greetingKey(23), "goodEvening");
});

test("formatGreeting never produces stray punctuation like '?,'", () => {
  assert.equal(formatGreeting("Не спится?", "xsitrax"), "Не спится, xsitrax");
  assert.equal(formatGreeting("Добрый вечер", "xsitrax"), "Добрый вечер, xsitrax");
  assert.equal(formatGreeting("Не спится?", undefined), "Не спится");
});

test("albumKey normalizes SoundCloud artwork size suffixes", () => {
  const a = makeTrack(1, { user: { id: 10, username: "U", permalinkUrl: "" }, artworkUrl: "https://i1.sndcdn.com/artworks-xyz-large.jpg" });
  const b = makeTrack(2, { user: { id: 10, username: "U", permalinkUrl: "" }, artworkUrl: "https://i1.sndcdn.com/artworks-xyz-t500x500.jpg" });
  assert.equal(albumKey(a), albumKey(b));
});

test("dedupeRecentByAlbum collapses tracks from the same album and skips the hero album", () => {
  const hero = makeTrack(1, { user: { id: 10, username: "U", permalinkUrl: "" }, artworkUrl: "https://i1.sndcdn.com/artworks-hero-large.jpg" });
  const heroAlbumTrack2 = makeTrack(2, { user: { id: 10, username: "U", permalinkUrl: "" }, artworkUrl: "https://i1.sndcdn.com/artworks-hero-t300x300.jpg" });
  const albumB1 = makeTrack(3, { user: { id: 20, username: "B", permalinkUrl: "" }, artworkUrl: "https://i1.sndcdn.com/artworks-b-large.jpg" });
  const albumB2 = makeTrack(4, { user: { id: 20, username: "B", permalinkUrl: "" }, artworkUrl: "https://i1.sndcdn.com/artworks-b-large.jpg" });
  const noArt1 = makeTrack(5, { artworkUrl: null });
  const noArt2 = makeTrack(6, { artworkUrl: null });

  const res = dedupeRecentByAlbum([hero, heroAlbumTrack2, albumB1, albumB2, noArt1, noArt2], hero);
  assert.deepEqual(
    res.map((t) => t.id),
    [3, 5, 6],
  );
});
