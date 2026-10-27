import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tracks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  album TEXT NOT NULL,
  album_artist TEXT,
  genre TEXT,
  year INTEGER,
  track_no INTEGER,
  duration REAL,
  filename TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  cover_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS covers (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('embedded', 'folder'))
);
CREATE TABLE IF NOT EXISTS playlists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS playlist_tracks (
  playlist_id TEXT NOT NULL,
  track_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (playlist_id, track_id)
);
CREATE TABLE IF NOT EXISTS favorites (
  track_id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tracks_artist_album ON tracks (artist, album, track_no, title);
CREATE INDEX IF NOT EXISTS idx_playlist_tracks_order ON playlist_tracks (playlist_id, position);
`;

/** Open (and create if needed) the library database, applying the schema. */
export function openDatabase(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'library.db'));
  db.exec(SCHEMA);
  return db;
}
