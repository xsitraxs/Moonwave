# Moonwave server

One small VPS runs everything the app needs from its own side:

| Part | Where | What |
|---|---|---|
| **Proxy** | `caddy/` | HTTPS forward proxy for SoundCloud only (site, API, audio, artwork, bot protection). Anything else is refused. Without the password it looks like an ordinary site. |
| **API** | `api/` | `/v1/*`: the track messenger (friend codes, no accounts), the theme workshop, a pseudonymous count of running apps (off unless the person turns it on). Node 24, SQLite, no packages. |

Caddy takes the certificate from Let's Encrypt itself and renews it (no e-mail needed: Let's Encrypt no longer sends expiry notices).

## What it stores

- **Messenger:** a random friend code, the name the user typed, friendships, and the tracks sent (SoundCloud id, title, artist, cover and page links). "Listening now" only when the user turns it on, and only the current track. Deleting the profile in the app (`DELETE /v1/me`) removes all of it.
- **Workshop:** published themes — name, description, the appearance knobs, optional CSS (style only: no `url()`, `@import`, fonts or scripts; checked here and again in the app), an optional background image or video (up to 25 MB, type checked by its bytes) and a preview image. Three reports hide a theme until a moderator looks.
- **Counter:** only while the person keeps it on (Settings → Messenger; a new install starts with it off). Once a day
  per install — a random install id and the app version. No IP, no account, nothing else.
- **Listening:** only while the person keeps it on. A track id, no device secret, no account — "Listening on sc
  player" is written without asking anyone who listened.

## Deploy

On a fresh Ubuntu/Debian VPS (1 vCPU / 1 GB is plenty):

```bash
ssh -i ~/.ssh/moonwave-vps root@<ip>
curl -fsSL https://get.docker.com | sh
ufw allow 22,80,443/tcp && ufw allow 443/udp && ufw --force enable
mkdir -p /opt/moonwave
```

From this folder on your PC:

```bash
scp -i ~/.ssh/moonwave-vps -r caddy api docker-compose.yml .env.example root@<ip>:/opt/moonwave/
```

On the server:

```bash
cd /opt/moonwave
cp .env.example .env && nano .env      # domain, proxy password and secret name, admin token
docker compose up -d --build
curl https://<domain>/v1/health         # {"ok":true}
```

**The domain.** Let's Encrypt needs a name, not a bare IP. Any domain works (an A record to the IP). Free and with no account: [sslip.io](https://sslip.io), whose names point at the IP written in them (`203-0-113-5.sslip.io`).

## Hooking up the app

At build time, next to `package.json` (both files are in `.gitignore`):

- `server.local.json` — `{ "api": "https://<domain>" }`: turns on Inbox, Send to friends, the Workshop and the counter.
- `proxy.local.json` — `{ "host": "<domain>", "port": 443, "username": "<SCP_USER>", "password": "<SCP_PASS>", "secret": "<SCP_SECRET_HOST>" }`: the built-in proxy.

## Day to day

```bash
docker compose logs -f api                       # what the API is doing
docker compose pull && docker compose up -d --build   # after updating the files
curl https://<domain>/v1/stats                   # running apps today / week / month
```

Moderation (the token from `.env`):

```bash
curl -H "Authorization: Admin $ADMIN_TOKEN" https://<domain>/v1/admin/themes          # reported or hidden
curl -X POST -H "Authorization: Admin $ADMIN_TOKEN" https://<domain>/v1/admin/themes/<id>/keep   # fine, show again
curl -X POST -H "Authorization: Admin $ADMIN_TOKEN" https://<domain>/v1/admin/themes/<id>/hide
curl -X DELETE -H "Authorization: Admin $ADMIN_TOKEN" https://<domain>/v1/themes/<id>
```

Backup (the database and theme files live in the `api-data` volume):

```bash
docker run --rm -v moonwave_api-data:/d -v $PWD:/b alpine tar czf /b/api-data-$(date +%F).tgz -C /d .
```

## Developing

```bash
cd api
DATA_DIR=./data-dev ADMIN_TOKEN=dev-admin-token-0123456789 node src/main.ts   # TRUST_PROXY is off unless set
ADMIN_TOKEN=dev-admin-token-0123456789 node test/smoke.ts     # the whole API end to end
```

**`TRUST_PROXY`.** The rate limits are counted per client address, and the address comes from `X-Forwarded-For` only
when `TRUST_PROXY=1`. It is off by default — behind a proxy that is not Caddy, a client could otherwise pick its own
bucket and every limit would be pointless. `docker-compose.yml` sets it to `1` for the Caddy in front; when you run
the API directly, leave it unset (or `0`) and send requests to it without a proxy. With a proxy in front on your own,
set `1` and make sure nothing can reach the API's port without going through it.

## API

All JSON. A device registers once and keeps its secret; requests carry `Authorization: Bearer <secret>`.

| | |
|---|---|
| `POST /v1/register` `{name}` | → `{code, secret, name}` |
| `GET/PUT/DELETE /v1/me` | profile: `{name, shareNow}`; DELETE forgets everything |
| `PUT /v1/me/now` `{track\|null}` | what is playing (kept only with shareNow) |
| `GET /v1/friends`, `POST /v1/friends` `{code}` | list; add by code (a request, or friends at once if they asked first) |
| `POST /v1/friends/:code/accept`, `DELETE /v1/friends/:code` | accept; decline / cancel / unfriend |
| `POST /v1/send` `{to: [codes], track}` | send a track to friends |
| `GET /v1/updates?since=<msgId>&v=<friendsV>` | new tracks, unread per friend, states, friends' "now", the list when it changed |
| `GET /v1/chat/:code?before=<id>`, `POST /v1/chat/:code/seen` | the conversation with one friend; mark read |
| `POST /v1/messages/:id/state` `{state}` | heard / liked / queued (the recipient) |
| `POST /v1/ping` `{install, version}`, `GET /v1/stats` | the counter |
| `GET /v1/themes?sort=new\|top&page=&q=&mine=1` | workshop list |
| `POST /v1/themes` `{name, description, look, css}` | a new theme (hidden until it has a preview) |
| `PUT /v1/themes/:id/background`, `PUT /v1/themes/:id/preview` | raw file bodies |
| `GET /v1/themes/:id`, `…/background`, `…/preview` | a theme and its files |
| `POST /v1/themes/:id/like\|install\|report`, `DELETE /v1/themes/:id` | |
