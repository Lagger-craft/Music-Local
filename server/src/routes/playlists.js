import { Router } from 'express';
import { httpError, trackToApi, uuid } from '../util.js';

function requireName(body) {
  const name = body?.name;
  if (typeof name !== 'string' || name.trim() === '') {
    throw httpError(400, 'name is required');
  }
  return name.trim();
}

export function createPlaylistsRouter({ db }) {
  const router = Router();
  const getPlaylist = db.prepare('SELECT * FROM playlists WHERE id = ?');

  const trackCountOf = (playlistId) =>
    db.prepare('SELECT COUNT(*) AS n FROM playlist_tracks WHERE playlist_id = ?').get(playlistId).n;

  const playlistToApi = (row, trackCount) => ({
    id: row.id,
    name: row.name,
    trackCount,
    createdAt: row.created_at,
  });

  router.get('/playlists', (req, res) => {
    const items = db
      .prepare('SELECT * FROM playlists ORDER BY created_at, name')
      .all()
      .map((row) => ({ id: row.id, name: row.name, trackCount: trackCountOf(row.id) }));
    res.status(200).json({ items });
  });

  router.post('/playlists', (req, res) => {
    const name = requireName(req.body);
    const playlist = { id: uuid(), name, created_at: Date.now() };
    db.prepare('INSERT INTO playlists (id, name, created_at) VALUES (?, ?, ?)').run(
      playlist.id,
      playlist.name,
      playlist.created_at,
    );
    res.status(201).json(playlistToApi(playlist, 0));
  });

  router.patch('/playlists/:id', (req, res) => {
    const name = requireName(req.body);
    const playlist = getPlaylist.get(req.params.id);
    if (!playlist) throw httpError(404, 'Playlist not found');
    db.prepare('UPDATE playlists SET name = ? WHERE id = ?').run(name, playlist.id);
    res.status(200).json(playlistToApi({ ...playlist, name }, trackCountOf(playlist.id)));
  });

  router.delete('/playlists/:id', (req, res) => {
    const playlist = getPlaylist.get(req.params.id);
    if (!playlist) throw httpError(404, 'Playlist not found');
    db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ?').run(playlist.id);
    db.prepare('DELETE FROM playlists WHERE id = ?').run(playlist.id);
    res.status(204).end();
  });

  router.get('/playlists/:id/tracks', (req, res) => {
    const playlist = getPlaylist.get(req.params.id);
    if (!playlist) throw httpError(404, 'Playlist not found');
    const items = db
      .prepare(`
        SELECT tracks.*, pt.position AS position,
          EXISTS (SELECT 1 FROM favorites f WHERE f.track_id = tracks.id) AS fav
        FROM playlist_tracks pt
        JOIN tracks ON tracks.id = pt.track_id
        WHERE pt.playlist_id = ?
        ORDER BY pt.position
      `)
      .all(playlist.id)
      .map((row) => ({ ...trackToApi(row, row.fav), position: row.position }));
    res.status(200).json({ items });
  });

  /** Full replace of the playlist's tracks, in array order. */
  router.put('/playlists/:id/tracks', (req, res) => {
    const playlist = getPlaylist.get(req.params.id);
    if (!playlist) throw httpError(404, 'Playlist not found');
    const { trackIds } = req.body ?? {};
    if (!Array.isArray(trackIds)) throw httpError(400, 'trackIds must be an array');

    const getTrack = db.prepare('SELECT * FROM tracks WHERE id = ?');
    const rows = trackIds.map((id) => {
      if (typeof id !== 'string') throw httpError(400, 'trackIds must contain track id strings');
      const track = getTrack.get(id);
      if (!track) throw httpError(404, `Track not found: ${id}`);
      return track;
    });

    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ?').run(playlist.id);
      const insert = db.prepare('INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)');
      rows.forEach((track, position) => insert.run(playlist.id, track.id, position));
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    const items = rows.map((track, position) => ({
      ...trackToApi(track, false),
      position,
    }));
    res.status(200).json({ items });
  });

  return router;
}
