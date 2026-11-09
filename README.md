# MusicBridge

Converts Apple Music song links into Spotify links, and posts the result into a WhatsApp group via a small self-hosted bot.

One Node.js app runs everything:

- **Public converter** — `GET /?link=<apple-url>` 302-redirects to the matching Spotify URL (or `?type=uri` for a `spotify:` URI).
- **WhatsApp bot** — a persistent [Baileys](https://github.com/WhiskeySockets/Baileys) connection that watches one selected group, converts Apple Music links people post there, and replies with the Spotify link.
- **Admin UI** — a password-protected page at `/admin` to see connection status, scan the QR code, and choose the monitored group.

## Architecture

```
index.js                 boot: config -> store -> converter -> listener -> server
src/converter.js         shared Apple Music -> Spotify conversion (used by HTTP + WhatsApp)
src/whatsapp.js          Baileys socket lifecycle + message handling (single connection)
src/auth.js              Baileys auth-state backed by the KV store
src/store.js             KeyValueStore: Redis (Hostless) or local files (dev)
src/session.js           HMAC-signed admin session cookie
src/dedupe.js            in-memory message dedupe
src/server.js            Express app (/, /healthz, /admin, /api/*)
src/admin.html           admin UI
```

Persistence is abstracted behind `src/store.js`. On **Hostless the filesystem is not durable**, so WhatsApp credentials and settings are stored in a **managed Redis** database. Locally (no `REDIS_URL`) it falls back to JSON files under `DATA_DIR`.

## Requirements

- Node.js >= 20
- Spotify app credentials (client ID + secret) — create one in the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)

## Local development

```bash
npm install
cp .env.example .env   # then fill in SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, ADMIN_PASSWORD
npm start
```

- Open `http://localhost:3000/healthz` → `{"ok":true}`.
- Try the converter: `http://localhost:3000/?link=https://music.apple.com/us/song/...`.
- Open `http://localhost:3000/admin`, sign in with `ADMIN_PASSWORD`, scan the QR code, and select a group.

Without `REDIS_URL`, credentials/settings live in `./data/` (gitignored) — do not commit it.

## WhatsApp QR authentication

1. Start the app and open `/admin`.
2. Sign in. When the listener needs authentication it shows a QR code.
3. Open WhatsApp on the phone linked to the account you want to use → **Settings → Linked devices → Link a device**.
4. Scan the QR code.
5. Status flips to `open`. Select the group to monitor.

Credentials are persisted, so a normal restart **does not** require re-scanning. If the session is revoked/logged out, the app clears its stored credentials and shows a fresh QR automatically.

## Admin UI

- **Connection** — live status badge and (when needed) the QR code.
- **Monitored group** — list of groups the account belongs to; click one to monitor it. The choice is saved and survives restarts/redeploys, and takes effect immediately.
- **Recent errors** — last conversion/listener errors.

The whole admin area (including the QR code) is behind the `ADMIN_PASSWORD` login.

## Bookmarklet

`bookmark.js` is a browser bookmarklet. Replace `YOUR-HOSTLESS-APP-URL` with your deployed URL, create a new browser bookmark, and set its URL to the contents of `bookmark.js`. It redirects the current page through `/?link=`.

## Hostless deployment

1. Push this repository to GitHub.
2. In Hostless, **Create resource → App**, choose the repo and branch.
3. Keep automatic build detection; set the start command to `npm start` if it is not detected; set the health-check path to `/healthz`.
4. Create a **Redis** database and link it to the app (this injects `REDIS_URL`).
5. Add environment variables (below).
6. Deploy, then open `https://<your-app>/admin`, scan the QR, and select the group.

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `SPOTIFY_CLIENT_ID` | yes | Spotify app client ID |
| `SPOTIFY_CLIENT_SECRET` | yes | Spotify app client secret |
| `ADMIN_PASSWORD` | yes | Admin UI password |
| `SESSION_SECRET` | production | Long random string for admin session cookies (falls back to `ADMIN_PASSWORD` if unset) |
| `REDIS_URL` | Hostless | `rediss://...` connection string; selects the Redis store |
| `DATA_DIR` | no | Local file-store directory (default `./data`) |
| `PORT` / `HOST` | no | Hostless sets `PORT`; the app binds `0.0.0.0` by default |
| `LOG_LEVEL` | no | `pino` log level (default `info`) |
| `NODE_ENV` | optional | Set `production` so the admin session cookie uses `Secure` |

## Persistence & backup

Redis keys (all under the `musicbridge:` namespace):

- `auth:creds` — Baileys credentials.
- `auth:key:<type>:<id>` — signal/pre-key/session keys.
- `config:selectedGroup` — the monitored group JID.

Back up the Redis database (Hostless managed DB) to preserve the WhatsApp session. **Do not commit `data/`, `.env`, or any `auth:creds`/key material to Git.**

## Security notes

- Keep `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET`, `ADMIN_PASSWORD`, and `SESSION_SECRET` as environment variables only.
- Credentials, QR data, and signal keys are never logged.
- If the old `musicbridge-worker/` `.env`/`.dev.vars` files (which contained real Spotify secrets) were ever shared or committed elsewhere, rotate the Spotify client secret.
