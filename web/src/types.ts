// Shared types mirroring the API contract in odd/tasks/music-player.md.

/** A track as returned by GET /api/tracks. */
export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  /** 1-based track number within the album; null when unknown. */
  trackNo: number | null;
  /** Duration in seconds; null when unknown. */
  duration: number | null;
  favorite: boolean;
  /** `/api/tracks/:id/cover` or null. */
  coverUrl: string | null;
}

/** Response of GET /api/tracks. */
export interface TracksResponse {
  total: number;
  items: Track[];
}

/** A playlist-scoped track (GET /api/playlists/:id/tracks): track + position. */
export interface PlaylistTrack extends Track {
  position: number;
}

/** A playlist summary as returned by GET /api/playlists. */
export interface Playlist {
  id: string;
  name: string;
  trackCount: number;
}

export interface OverviewAlbum {
  name: string;
  artist: string;
  trackCount: number;
  coverUrl: string | null;
}

export interface OverviewArtist {
  name: string;
  trackCount: number;
}

/** Response of GET /api/library/overview. */
export interface LibraryOverview {
  trackCount: number;
  albumCount: number;
  artistCount: number;
  albums: OverviewAlbum[];
  artists: OverviewArtist[];
}

export interface UploadSkipped {
  filename: string;
  reason: string;
}

export interface UploadError {
  filename: string;
  error: string;
}

/** Response of POST /api/library/upload. */
export interface UploadResult {
  added: number;
  tracks: Track[];
  skipped: UploadSkipped[];
  coversApplied: number;
  errors: UploadError[];
}

/**
 * Authenticated user. The contract only specifies `{user}`; we assume a
 * minimal shape with a username for display.
 */
export interface User {
  username: string;
}

export interface AuthResponse {
  user: User;
}
