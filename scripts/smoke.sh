#!/usr/bin/env bash
# End-to-end smoke test against a running Retro Deck instance.
# Usage: BASE_URL=http://127.0.0.1:3000 AUTH_USER=admin AUTH_PASSWORD=dev ./scripts/smoke.sh
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
AUTH_USER="${AUTH_USER:-admin}"
AUTH_PASSWORD="${AUTH_PASSWORD:?Set AUTH_PASSWORD}"
JAR="$(mktemp)"
FIX="$(mktemp -d)"
trap 'rm -f "$JAR"; rm -rf "$FIX"' EXIT

step() { echo "==> $*"; }
fail() { echo "FAIL: $*" >&2; exit 1; }

step "health"
curl -fsS "$BASE_URL/api/health" | grep -q '"ok":true' || fail "health"

step "login"
code=$(curl -s -o /dev/null -w '%{http_code}' -c "$JAR" -H 'Content-Type: application/json' \
  -d "{\"username\":\"$AUTH_USER\",\"password\":\"$AUTH_PASSWORD\"}" "$BASE_URL/api/auth/login")
[ "$code" = 200 ] || fail "login status $code"

step "wrong password is 401"
code=$(curl -s -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' \
  -d "{\"username\":\"$AUTH_USER\",\"password\":\"definitely-wrong\"}" "$BASE_URL/api/auth/login")
[ "$code" = 401 ] || fail "wrong password status $code"

step "unauthenticated /api/tracks is 401"
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/api/tracks")
[ "$code" = 401 ] || fail "unauthenticated tracks status $code"

step "generate fixture (wav + cover.jpg)"
FIX="$FIX" node <<'EOF'
const fs = require('node:fs');
const path = require('node:path');
const dir = path.join(process.env.FIX, 'Smoke Album');
fs.mkdirSync(dir, { recursive: true });
const rate = 8000, data = Buffer.alloc(rate); // 1s of 8-bit PCM silence (unsigned, center 0x80)
data.fill(0x80);
const hdr = Buffer.alloc(44);
hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + data.length, 4); hdr.write('WAVE', 8);
hdr.write('fmt ', 12); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(1, 22);
hdr.writeUInt32LE(rate, 24); hdr.writeUInt32LE(rate, 28); hdr.writeUInt16LE(1, 32); hdr.writeUInt16LE(8, 34);
hdr.write('data', 36); hdr.writeUInt32LE(data.length, 40);
fs.writeFileSync(path.join(dir, 'smoke.wav'), Buffer.concat([hdr, data]));
const jpg = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
  'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
fs.writeFileSync(path.join(dir, 'cover.jpg'), jpg);
EOF

step "upload folder with cover (alternating files/paths)"
resp=$(curl -fsS -b "$JAR" \
  -F "files=@$FIX/Smoke Album/smoke.wav;type=audio/wav" -F "paths=Smoke Album/smoke.wav" \
  -F "files=@$FIX/Smoke Album/cover.jpg;type=image/jpeg" -F "paths=Smoke Album/cover.jpg" \
  "$BASE_URL/api/library/upload")
echo "    $resp"
echo "$resp" | grep -q '"added":1' || fail "upload: expected added=1"
echo "$resp" | grep -q '"coversApplied":1' || fail "upload: expected coversApplied=1"

step "tracks search"
tracks=$(curl -fsS -b "$JAR" "$BASE_URL/api/tracks?q=smoke")
echo "$tracks" | grep -q '"total":1' || fail "tracks: expected total=1"
tid=$(echo "$tracks" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s).items[0].id))")
[ -n "$tid" ] || fail "tracks: missing id"

step "stream with Range -> 206"
code=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" -H 'Range: bytes=0-99' "$BASE_URL/api/tracks/$tid/stream")
[ "$code" = 206 ] || fail "range stream status $code"

step "cover -> 200"
code=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" "$BASE_URL/api/tracks/$tid/cover")
[ "$code" = 200 ] || fail "cover status $code"

step "favorite toggle persists"
curl -fsS -b "$JAR" -X PUT -H 'Content-Type: application/json' -d '{"favorite":true}' \
  "$BASE_URL/api/tracks/$tid/favorite" | grep -q '"favorite":true' || fail "favorite set"
curl -fsS -b "$JAR" "$BASE_URL/api/tracks?favorite=1" | grep -q '"total":1' || fail "favorite filter"

step "playlist create + ordered tracks"
pl=$(curl -fsS -b "$JAR" -X POST -H 'Content-Type: application/json' -d '{"name":"Smoke List"}' \
  "$BASE_URL/api/playlists")
pid=$(echo "$pl" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s).id))")
[ -n "$pid" ] || fail "playlist: missing id"
curl -fsS -b "$JAR" -X PUT -H 'Content-Type: application/json' -d "{\"trackIds\":[\"$tid\"]}" \
  "$BASE_URL/api/playlists/$pid/tracks" | grep -q "$tid" || fail "playlist: track not stored"
curl -fsS -b "$JAR" "$BASE_URL/api/tracks?playlistId=$pid" | grep -q '"total":1' || fail "playlist filter"
curl -fsS -b "$JAR" -X DELETE -o /dev/null "$BASE_URL/api/playlists/$pid" || fail "playlist delete"

echo "SMOKE OK"
