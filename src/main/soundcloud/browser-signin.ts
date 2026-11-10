import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app, shell } from "electron";
import { lang } from "../i18n";
import { log } from "../system/log";
import { parseFriendFromArgs, parseSignInLinkFromArgs, PROTOCOL, TOKEN } from "./browser-signin-url";
import { acceptsQuietly, beginWait, idleWait, isWaiting, type SignInWait } from "./browser-signin-state";

export { PROTOCOL, TOKEN };

/**
 * Sign-in through the user's own browser: the only way in since 2.1.4 (SoundCloud's bot protection kept turning the
 * window inside the app down; a browser the person uses every day passes it).
 *
 * The browser shows a helper page (written to a folder of its own under the temp directory) with a bookmark to drag
 * to the bookmarks bar. After signing in on soundcloud.com as usual, a click on that bookmark reads the site's own
 * `oauth_token` cookie (readable by the page's scripts) and hands it to the app through the `scplayer://` link:
 * Windows starts the app with that link and the running app gets it as a second instance's arguments. Nothing leaves
 * the computer.
 *
 * A link is taken without a question only while the user is waiting AND its one-time state is the one this run handed
 * to the helper page: any web page can open `scplayer://signin?token=…`, and without the state it could sign the app
 * into someone else's account while the user sits at the sign-in screen. A bookmark made in an earlier session has no
 * such state (or an old one), so it still works, but asks first — which keeps the one-click way and puts the decision
 * in front of the person. The link handler stays registered after a sign-in and goes with "Cancel".
 *
 * The token travels in the link, and so in this app's command line for the moment it takes to pass it: any local
 * process can read it there meanwhile. That is a known, accepted risk (SECURITY.md) — the alternative, a local socket,
 * no longer matches how Windows hands a link to a running app.
 */
let wait: SignInWait = idleWait;
/** the helper page's own folder (created by mkdtempSync and removed after the sign-in, or on cancel) */
let helperDir: string | null = null;

const handlerArgs = (): [string, string[]] =>
  // in development the app runs as "electron <project folder>" (a test profile goes along: Windows starts the link
  // without SKY_PROFILE); a portable build is the outer .exe, not the unpacked copy in the temp folder that is gone
  // after it quits
  process.defaultApp
    ? [process.execPath, [app.getAppPath(), ...(process.env.SKY_PROFILE ? [`--sky-profile=${process.env.SKY_PROFILE.replace(/[^\w-]/g, "")}`] : [])]]
    : [process.env.PORTABLE_EXECUTABLE_FILE ?? process.execPath, []];

export function waitingForBrowser() {
  return isWaiting(wait, Date.now());
}

/**
 * True when a link may be taken without a question: the app is waiting for one, and the link carries the very state
 * this wait handed to its helper page (compared in constant time — see browser-signin-state.ts).
 */
export function matchesBrowserState(linkState: string | null): boolean {
  return acceptsQuietly(wait, linkState, Date.now());
}

/** The helper page's folder, kept in one place so that a newer wait replaces an older page instead of leaving it behind. */
function dropHelperDir() {
  if (!helperDir) return;
  try {
    rmSync(helperDir, { recursive: true, force: true });
  } catch {
    /* already gone, or a browser still holds it open on Windows: it is in the temp folder, the system cleans it up */
  }
  helperDir = null;
}

/** scplayer:// links open this app: a sign-in from the browser, a friend's link. Set at every start (installed). */
export function registerLinks() {
  if (process.platform === "darwin") {
    if (process.defaultApp) {
      app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [app.getAppPath()]);
    } else {
      app.setAsDefaultProtocolClient(PROTOCOL);
    }
  } else {
    const [exe, args] = handlerArgs();
    app.setAsDefaultProtocolClient(PROTOCOL, exe, args);
  }
}

/** The code from a friend link (`scplayer://friend/SKY-XXXXX`) among a new instance's arguments, if there is one. */
export const friendFromArgs = parseFriendFromArgs;

export function startBrowserSignIn() {
  registerLinks();
  // a fresh state for this attempt: the previous page's state stops being enough the moment a new one is made
  wait = beginWait(Date.now());
  dropHelperDir();
  // a folder of its own, created with owner-only rights: a fixed name under the shared temp directory could be
  // replaced by another local user's file (or read by them) between writing the page and the browser opening it
  helperDir = mkdtempSync(join(app.getPath("temp"), "sc-player-"));
  const page = join(helperDir, "sign-in.html");
  writeFileSync(page, helperPage(wait.state!), { encoding: "utf8", mode: 0o600 });
  log("main", "login: browser sign-in started");
  void shell.openPath(page);
}

/** Signed in: the wait is over, the state is spent, and the page that carried it goes away. */
export function finishBrowserSignIn() {
  wait = idleWait;
  dropHelperDir();
}

export function stopBrowserSignIn() {
  // the link handler stays: friend links use it too
  finishBrowserSignIn();
}

/** A sign-in link (`scplayer://signin?token=…&state=…`) among a new instance's arguments, if there is one. */
export function signInLinkFromArgs(argv: string[]) {
  return parseSignInLinkFromArgs(argv, (msg) => log("main", msg));
}

