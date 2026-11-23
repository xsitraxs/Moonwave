import type { DjArtistVia, DjWhy } from "./djRank";

/** A suggestion's honest reason in words; the caller passes its localized formatters. */
export function djReasonText(
  why: DjWhy,
  fmt: {
    seed: (title: string) => string;
    seeds: (count: number) => string;
    likes: (count: number) => string;
    artist: (count: number, name: string, via: DjArtistVia) => string;
    playlist: (count: number, title: string) => string;
    generic: string;
  },
): string {
  switch (why.kind) {
    case "seed":
      return fmt.seed(why.seedTitle);
    case "seeds":
      return fmt.seeds(why.count);
    case "likes":
      return fmt.likes(why.count);
    case "artist":
      return fmt.artist(why.count, why.name, why.via);
    case "playlist":
      return fmt.playlist(why.count, why.title);
    case "generic":
      return fmt.generic;
  }
}
