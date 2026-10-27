import { useCallback } from 'react';
import type { Track } from '../types';
import type { useLibrary } from '../hooks/useLibrary';
import type { UploadState } from '../hooks/useUpload';
import { TrackList } from './TrackList';
import { UploadPanel } from './UploadPanel';

interface LibraryPanelProps {
  library: ReturnType<typeof useLibrary>;
  upload: UploadState & {
    upload: (files: File[]) => void;
    clearResult: () => void;
  };
  activeTrackId: string | null;
  onPlayTrack: (track: Track, visibleList: Track[]) => void;
  onToggleFavorite: (track: Track) => void;
}

/** Heart toggle used inside library and playlist rows. */
export function FavoriteHeart({
  track,
  onToggle,
}: {
  track: Track;
  onToggle: (track: Track) => void;
}) {
  return (
    <button
      type="button"
      className={`heart${track.favorite ? ' on' : ''}`}
      title={track.favorite ? 'Remove favorite' : 'Add favorite'}
      aria-label={track.favorite ? 'Remove favorite' : 'Add favorite'}
      onClick={(e) => {
        e.stopPropagation();
        onToggle(track);
      }}
    >
      {track.favorite ? '\u2665' : '\u2661'}
    </button>
  );
}

/** Library view: debounced search, artist/album/favorites filters, upload. */
export function LibraryPanel({
  library,
  upload,
  activeTrackId,
  onPlayTrack,
  onToggleFavorite,
}: LibraryPanelProps) {
  const { overview } = library;

  const playAt = useCallback(
    (index: number) => {
      const track = library.tracks[index];
      if (track) onPlayTrack(track, library.tracks);
    },
    [library.tracks, onPlayTrack],
  );

  return (
    <div className="panel-view">
      <UploadPanel upload={upload} />

      <section className="library-panel plastic-card" aria-label="Library">
        <h2 className="panel-heading">Library</h2>

        <div className="filter-row">
          <input
            className="input search"
            type="search"
            placeholder="Search title / artist / album..."
            value={library.query}
            onChange={(e) => library.setQuery(e.target.value)}
            aria-label="Search library"
          />
          <select
            className="select"
            value={library.artist}
            onChange={(e) => library.setArtist(e.target.value)}
            aria-label="Filter by artist"
          >
            <option value="">All artists</option>
            {(overview?.artists ?? []).map((a) => (
              <option key={a.name} value={a.name}>
                {a.name} ({a.trackCount})
              </option>
            ))}
          </select>
          <select
            className="select"
            value={library.album}
            onChange={(e) => library.setAlbum(e.target.value)}
            aria-label="Filter by album"
          >
            <option value="">All albums</option>
            {(overview?.albums ?? []).map((a) => (
              <option key={`${a.artist}::${a.name}`} value={a.name}>
                {a.name} ({a.trackCount})
              </option>
            ))}
          </select>
          <button
            type="button"
            className={`chip${library.favoritesOnly ? ' on' : ''}`}
            onClick={() => library.setFavoritesOnly(!library.favoritesOnly)}
          >
            {library.favoritesOnly ? '\u2665 Favorites' : '\u2661 Favorites'}
          </button>
        </div>

        <p className="stats-line">
          {overview
            ? `${overview.trackCount} tracks / ${overview.albumCount} albums / ${overview.artistCount} artists`
            : 'Loading library overview...'}
          {library.loading ? ' — refreshing...' : ''}
        </p>

        {library.error ? (
          <p className="upload-error" role="alert">
            {library.error}
          </p>
        ) : null}

        <TrackList
          tracks={library.tracks}
          activeId={activeTrackId}
          onPlay={playAt}
          renderActions={(track) => (
            <FavoriteHeart track={track} onToggle={onToggleFavorite} />
          )}
        />
      </section>
    </div>
  );
}
