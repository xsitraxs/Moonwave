/** "Share what I play": out of scope here — a track is enough for the room's own bookkeeping. */
export const toSocial = (track) => ({ id: track.id, title: track.title, artist: track.artist, user: track.user, durationMs: track.durationMs, artworkUrl: track.artworkUrl });
export const useSocial = () => null;
