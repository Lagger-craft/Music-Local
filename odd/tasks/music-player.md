# Feature: retro-deck local music player (Dokploy-deployable)

Local music player web app: Node.js API + React (Vite) frontend styled after `wireframes/retro.html`,
deployable as a single Docker image with Dokploy. Music enters the library only via upload from the UI
(files or a whole folder with its cover art). Single-user auth by env credentials.

## Specs

- **S1 — Dokploy-compatible deployment.** User: "la idea esque sea una app que sea compatible para desplegar
  con dokploy". Deliver one multi-stage `Dockerfile` producing a single image that serves API + built SPA on
  `PORT` (default 3000); a `docker-compose.yml` with a persistent volume mounted at `/data`; a `.dockerignore`;
  a `README.md` with local dev instructions and concrete Dokploy steps (deploy from Git repo using the
  Dockerfile, or via the compose file, plus persistent volume setup).
- **S2 — Retro aesthetic.** User: "debe de tener la estetica del wireframe @wireframes/retro.html". The deck
  reproduces the wireframe: wood-grain backdrop; cream/orange plastic body (`--plastic #efe3cf`,
  `--plastic-dark #d9c7ab`, `--orange #ff6b1a`, `--ink #2b2118`, `--lcd-bg #1d2b1f`, `--lcd-text #8df08d`);
  3px ink borders, hard offset shadows, inset highlights; brand bar; cassette window with two reels that spin
  only while playing (one slower); LCD strip with status line and scrolling marquee; tape-counter progress rail
  (click to seek) with `m:ss` labels; five chunky transport buttons (rewind, play/pause, stop, forward, like)
  with pressed states; playlist index as stacked index-card rows (active row in orange). Same palette, borders
  and Courier-style typography applied to library/upload/playlist panels. Layout: deck plus side panel on wide
  screens, stacked on mobile.
- **S3 — Add music by upload.** User: "uno debe de poder agregar musica o una carpeta con musica y su cartola".
  Upload from the UI of (a) loose files (audio + cover images) or (b) an entire folder via `webkitdirectory`,
  preserving each file's relative path. Server stores files under `DATA_DIR`, parses tags with `music-metadata`,
  extracts embedded cover pictures, and applies folder covers: any image named
  `cover|folder|album|front` (any case, optional ` - ...` suffix) in `.jpg/.jpeg/.png/.webp` becomes the cover of
  all audio files in the same folder that lack an embedded picture. Audio formats: mp3, flac, m4a, aac, ogg,
  opus, wav. Upload response reports added tracks, skipped files (with reason) and errors (with filename).
- **S4 — Simple login by env.** User decision: "Login simple por env". `MUSIC_AUTH_USER` (default `admin`) and
  `MUSIC_AUTH_PASSWORD` (if unset: generate a random one at boot and log it prominently). Login sets an
  httpOnly, SameSite=Lax cookie holding an HS256 JWT (30 days). All `/api/*` routes except `POST /api/auth/login`
  return 401 without a valid cookie. Constant-time credential comparison and a per-IP throttle (5 failed
  attempts / 15 min → 429) on login. `POST /api/auth/logout` clears the cookie.
- **S5 — Requested features.** User decision: favorites, playlists, search/filters, real VU meters.
  - Favorites: heart toggles per track, persisted server-side.
  - Playlists: create, rename, delete; add/remove tracks; ordered list (order = explicit array order); play a
    playlist as the queue.
  - Search/filters: server-side search by title/artist/album (`q`), filter by exact artist and album, filter
    favorites only; library overview with album/artist facets for the filter chips.
  - Real VU meters: three bars driven by a Web Audio `AnalyserNode` on the audio element (graph:
    MediaElementSource → analyser → destination), created lazily on the first user play gesture.
- **S6 — Stack.** User decision: "Node.js + React (Vite)". Backend: Node >= 24 ESM, Express 5, multipart via
  busboy, `music-metadata` for tags, `jose` for JWT, built-in `node:sqlite` (`DatabaseSync`) for persistence
  (fallback only if unusable: better-sqlite3). Backend is plain JS, no build step. Frontend: React + Vite in
  `web/` (TypeScript), no router and no global state library, plain `fetch`, Vite dev proxy `/api` →
  `localhost:3000`. `npm test` in `server/` runs vitest + supertest with synthetic fixtures (generated in-code,
  no ffmpeg). UI copy in English (wireframe is English). Commit both lockfiles.

