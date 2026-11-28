# Karaoke demo preview

A self-contained demo of Moonwave's karaoke (synced text, word-by-word highlighting, backing vocals, instrumental
breaks) that runs in a plain browser — no Electron build and no network access required.

It works by serving the production build from `../out/renderer` plus a generated `demo-stub.js` that replaces the
Electron bridge (`window.sky`) with a canned Russian synthwave track ("Ночной экспресс") and word-by-word timed
lyrics. The audio is a generated A-minor synthwave loop (`demo.wav`); artwork is an inline SVG data URI. The page
starts the track and opens the full screen player with the lyrics tab selected — but sound still needs a click on
**Play** (browsers block autoplay).

## Run it

```sh
npm run build                # builds out/renderer (required)
node demo-preview/gen.mjs    # synthesizes demo.wav (deterministic; *.wav is git-ignored)
node demo-preview/stub.mjs   # copies out/renderer -> demo-preview/app, writes demo-stub.js
node demo-preview/serve.mjs  # serves on 0.0.0.0:4173
```

`demo-preview/app/` (the copied build) is git-ignored and rebuilt from scratch by `stub.mjs`.

Open `http://localhost:4173/` (redirects to `/index.html?sc-debug`; the `sc-debug` flag exposes the app's state on
`window.__sc`, which the stub uses to queue the track and open the player).

`gen.mjs` synthesizes `demo.wav` from scratch (it is deterministic) and would rewrite `lyrics.json`; the timings in `lyrics.json` are committed, the audio is not.

## Notes and limits

- **CSP**: the production build ships `script-src 'self'`, so the stub is an external same-origin file loaded with a
  plain `<script src="/demo-stub.js">` — inline `<script>` would be refused. Never inline it.
- Nothing here talks to the network: the audio, lyrics, cover and every `window.sky` channel come from local files or
  the stub. `/demo.wav` supports HTTP range requests so scrubbing works.
- `demo-preview/` is **not committed** (it is registered in `.git/info/exclude`) and is rebuilt from scratch by
  `stub.mjs` (`app/` is deleted and re-copied each time). Keep generated binaries out of Git.
- This is a review aid, not a release artifact. Live behaviour in the real Electron app still needs a machine without
  the sandbox's network restrictions (the Electron binary can't be downloaded here, so `npm run dev` / `SKY_DEMO=1`
  was not possible in the environment this was built in).
