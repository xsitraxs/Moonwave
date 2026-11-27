import type { Dict } from "../i18n/en";
import { dj, useDj } from "@/state/dj";
import { useUi } from "@/state/ui";
import type { DjVote } from "./djRefill";
import { djVoteNotice, nextDjVote } from "./djVoteFeedback";

/** Same confirmation for the DJ page's +/- buttons and the track context menu. */
export function rateDjTrack(trackId: number, choice: DjVote, t: Dict): void {
  const state = useDj.getState(); // a rapid second click must see the first vote, even before React redraws
  if (!state.active) return;
  const next = nextDjVote(state.votes[trackId] ?? null, choice);
  dj.vote(trackId, next);
  useUi.getState().showToast(djVoteNotice(next, state.feedbackOn, t));
}
