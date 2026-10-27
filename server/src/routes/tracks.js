import fs from 'node:fs';
import { Router } from 'express';
import {
  audioMime,
  dataPath,
  httpError,
  imageMime,
  trackToApi,
} from '../util.js';

const DEFAULT_ORDER = 'tracks.artist, tracks.album, tracks.track_no, tracks.title';

function parseNonNegInt(value, name) {
  if (value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw httpError(400, `${name} must be a non-negative integer`);
  return n;
}

export function createTracksRouter({ config, db }) {
  const router = Router();
  const getTrack = db.prepare('SELECT * FROM tracks WHERE id = ?');
  const isFavorite = db.prepare('SELECT 1 FROM favorites WHERE track_id = ?');

  // LIKE wildcard escaping keeps q a literal substring search.
  const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

  router.get('/tracks', (req, res) => {
    const { q, artist, album, playlistId } = req.query;
    const favorite = req.query.favorite === '1' || req.query.favorite === 'true';
    const limit = parseNonNegInt(req.query.limit, 'limit');
    const offset = parseNonNegInt(req.query.offset, 'offset');

    const where = [];
    const params = [];
    if (q) {
      where.push("(tracks.title LIKE ? ESCAPE '\\' OR tracks.artist LIKE ? ESCAPE '\\' OR tracks.album LIKE ? ESCAPE '\\')");
      const like = `%${escapeLike(String(q))}%`;
      params.push(like, like, like);
    }
    if (artist) {
      where.push('tracks.artist = ?');
      params.push(String(artist));
    }
    if (album) {
      where.push('tracks.album = ?');
      params.push(String(album));
    }
    if (favorite) {
      where.push('EXISTS (SELECT 1 FROM favorites f WHERE f.track_id = tracks.id)');
    }
    let join = '';
    if (playlistId) {
      const playlist = db.prepare('SELECT id FROM playlists WHERE id = ?').get(String(playlistId));
      if (!playlist) throw httpError(404, 'Playlist not found');
      join = 'JOIN playlist_tracks pt ON pt.track_id = tracks.id AND pt.playlist_id = ?';
      params.unshift(String(playlistId));
      where.push('pt.track_id IS NOT NULL');
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const orderSql = playlistId
      ? 'ORDER BY pt.position'
      : `ORDER BY ${DEFAULT_ORDER}`;

    const total = db
      .prepare(`SELECT COUNT(*) AS n FROM tracks ${join} ${whereSql}`)
      .get(...params).n;
    let sql = `SELECT tracks.*,
        EXISTS (SELECT 1 FROM favorites f WHERE f.track_id = tracks.id) AS fav
      FROM tracks ${join} ${whereSql} ${orderSql}`;
    const listParams = [...params];
    if (limit !== null) {
      sql += ' LIMIT ?';
      listParams.push(limit);
    }
    if (offset !== null) {
      sql += sql.includes('LIMIT') ? ' OFFSET ?' : ' LIMIT -1 OFFSET ?';
      listParams.push(offset);
    }
    const rows = db.prepare(sql).all(...listParams);
    res.status(200).json({
      total,
      items: rows.map((row) => trackToApi(row, row.fav)),
    });
  });

  router.get('/tracks/:id/cover', (req, res) => {
    const track = getTrack.get(req.params.id);
    if (!track || !track.cover_id) throw httpError(404, 'Cover not found');
    const cover = db.prepare('SELECT * FROM covers WHERE id = ?').get(track.cover_id);
    if (!cover) throw httpError(404, 'Cover not found');
    const file = dataPath(config.dataDir, cover.path);
    if (!fs.existsSync(file)) throw httpError(404, 'Cover not found');
    res.setHeader('Content-Type', imageMime(cover.path.slice(cover.path.lastIndexOf('.'))));
    res.sendFile(file);
  });

  router.get('/tracks/:id/stream', (req, res) => {
    const track = getTrack.get(req.params.id);
    if (!track) throw httpError(404, 'Track not found');
    const file = dataPath(config.dataDir, track.stored_path);
    if (!fs.existsSync(file)) throw httpError(404, 'Track file missing');

    const size = fs.statSync(file).size;
    const ext = track.filename.slice(track.filename.lastIndexOf('.'));
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', audioMime(ext));

    const range = req.headers.range;
    if (!range) {
      res.setHeader('Content-Length', String(size));
      res.status(200);
      fs.createReadStream(file).pipe(res);
      return;
    }

    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!match || (match[1] === '' && match[2] === '')) {
      // Unparsable Range header: RFC 9110 says ignore it and send the full body.
      res.setHeader('Content-Length', String(size));
      res.status(200);
      fs.createReadStream(file).pipe(res);
      return;
    }
    let start;
    let end;
    if (match[1] === '') {
      // Suffix form: bytes=-N (last N bytes).
      const suffix = Number(match[2]);
      start = Math.max(size - suffix, 0);
      end = size - 1;
    } else {
      start = Number(match[1]);
      end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
    }
    if (!Number.isFinite(start) || start > end || start >= size) {
      res.setHeader('Content-Range', `bytes */${size}`);
      res.status(416).json({ error: 'Range not satisfiable' });
      return;
    }
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    res.setHeader('Content-Length', String(end - start + 1));
    res.status(206);
    fs.createReadStream(file, { start, end }).pipe(res);
  });

  router.put('/tracks/:id/favorite', (req, res) => {
    const { favorite } = req.body ?? {};
    if (typeof favorite !== 'boolean') throw httpError(400, 'favorite must be a boolean');
    const track = getTrack.get(req.params.id);
    if (!track) throw httpError(404, 'Track not found');
    if (favorite) {
      db.prepare('INSERT OR IGNORE INTO favorites (track_id, created_at) VALUES (?, ?)').run(
        track.id,
        Date.now(),
      );
    } else {
      db.prepare('DELETE FROM favorites WHERE track_id = ?').run(track.id);
    }
    res.status(200).json({ favorite });
  });

  return router;
}
