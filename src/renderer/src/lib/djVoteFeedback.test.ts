import assert from "node:assert/strict";
import { test } from "node:test";
import { en } from "../i18n/en.ts";
import { ru } from "../i18n/ru.ts";
import { djVoteNotice, nextDjVote } from "./djVoteFeedback.ts";

test("DJ plus and minus are exclusive; clicking the chosen one again clears it", () => {
  let vote = nextDjVote(null, "more");
  assert.equal(vote, "more");
  vote = nextDjVote(vote, "less");
  assert.equal(vote, "less");
  vote = nextDjVote(vote, "less");
  assert.equal(vote, null);
  assert.equal(nextDjVote(null, "less"), "less");
  assert.equal(nextDjVote("less", "more"), "more");
  assert.equal(nextDjVote("more", "more"), null);
});

test("both languages confirm a vote, a paused vote, and removing a vote", () => {
  for (const t of [ru, en]) {
    assert.equal(djVoteNotice("more", true, t), t.djVoteMoreSaved);
    assert.equal(djVoteNotice("less", true, t), t.djVoteLessSaved);
    assert.equal(djVoteNotice("more", false, t), t.djVotePaused);
    assert.equal(djVoteNotice("less", false, t), t.djVotePaused);
    assert.equal(djVoteNotice(null, true, t), t.djVoteRemoved);
    assert.equal(djVoteNotice(null, false, t), t.djVoteRemoved);
    assert.ok(t.djVoteMoreSaved && t.djVoteLessSaved && t.djVotePaused && t.djVoteRemoved);
  }
});
