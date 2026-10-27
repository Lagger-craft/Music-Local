# Retro Deck — local music player

A self-hosted music player with a retro cassette-deck interface (Y2K skeuomorphic style), deployable as a
single Docker image with [Dokploy](https://dokploy.com). Music enters the library only by uploading files or
a whole folder (with its cover art) from the web UI.

## Features

- Retro deck UI: spinning reels, LCD marquee, real VU meters (Web Audio), tape-counter seek bar, chunky
  transport buttons.
- Upload audio files or an entire folder (cover art stays with the album).
- Reads tags (title/artist/album/track no/genre/year/duration) and embedded cover art with `music-metadata`.
- Folder covers: `cover.jpg`, `folder.jpg`, `album.jpg` or `front.*` inside an uploaded folder applies to all
  tracks in that folder without embedded art.
- Search and filter by artist, album and favorites.
- Favorites and ordered playlists.
- Single-user login (env credentials), httpOnly session cookie.
- HTTP Range streaming (seek in any track).

Supported audio: `.mp3`, `.flac`, `.m4a`, `.aac`, `.ogg`, `.opus`, `.wav`.

## Environment variables

| Variable               | Default           | Notes                                              |
| ---------------------- | ----------------- | -------------------------------------------------- |
| `MUSIC_AUTH_USER`      | `admin`           | Login username.                                    |
| `MUSIC_AUTH_PASSWORD`  | random at boot    | Login password. Empty/unset generates a random one at boot (never disables auth). Set it explicitly in production. |
| `MUSIC_AUTH_SECRET`    | random at boot    | Session signing key. Set a stable value so logins survive container restarts. |
| `MUSIC_COOKIE_SECURE`  | `false`           | Set `true` to mark the session cookie `Secure` (use behind TLS; leave unset on plain-HTTP local access). |
| `PORT`                 | `3000`            | HTTP port.                                         |
| `TRUST_PROXY`          | `0` (compose: `1`) | Trusted reverse-proxy hops for client IP resolution. `1` behind a proxy (Dokploy/Traefik), `0` when exposed directly. Numeric hops only (`true` is interpreted as `1`). With `0` behind a proxy all clients share one throttle bucket: 5 failed logins lock login for 15 minutes. |
| `DATA_DIR`             | `/data` (in Docker) | Library DB, uploaded music and covers.           |

If `MUSIC_AUTH_PASSWORD` is unset, a random password is generated and printed in the container logs at boot.

## Local development

Requires Node.js >= 24.

```bash
# terminal 1 — API on :3000
cd server
npm install
MUSIC_AUTH_PASSWORD=dev npm run dev

# terminal 2 — SPA on :5173 (proxies /api to :3000)
cd web
npm install
npm run dev
```

Open http://localhost:5173 and log in with `admin` / `dev`.

Backend tests:

```bash
cd server && npm test
```

## Docker

```bash
docker build -t retro-deck-music .
docker run -d --name music-player \
  -p 3000:3000 \
  -e MUSIC_AUTH_PASSWORD=change-me \
  -v music-data:/data \
  retro-deck-music
```

Or with Compose:

```bash
MUSIC_AUTH_PASSWORD=change-me docker compose up -d
```

The named volume `music-data` is mounted at `/data` and holds the database, uploaded audio and covers.

## Deploying with Dokploy

Any of the two Dokploy paths works; both keep `/data` persistent:

### Option A — Git repository (Dockerfile)

1. Push this repository to your Git provider.
2. In Dokploy: **New Project → Git** → select the repository, branch `main` (or your feature branch).
3. Build type **Dockerfile**, Dockerfile path `Dockerfile`.
4. Under **Environment**, set `MUSIC_AUTH_PASSWORD` (and optionally `MUSIC_AUTH_USER`), plus `TRUST_PROXY=1`
   (Dokploy routes traffic through its proxy, so the login throttle needs the real client IP).
5. Under **Advanced → Storage**, add a persistent volume mounted at `/data` (e.g. host path or Dokploy
   volume), then **Deploy**.
6. Open the generated domain and log in.

### Option B — Docker Compose

1. In Dokploy: **New Project → Compose** → point at this repository (or paste the `docker-compose.yml`).
2. Set `MUSIC_AUTH_PASSWORD` in the compose environment (Dokploy's **Environment** tab).
   The compose file already defaults `TRUST_PROXY=1` (correct behind Dokploy's proxy); set it to `0` if you
   expose the port directly with no reverse proxy in front.
3. The compose file already declares the named volume `music-data:/data`; Dokploy provisions it.
4. **Deploy**. Healthchecks use `GET /api/health`.

## Using the library

- **Upload files**: *Library → Upload files*, pick audio files (and optional cover images).
- **Upload a folder**: *Library → Upload folder*; the folder structure is preserved, so keep the cover image
  (`cover.jpg` etc.) next to the tracks and it will be applied automatically.
- Click any track to play it as the queue; use the heart to favorite it; manage playlists in the
  *Playlists* tab.