function helperPage(state: string) {
  const isRu = lang() === "ru";
  const modKey = process.platform === "darwin" ? "Cmd" : "Ctrl";
  const notScMsg = isRu ? "Сначала откройте soundcloud.com, затем нажмите эту закладку." : "Open soundcloud.com first, then click this bookmark.";
  const notLoggedInMsg = isRu ? "Сначала войдите в SoundCloud, затем снова нажмите эту закладку." : "Sign in to SoundCloud first, then click this bookmark again.";
  // the state ties this bookmark to this attempt: the app takes a link without asking only when it carries it
  const bookmarklet = `(()=>{if(!/(^|\\.)soundcloud\\.com$/.test(location.hostname)){alert("${notScMsg}");return}const m=document.cookie.match(/(?:^|;\\s*)oauth_token=([^;]+)/);if(!m){alert("${notLoggedInMsg}");return}location.href="${PROTOCOL}://signin?token="+encodeURIComponent(m[1])+"&state=${state}"})()`;
  const href = `javascript:${encodeURIComponent(bookmarklet)}`;

  const title = isRu ? "sc player — вход через браузер" : "sc player — sign in with your browser";
  const h1 = isRu ? "Вход через браузер" : "Sign in with your browser";
  const lead = isRu ? "Это займёт минуту, а в следующий раз — в один клик." : "It takes a minute, and next time it's one click.";
  const dragNotice = isRu ? "Перетащите на панель закладок, а не нажимайте здесь." : "Drag it to the bookmarks bar instead of clicking.";
  const step1 = isRu
    ? `<b>Перетащите эту кнопку на панель закладок</b> (не нажимайте здесь):<br>
      <a class="bookmark" href="${href}" onclick="alert('${dragNotice}');return false">sc player sign-in</a><br>
      <span class="muted">Нет панели закладок? Нажмите <kbd>${modKey}</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd>.</span>`
    : `<b>Drag this button to your bookmarks bar</b> (don't click it here):<br>
      <a class="bookmark" href="${href}" onclick="alert('${dragNotice}');return false">sc player sign-in</a><br>
      <span class="muted">No bookmarks bar? Press <kbd>${modKey}</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd>.</span>`;
  const step2 = isRu
    ? `<b>Войдите в SoundCloud</b> в этом браузере как обычно: <a href="https://soundcloud.com/signin">soundcloud.com/signin</a>.<br>
      <span class="muted">Уже вошли? Просто откройте <a href="https://soundcloud.com/">soundcloud.com</a>.</span>`
    : `<b>Sign in to SoundCloud</b> in this browser as usual: <a href="https://soundcloud.com/signin">soundcloud.com/signin</a>.<br>
      <span class="muted">Already signed in here? Just open <a href="https://soundcloud.com/">soundcloud.com</a>.</span>`;
  const step3 = isRu
    ? `<b>На soundcloud.com нажмите закладку «sc player sign-in».</b> Браузер спросит, открыть ли sc player — подтвердите. sc player выполнит вход, и эту вкладку можно закрыть. После перезапуска приложения закладка тоже работает, но приложение сначала спросит подтверждение.`
    : `<b>On soundcloud.com, click the “sc player sign-in” bookmark.</b> The browser asks whether to open sc player — allow it. sc player signs in and this tab can be closed. After the app restarts the bookmark still works, but the app asks you to confirm first.`;
  const footer = isRu
    ? `Закладка лишь передаёт ваш вход SoundCloud в sc player на этом компьютере; она никуда ничего не отправляет. Относитесь к ней как к паролю: не делитесь снимками экрана адреса, который она открывает.`
    : `The bookmark only passes your SoundCloud sign-in to sc player on this computer; it sends nothing anywhere else. Treat it like a password: don't share screenshots of the address it opens.`;

  return `<!doctype html>
<html lang="${isRu ? "ru" : "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #07050d; color: #ece7ff; font: 16px/1.55 system-ui, sans-serif; }
  main { max-width: 600px; padding: 32px 20px; }
  h1 { font-size: 26px; margin: 0 0 6px; }
  .lead { color: #a79ed0; margin: 0 0 26px; }
  ol { padding-left: 22px; margin: 0; }
  li { margin: 0 0 22px; }
  .muted { color: #a79ed0; font-size: 14px; }
  a { color: #f2dc1a; }
  .bookmark { display: inline-block; margin: 10px 0 4px; padding: 9px 18px; border-radius: 8px; background: #f2dc1a; color: #07050d; font-weight: 700; text-decoration: none; cursor: grab; }
  kbd { border: 1px solid #4a3f78; border-radius: 4px; padding: 0 5px; font: 13px ui-monospace, monospace; }
</style></head>
<body><main>
  <h1>${h1}</h1>
  <p class="lead">${lead}</p>
  <ol>
    <li>${step1}</li>
    <li>${step2}</li>
    <li>${step3}</li>
  </ol>
  <p class="muted">${footer}</p>
</main></body></html>`;
}
