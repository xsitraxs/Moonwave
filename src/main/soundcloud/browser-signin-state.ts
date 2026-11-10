import { randomBytes, timingSafeEqual } from "node:crypto";

/**
 * The one-time state behind the browser sign-in, kept apart from Electron so that the rules can be tested without the
 * app: while the user waits for a link, only a link carrying the state this run handed to the helper page is taken
 * without a question. Anything else (no state — a bookmark from an older version or an earlier session; a state from
 * another wait; a link that comes after the wait) has to be confirmed by the person first.
 */

/** How long a link is expected after "Sign in with your browser". */
export const WAIT_MS = 15 * 60_000;

/** What one startBrowserSignIn() sets up: the state it expects, and when it stops waiting for it. */
export interface SignInWait {
  /** the expected state, or null when nothing is being waited for */
  state: string | null;
  /** ms since 1970; 0 when idle */
  until: number;
}

/** The idle wait: not waiting for anything, and nothing that could match. */
export const idleWait: SignInWait = { state: null, until: 0 };

/** A fresh 128-bit state, hex — long enough that guessing it is out of the question. */
export function newSignInState(): string {
  return randomBytes(16).toString("hex");
}

/** The wait a new sign-in starts: its own state, 15 minutes from now. */
export function beginWait(now: number): SignInWait {
  return { state: newSignInState(), until: now + WAIT_MS };
}

/** True while a sign-in is being waited for. */
export function isWaiting(wait: SignInWait, now: number): boolean {
  return wait.state !== null && now < wait.until;
}

/**
 * True when a link's state is exactly the expected one. Compared in constant time (timingSafeEqual): the state is a
 * secret of sorts — whoever knows it can sign the app in while it waits without a question.
 */
export function sameState(want: string, got: string | null): boolean {
  if (!got) return false;
  const a = Buffer.from(want, "utf8");
  const b = Buffer.from(got, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** What a link may expect: taken quietly only while waiting, and only with the very state this wait handed out. */
export function acceptsQuietly(wait: SignInWait, linkState: string | null, now: number): boolean {
  if (!isWaiting(wait, now) || !wait.state) return false;
  return sameState(wait.state, linkState);
}