## API contract (authoritative for both writers)

Base: same-origin `/api`, JSON unless noted. Cookie `mm_sid` (httpOnly) required. UUID string ids.

Storage layout under `DATA_DIR` (default `./data`): `library.db`, `music/<trackId>/<originalname>`,
`covers/<coverId>.<ext>`.

SQLite schema: `tracks(id, title, artist, album, album_artist, genre, year, track_no, duration, filename,
stored_path, cover_id, created_at)`; `covers(id, path, source)` source ∈ `embedded|folder`;
`playlists(id, name, created_at)`; `playlist_tracks(playlist_id, track_id, position)` PK(playlist_id, track_id);
`favorites(track_id, created_at)` PK track_id. Track defaults: missing title → filename without extension;
missing artist → `Unknown Artist`; missing album → `Unknown Album`. Ordering everywhere: artist, album, track_no,
title.

- `GET /api/health` → 200 `{ok:true}` (no auth; container healthcheck).
- `POST /api/auth/login` `{username,password}` → 200 `{user}` + Set-Cookie; 401 on bad credentials; 429 throttled.
- `POST /api/auth/logout` → 204. `GET /api/auth/me` → 200 `{user}` | 401.
- `GET /api/tracks?q=&artist=&album=&favorite=1&playlistId=&limit=&offset=` → 200
  `{total, items:[{id,title,artist,album,trackNo,duration,favorite,coverUrl}]}`; `coverUrl` is
  `/api/tracks/:id/cover` or `null`. Without `playlistId` order artist→album→track_no→title; with it, playlist
  position order.
- `GET /api/tracks/:id/stream` → audio bytes, `Accept-Ranges: bytes`, HTTP Range support (206 +
  `Content-Range`), correct Content-Type by extension.
