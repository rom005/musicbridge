# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm install`
- `npm start` — runs `node index.js` (Express HTTP server + Baileys WhatsApp listener in one process).
- `npm test` — runs the Node.js built-in test runner (`node --test`) over `test/*.test.js`.

## Architecture

MusicBridge converts an Apple Music song link into a Spotify link, and additionally runs a WhatsApp bot that watches a selected group and replies with the Spotify link.

One Node.js app (ESM, `"type": "module"`) runs everything:

- `index.js` — boot order: load config → create store → create converter → create listener → create Express app → `app.listen(PORT, '0.0.0.0')` → `listener.start()` → graceful shutdown on SIGINT/SIGTERM.
- `src/converter.js` — shared conversion (`getSpotifyToken` → `getAppleMetadata` (scrapes `#schema:song` JSON-LD) → `searchSpotify`), plus URL helpers and `createConverter`. Used by both the HTTP route and the WhatsApp listener. Injectable `http` client for tests; Spotify token is cached (~50 min).
- `src/whatsapp.js` — a single Baileys socket with start/stop, reconnect, QR emission, `messages.upsert` handling (group filter, own-message skip, dedupe, convert, reply). Never crashes on conversion errors.
- `src/auth.js` — Baileys auth state persisted to the KV store (mirrors `useMultiFileAuthState`; serializes signal keys with `BufferJSON`).
- `src/store.js` — `KeyValueStore` with two backends: Redis (`REDIS_URL`, via ioredis) and local files (`DATA_DIR`, dev only). Hostless filesystem is not durable, so Redis is required there.
- `src/server.js` + `src/admin.html` — Express routes (`/`, `/healthz`, `/admin`, `/api/*`) and the admin UI.
- `src/session.js` — dependency-free HMAC-signed admin session cookie.
- `src/dedupe.js` — bounded in-memory dedupe map.

## Configuration & secrets

- Spotify: `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET`.
- Admin: `ADMIN_PASSWORD`, `SESSION_SECRET` (falls back to `ADMIN_PASSWORD`).
- Persistence: `REDIS_URL` (selects Redis backend; file backend otherwise) and `DATA_DIR` (default `./data`).
- Copy `.env.example` to `.env` locally. Neither `.env` nor `data/` is committed (see `.gitignore`).

## Notes

- `@whiskeysockets/baileys` is CommonJS; import it once in `src/baileys.js` and re-export what you need (named ESM imports are unreliable from CJS).
- Signal-key values are heterogeneous (Buffers/proto/plain objects) — serialize with `BufferJSON.replacer/reviver`, not plain `JSON.stringify`.
- The listener must stay a single socket: `src/whatsapp.js` nulls `sock` before any reconnect and guards `start()` with a `connecting` flag.
