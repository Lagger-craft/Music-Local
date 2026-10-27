import crypto from 'node:crypto';
import path from 'node:path';

export const AUDIO_EXTENSIONS = new Set(['.mp3', '.flac', '.m4a', '.aac', '.ogg', '.opus', '.wav']);
export const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

// cover.jpg, "Cover - front.png", ALBUM - disc1.webp, ...
export const FOLDER_COVER_RE = /^(cover|folder|album|front)(?: - .*)?\.(jpe?g|png|webp)$/i;

const AUDIO_MIME = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
  '.wav': 'audio/wav',
};

const IMAGE_MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

const PICTURE_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

export const audioMime = (ext) => AUDIO_MIME[ext.toLowerCase()] ?? 'application/octet-stream';
export const imageMime = (ext) => IMAGE_MIME[ext.toLowerCase()] ?? 'application/octet-stream';
export const pictureExt = (format) => PICTURE_EXT[(format ?? '').toLowerCase()] ?? '.jpg';

export const uuid = () => crypto.randomUUID();

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const httpError = (status, message) => new HttpError(status, message);

/** Parse a Cookie header into a plain object. */
export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

/** Database row -> public track shape used across the API. */
export function trackToApi(row, favorite = false) {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    album: row.album,
    trackNo: row.track_no ?? null,
    duration: row.duration ?? null,
    favorite: Boolean(favorite),
    coverUrl: row.cover_id ? `/api/tracks/${row.id}/cover` : null,
  };
}

/** Resolve a DATA_DIR-relative posix path (e.g. "covers/x.jpg") to absolute. */
export function dataPath(dataDir, relative) {
  return path.join(dataDir, ...relative.split('/'));
}