- `GET /api/tracks/:id/cover` → 200 image bytes (track's cover) | 404.
- `POST /api/library/upload` — multipart; form fields alternate `files` (one file) and `paths` (its
  repository-relative path string as sent by the client, e.g. `My Album/01 - song.mp3`); if a `paths` entry is
  missing for a file, use its basename. → 200 `{added:number, tracks:[track…], skipped:[{filename,reason}],
  coversApplied:number, errors:[{filename,error}]}`.
- `GET /api/library/overview` → 200 `{trackCount, albumCount, artistCount, albums:[{name,artist,trackCount,
  coverUrl}], artists:[{name,trackCount}]}`.
- `PUT /api/tracks/:id/favorite` `{favorite:boolean}` → 200 `{favorite}`.
- `GET /api/playlists` → `{items:[{id,name,trackCount}]}`; `POST /api/playlists` `{name}` → 201 playlist;
  `PATCH /api/playlists/:id` `{name}` → 200; `DELETE /api/playlists/:id` → 204;
  `GET /api/playlists/:id/tracks` → `{items:[track+{position}]}`;
  `PUT /api/playlists/:id/tracks` `{trackIds:[…]}` → 200 `{items:[…]}` full replace in array order.

Server also serves the built SPA from `web/dist` (static + SPA fallback to `index.html`); missing dir is fine
in dev (API-only).

Frontend behavior: clicking a track sets the current queue to the visible list and plays; transport navigates
the queue; `ended` auto-advances; stop resets to queue start position 0:00; deck status shows
`PLAY ▶ / PAUSE ▮▮ / STOP ■  TRACK nn` like the wireframe; marquee shows `Now playing: <title> — by <artist> ...`.
Upload panel: two buttons (files / folder), progress bar, result summary (added / skipped / errors), then
library refresh.

## Tasks

- T1 (S4,S6) — backend writer — scaffold `server/`: package.json (ESM, `type:module`), env config, SQLite
  schema init, auth login/logout/me + JWT cookie + throttle + constant-time compare, app error handling;
  vitest+supertest auth tests with synthetic fixtures scaffolding. Commit: d35e1b1.
- T2 (S3,S6) — backend writer — upload pipeline: busboy multipart pairing `files`/`paths`, tag parsing
  (`music-metadata`), embedded picture extraction, folder-cover rule, storage layout, skip/error reporting;
  tests for tag parsing, folder-cover association, embedded-cover priority. Commit: d35e1b1.
- T3 (S3,S5,S6) — backend writer — library API: tracks list with q/artist/album/favorite/playlistId filters,
  overview facets, cover endpoint, streaming with Range (206/Content-Range, Content-Type); tests for filters,
  range requests, cover fallback 404. Commit: d35e1b1.
- T4 (S5) — backend writer — favorites + playlists endpoints; tests for toggle persistence, playlist CRUD,
  full-replace ordering, playlist-scoped track listing. Commit: d35e1b1.
- T5 (S2,S6) — web writer — `web/` scaffold (Vite react-ts), design tokens from wireframe, login screen,
  deck shell (brand, cassette window + reels, LCD, meters, rail, transport, index-card list) faithful to
  `wireframes/retro.html`, responsive layout deck+panel. Commit: 2abba3e.
- T6 (S2,S5) — web writer — player logic: audio element + queue, transport, marquee/status, click-to-seek
  progress, real VU meters via Web Audio analyser (lazy AudioContext), auto-advance on `ended`. Commit: 2abba3e.
- T7 (S3,S5) — web writer — library view: debounced search, artist/album/favorite filter chips, track list,
  upload panel (files + `webkitdirectory` folder, alternating `files`/`paths` fields, progress, summary),
  favorites toggle wiring. Commit: 2abba3e.
- T8 (S5) — web writer — playlists view: create/rename/delete, select playlist, add/remove tracks from the
  library, play playlist as queue. Commit: 2abba3e.
- T9 (S1) — parent — root `Dockerfile` (multi-stage: build `web` → static, run `server` + static on PORT,
  non-root user, `DATA_DIR=/data`), `.dockerignore`, `docker-compose.yml` with `/data` volume, `README.md`
  (dev, docker, Dokploy). Commit: a724069.
- T10 (all) — parent — end-to-end verification: backend suite green, `vite build` green, `docker build` +
  smoke test (login → upload fixture → list → stream range → playlist), work-unit commits, final report.
  Commits: d35e1b1 (server), 2abba3e (web), a724069 (deploy), fba98a5 (auth hardening); this docs commit closes T10.

## Log

- L1 — User request (verbatim): "Podemos intentar realizar un reproductor de musica local, la idea esque sea
  una app que sea compatible para desplegar con dokploy. Ademas debe de tener la estetica del wireframe
  @wireframes/retro.html\n\nTambien tener en cuenta que uno debe de poder agregar musica o una carpeta con
  musica y su cartola."
- L2 — Decisions (user, via question batch): add music = **solo upload desde la UI** (no folder mount);
  stack = **Node.js + React (Vite)**; auth = **login simple por env**; extras = **favoritos, listas de
  reproducción, búsqueda y filtros, VU meters reales** (all four selected).
- L3 — Evidence (parent, T10): backend 45/45 vitest green and web `tsc -b && vite build` green, both observed
  by the parent; Docker image built; in-container smoke OK (health, login, 401s, folder upload with
  `coversApplied:1`, Range 206, cover 200, favorite persistence, playlist CRUD, SPA served, clean logs).
  Commits: d35e1b1 (server, Risk line item 2), 2abba3e (web), a724069 (deploy).
- L4 — Parent fix (test-first RED→GREEN, +3 tests): `TRUST_PROXY` env parsed into express `trust proxy` so
  the login throttle keys on the real client IP behind Dokploy's proxy and cannot be spoofed when the API is
  exposed directly; README/compose document it. Also corrected Dockerfile CMD to `server/src/server.js`.
- L8 — Rebuild + smoke on the hardened image: REBUILD-SMOKE OK (job-2, exit 0). Final assess over the
  committed range (base 7d40917, committed-only): risk medium / nativeRisk high → reviewDue=true. Plan:
  writer self-verification stands, no further verifier.
- L5 — Assess (native): risk high, escalation item 2 applied → plan = writer self-verification (observed) +
  independent verifier (launched, gentle-ai-verify on the auth block).
- L6 — Verify (gentle-ai-verify, independent, item 2): HIGH empty `MUSIC_AUTH_PASSWORD` silently disabled
  auth; MEDIUM missing `Secure` cookie, `TRUST_PROXY=true` leftmost-XFF throttle evasion, shared bucket
  behind proxy; LOW unpinned JWT alg. Preserves confirmed clean: credential compare constant-time, expired/
  wrong-secret/`alg=none` 401, guard completeness, static cannot shadow /api, throttle window boundary.
- L7 — Fixes (parent, test-first RED→GREEN, +7 tests in `server/test/auth-security.test.js`, suite 52/52):
  empty/whitespace password now generates + banners (S4 branch), `algorithms:['HS256']` pinned on verify,
  `MUSIC_COOKIE_SECURE` env, `TRUST_PROXY=true` → 1 hop, README advisories (bucket lockout, stable
  `MUSIC_AUTH_SECRET` for restarts). Also fixed test cleanup: vitest context uses `onTestFinished`, not
  `after` (helper had silently no-op'd).
- L9 — Native review close (lineage review-427385610f2267e9): full-feature candidate exceeded the lens
  context budget (no authority created), so the review ran on the reduced suffix `a724069..HEAD` (auth
  hardening + docs, 7 paths, tier high, lenses risk/readability/reliability). Result: **approved**, all 3
  reviewers submitted, acknowledgement burned (`native-approved-acknowledgement-completed`). 9 advisory
  findings, all informational/non-blocking (trust-proxy true→1 mapping note, test cleanup hygiene in
  helpers.js/auth-security.test.js, doc wording) — recorded as later work, not re-review triggers.
- L10 — User report (verbatim): "Una duda puedes seguir con lo que falto anteriormente. Ya que por mas que
  agrege las canciones al ser muchas, como mas de 500, se queda como pegado y no deja de cargar." Diagnosis:
  the in-flight batching work never split a directory larger than the batch budget (commented as a cover
  trade-off), so the common case — one folder with 500+ songs — still went as a single giant multipart POST
  that stalls the UI and dies behind Traefik's readTimeout. Fix (test-first): extracted the pure planning
  logic to `web/src/hooks/batching.ts`; `planBatches` now chunks oversized directories (≤20 files / ≤30 MB
  per request) and repeats the folder cover in every chunk so the server keeps pairing cover + tracks
  within each request; small folders still ride together; a lone oversized file travels alone, still with
  the cover; cover-only folders are chunked instead of repeated. Added `web/test/batching.test.ts` via
  `node --test` (no new deps). RED: 3 failures incl. "a 500-track folder must not stay in one request" →
  GREEN 5/5; server suite 53/53; `vite build` green. Scratch e2e (real `planBatches` → real server over
  HTTP): 60-track folder + cover → 3 requests, coversApplied 60, every track has coverUrl. Slice boundary:
  5b639fc (server abort cleanup), acd4e9e (web batching), 183fefc (chore: Tailscale certs ignored) — all on
  `main` per the user's Dokploy-from-main decision; user must redeploy for the fix to reach the app.
- L11 — Native review close (lineage review-7bc1f234bf27c415, target sha256:73f731ad…, base-diff
  e5a548f..HEAD committed-only, tier medium, lenses resilience+reliability): **approved**, 2/2 reviewers
  submitted via host relay, acknowledgement burned (`native-approved-acknowledgement-completed`). 6 advisory
  findings, all informational/non-blocking and recorded as later work, never re-review triggers:
  abort-test timing window (upload.test.js:218-225), duplicated FOLDER_COVER_RE mirror in web tests,
  silent `xhr.onabort` continue (useUpload.ts:93), fire-and-forget abort cleanup (library.js:257),
  500ms cleanup sleep in the abort test, and no retry/restart-overlap guard (useUpload.ts:95).
