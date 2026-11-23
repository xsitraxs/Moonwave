import type { DjWhy } from "./djRank";

/** A suggestion's honest reason in words; the caller passes its localized formatters. */
export function djReasonText(
  why: DjWhy,
  fmt: { seed: (title: string) => string; seeds: (count: number) => string; likes: (count: number) => string; generic: string },
): string {
  switch (why.kind) {
    case "seed":
      return fmt.seed(why.seedTitle);
    case "seeds":
      return fmt.seeds(why.count);
    case "likes":
      return fmt.likes(why.count);
    case "generic":
      return fmt.generic;
  }
}
