import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import busboy from 'busboy';
import { Router } from 'express';
import { parseFile } from 'music-metadata';
import {
  AUDIO_EXTENSIONS,
  FOLDER_COVER_RE,
  IMAGE_EXTENSIONS,
  httpError,
  pictureExt,
  trackToApi,
  uuid,
} from '../util.js';

const MAX_FILES_PER_UPLOAD = 500;
const MAX_FIELDS_PER_UPLOAD = 2000;
const MAX_FILE_BYTES = 1024 * 1024 * 1024; // 1 GiB

export function createLibraryRouter({ config, db }) {
  const router = Router();

  const insertCover = db.prepare('INSERT INTO covers (id, path, source) VALUES (?, ?, ?)');
  const insertTrack = db.prepare(`
    INSERT INTO tracks (id, title, artist, album, album_artist, genre, year, track_no,
                        duration, filename, stored_path, cover_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const setCover = db.prepare('UPDATE tracks SET cover_id = ? WHERE id = ?');

  /**
   * POST /api/library/upload — multipart with alternating `files` (one file)
   * and `paths` (its repository-relative path) fields. The client may send a
   * paths field before or after its file; each files part is staged to a temp
   * file while the pairing resolves, then stored under
   * DATA_DIR/music/<trackId>/<originalname> once the batch is complete.
   */
  router.post('/upload', (req, res, next) => {
    let bb;
    try {
      bb = busboy({
        headers: req.headers,
        limits: {
          files: MAX_FILES_PER_UPLOAD,
          fields: MAX_FIELDS_PER_UPLOAD,
          fileSize: MAX_FILE_BYTES,
        },
      });
    } catch {
      next(httpError(400, 'Expected a multipart/form-data request'));
      return;
    }

    const result = { added: 0, tracks: [], skipped: [], coversApplied: 0, errors: [] };
    const stagingDir = path.join(config.dataDir, 'tmp');
    fs.mkdirSync(stagingDir, { recursive: true });
    const pendingPaths = []; // paths fields seen before their file
    const unpairedFiles = []; // staged files still waiting for a paths field
    const stagedFiles = []; // every staged file, in arrival order
    const fileTasks = []; // promises resolving when a stream is fully staged

    /** Attach a paths value to the staged file record it belongs to. */
    const applyRelPath = (entry, value) => {
      const relPath = value.replace(/\\/g, '/');
      entry.originalName = relPath.split('/').pop() || entry.filename;
      const dir = path.posix.dirname(relPath);
      entry.relDir = dir === '.' ? '' : dir;
    };

    bb.on('field', (name, value) => {
      if (name !== 'paths') return;
      const waiting = unpairedFiles.shift();
      if (waiting) applyRelPath(waiting, value);
      else pendingPaths.push(value);
    });

    bb.on('file', (name, stream, info) => {
      if (name !== 'files') {
        stream.resume();
        result.skipped.push({ filename: info.filename ?? 'unknown', reason: 'unexpected field name' });
        return;
      }
      const entry = {
        filename: info.filename ?? 'file',
        originalName: null, // resolved from the paths pairing, falls back to filename
        relDir: '',
        overflow: false,
        tmpPath: path.join(stagingDir, `${uuid()}.part`),
      };
      stream.on('limit', () => {
        entry.overflow = true;
      });
      const writer = fs.createWriteStream(entry.tmpPath);
      entry.writer = writer; // so the abort path can unblock the pipeline
      const task = pipeline(stream, writer);
      // The abort path never awaits this; attach a no-op handler so a
      // destroyed stream cannot surface as an unhandled rejection.
      task.catch(() => {});
      fileTasks.push(task);
      if (pendingPaths.length > 0) applyRelPath(entry, pendingPaths.shift());
      else unpairedFiles.push(entry);
      stagedFiles.push(entry);
    });

    // An aborted request settles the upload exactly once: pending streams are
    // drained and every staged .part is removed, so a client that dies mid-body
    // (proxy timeout, closed tab) leaves no garbage in DATA_DIR/tmp.
    let settled = false;
    const removeStaged = async () => {
      await Promise.all(stagedFiles.map((entry) => fsp.rm(entry.tmpPath, { force: true })));
    };

    bb.on('error', (err) => {
      if (settled) return;
      settled = true;
      for (const entry of stagedFiles) entry.writer?.destroy();
      removeStaged()
        .catch(() => {})
        .finally(() => next(err));
    });

    bb.on('close', async () => {
      if (settled) return;
      settled = true;
      try {
        await Promise.all(fileTasks);
        const batchTracks = []; // audio records: {relDir, id, coverId}
        const folderCovers = []; // folder-cover images: {relDir, coverId}

        // Sequential so response ordering follows file arrival order.
        for (const entry of stagedFiles) {
          const originalName = entry.originalName ?? entry.filename;
          const ext = path.extname(originalName).toLowerCase();
          try {
            if (AUDIO_EXTENSIONS.has(ext)) {
              await storeAudio(entry, originalName, ext, batchTracks);
            } else if (IMAGE_EXTENSIONS.has(ext) && FOLDER_COVER_RE.test(originalName)) {
              await storeFolderCover(entry, originalName, ext, folderCovers);
            } else {
              result.skipped.push({ filename: originalName, reason: 'unsupported file type' });
            }
          } finally {
            await fsp.rm(entry.tmpPath, { force: true });
          }
        }

        // Folder-cover pass: applies to this batch's audio files in the same
        // relative folder that ended up without a cover (embedded art wins).
        for (const cover of folderCovers) {
          for (const track of batchTracks) {
            if (track.relDir === cover.relDir && track.coverId === null) {
              setCover.run(cover.coverId, track.id);
              track.coverId = cover.coverId;
              result.coversApplied += 1;
              const item = result.tracks.find((t) => t.id === track.id);
              if (item) item.coverUrl = `/api/tracks/${track.id}/cover`;
            }
          }
        }

        res.status(200).json(result);
      } catch (err) {
        // Staged files were never stored (or the batch failed midway): drop
        // whatever is still in tmp before surfacing the error.
        await removeStaged().catch(() => {});
        next(err);
      }
    });

    const storeAudio = async (entry, originalName, ext, batchTracks) => {
      if (entry.overflow) throw new Error('File exceeds the maximum allowed size');
      const trackId = uuid();
      const relStored = `music/${trackId}/${originalName}`;
      const absDir = path.join(config.dataDir, 'music', trackId);
      const absStored = path.join(absDir, originalName);
      try {
        await fsp.mkdir(absDir, { recursive: true });
        await fsp.rename(entry.tmpPath, absStored);
        const { coverId } = await addTrack(trackId, absStored, relStored, originalName);
        batchTracks.push({ relDir: entry.relDir, id: trackId, coverId });
      } catch (err) {
        await fsp.rm(absDir, { recursive: true, force: true });
        result.errors.push({ filename: originalName, error: err.message });
      }
    };

    const storeFolderCover = async (entry, originalName, ext, folderCovers) => {
      if (entry.overflow) throw new Error('File exceeds the maximum allowed size');
      const coverId = uuid();
      const relCover = `covers/${coverId}${ext}`;
      const absCover = path.join(config.dataDir, 'covers', coverId + ext);
      try {
        await fsp.mkdir(path.dirname(absCover), { recursive: true });
        await fsp.rename(entry.tmpPath, absCover);
        insertCover.run(coverId, relCover, 'folder');
        folderCovers.push({ relDir: entry.relDir, coverId });
      } catch (err) {
        result.errors.push({ filename: originalName, error: err.message });
      }
    };

    const addTrack = async (trackId, absStored, relStored, originalName) => {
      const metadata = await parseFile(absStored, { duration: true });
      if (!metadata.format.container || metadata.format.container.length === 0) {
        throw new Error('Unrecognized or corrupt audio file');
      }
      const common = metadata.common;
      const title = common.title ?? path.basename(originalName, path.extname(originalName));
      const artist = common.artist ?? 'Unknown Artist';
      const album = common.album ?? 'Unknown Album';

      let coverId = null;
      const picture = common.picture?.[0];
      if (picture) {
        coverId = uuid();
        const relCover = `covers/${coverId}${pictureExt(picture.format)}`;
        const absCover = path.join(config.dataDir, ...relCover.split('/'));
        await fsp.mkdir(path.dirname(absCover), { recursive: true });
        await fsp.writeFile(absCover, picture.data);
        insertCover.run(coverId, relCover, 'embedded');
      }

      insertTrack.run(
        trackId,
        title,
        artist,
        album,
        common.albumartist ?? null,
        common.genre?.[0] ?? null,
        common.year ?? null,
        common.track?.no ?? null,
        metadata.format.duration ?? null,
        originalName,
        relStored,
        coverId,
        Date.now(),
      );
      const row = db.prepare('SELECT * FROM tracks WHERE id = ?').get(trackId);
      result.added += 1;
      result.tracks.push(trackToApi(row, false));
      return { coverId };
    };

    req.pipe(bb);

    // busboy emits nothing when the socket dies mid-body (verified: only the
    // request itself fires `aborted`/`close` with complete=false), so the
    // abort path hangs off the request: settle once, drain the staging
    // streams and drop every .part still in tmp.
    req.on('close', () => {
      if (req.complete || settled) return;
      settled = true;
      // busboy's streams never end after an abort, so the pipelines cannot be
      // awaited: destroy the writers (unblocks them) and remove the staged
      // .part files right away.
      for (const entry of stagedFiles) entry.writer?.destroy();
      removeStaged().catch(() => {});
    });
  });

  /** GET /api/library/overview — counts plus album/artist facets. */
  router.get('/overview', (req, res) => {
    const { n: trackCount } = db.prepare('SELECT COUNT(*) AS n FROM tracks').get();
    const { n: albumCount } = db.prepare('SELECT COUNT(*) AS n FROM (SELECT album FROM tracks GROUP BY album)').get();
    const { n: artistCount } = db.prepare('SELECT COUNT(*) AS n FROM (SELECT artist FROM tracks GROUP BY artist)').get();

    const albums = db
      .prepare(`
        SELECT t1.album AS name,
               MIN(t1.artist) AS artist,
               COUNT(*) AS trackCount,
               (SELECT t2.id FROM tracks t2
                 WHERE t2.album = t1.album AND t2.cover_id IS NOT NULL
                 ORDER BY t2.artist, t2.track_no, t2.title LIMIT 1) AS cover_track_id
        FROM tracks t1
        GROUP BY t1.album
        ORDER BY artist, name
      `)
      .all()
      .map((row) => ({
        name: row.name,
        artist: row.artist,
        trackCount: row.trackCount,
        coverUrl: row.cover_track_id ? `/api/tracks/${row.cover_track_id}/cover` : null,
      }));

    const artists = db
      .prepare('SELECT artist AS name, COUNT(*) AS trackCount FROM tracks GROUP BY artist ORDER BY name')
      .all();

    res.status(200).json({ trackCount, albumCount, artistCount, albums, artists });
  });

  return router;
}
