import type { Dict } from "../i18n/en";
import type { DjVote } from "./djRefill";

/** A track has just one session rating. Clicking it again undoes it; clicking the other replaces it. */
export function nextDjVote(current: DjVote | null, choice: DjVote): DjVote | null {
  return current === choice ? null : choice;
}

/** Confirm what changed, without promising that already-queued tracks will be reranked. */
export function djVoteNotice(next: DjVote | null, feedbackOn: boolean, t: Pick<Dict, "djVoteMoreSaved" | "djVoteLessSaved" | "djVotePaused" | "djVoteRemoved">): string {
  if (next === null) return t.djVoteRemoved;
  if (!feedbackOn) return t.djVotePaused;
  return next === "more" ? t.djVoteMoreSaved : t.djVoteLessSaved;
}
