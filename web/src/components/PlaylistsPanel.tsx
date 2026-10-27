import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import type { Playlist, Track, TracksResponse } from '../types';
import type { usePlaylists } from '../hooks/usePlaylists';
import { formatNo, formatTime } from '../lib/format';

interface PlaylistsPanelProps {
  playlistsState: ReturnType<typeof usePlaylists>;
  activeTrackId: string | null;
  onPlayTracks: (tracks: Track[], startIndex: number) => void;
}

/** Playlists view: CRUD, ordered tracks, add/remove, play as queue. */
export function PlaylistsPanel({
  playlistsState,
  activeTrackId,
  onPlayTracks,
}: PlaylistsPanelProps) {
  const {
    playlists,
    selectedId,
    tracks,
    loading,
    error,
    select,
    create,
    rename,
    remove,
    replaceTracks,
  } = playlistsState;

  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickable, setPickable] = useState<Track[]>([]);

  const selected: Playlist | null = playlists.find((p) => p.id === selectedId) ?? null;

  // Library tracks available to add to the selected playlist.
  useEffect(() => {
    if (!pickerOpen || !selectedId) return;
    let cancelled = false;
    api<TracksResponse>('/api/tracks?limit=1000')
      .then((res) => {
        if (!cancelled) setPickable(res.items);
      })
      .catch(() => {
        if (!cancelled) setPickable([]);
      });
    return () => {
      cancelled = true;
    };
  }, [pickerOpen, selectedId]);

  const submitCreate = async (e: FormEvent) => {
    e.preventDefault();
    const created = await create(newName);
    if (created) {
      setNewName('');
      await select(created.id);
    }
  };

  const submitRename = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingId) return;
    await rename(editingId, editName);
    setEditingId(null);
  };

  const removeTrack = useCallback(
    async (trackId: string) => {
      if (!selectedId) return;
      const next = tracks.filter((t) => t.id !== trackId).map((t) => t.id);
      await replaceTracks(selectedId, next);
    },
    [selectedId, tracks, replaceTracks],
  );

  const addTrack = useCallback(
    async (trackId: string) => {
      if (!selectedId) return;
      if (tracks.some((t) => t.id === trackId)) return;
      await replaceTracks(selectedId, [...tracks.map((t) => t.id), trackId]);
    },
    [selectedId, tracks, replaceTracks],
  );

  return (
    <div className="panel-view">
      <section className="playlists-panel plastic-card" aria-label="Playlists">
        <h2 className="panel-heading">Playlists</h2>

        <form className="create-row" onSubmit={submitCreate}>
          <input
            className="input"
            placeholder="New playlist name..."
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            aria-label="New playlist name"
          />
          <button className="btn" type="submit" disabled={!newName.trim()}>
            Create
          </button>
        </form>

        {playlists.length === 0 ? (
          <p className="empty-note">No playlists yet. Create one above.</p>
        ) : (
          <ul className="index playlist-index">
            {playlists.map((p) => (
              <li
                key={p.id}
                className={p.id === selectedId ? 'active' : undefined}
                onClick={() => {
                  void select(p.id);
                  setPickerOpen(false);
                }}
              >
                <span className="row-title">
                  {p.name}
                  <span className="row-artist"> — {p.trackCount} tracks</span>
                </span>
                <span className="row-right">
                  <button
                    type="button"
                    className="mini-btn"
                    title="Rename"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingId(p.id);
                      setEditName(p.name);
                    }}
                  >
                    REN
                  </button>
                  <button
                    type="button"
                    className="mini-btn"
                    title="Delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm(`Delete playlist "${p.name}"?`)) {
                        void remove(p.id);
                      }
                    }}
                  >
                    DEL
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}

        {editingId ? (
          <form className="create-row" onSubmit={submitRename}>
            <input
              className="input"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              aria-label="Rename playlist"
              autoFocus
            />
            <button className="btn" type="submit">
              Save
            </button>
            <button className="btn" type="button" onClick={() => setEditingId(null)}>
              Cancel
            </button>
          </form>
        ) : null}

        {error ? (
          <p className="upload-error" role="alert">
            {error}
          </p>
        ) : null}
      </section>

      {selected ? (
        <section className="playlist-tracks plastic-card" aria-label="Playlist tracks">
          <div className="heading-row">
            <h2 className="panel-heading">{selected.name}</h2>
            <div className="heading-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={tracks.length === 0}
                onClick={() =>
                  onPlayTracks(tracks, 0)
                }
              >
                Play queue
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => setPickerOpen((o) => !o)}
              >
                {pickerOpen ? 'Close picker' : 'Add tracks'}
              </button>
            </div>
          </div>

          {loading ? <p className="empty-note">Loading...</p> : null}

          {tracks.length === 0 && !loading ? (
            <p className="empty-note">Empty playlist. Use "Add tracks" to fill it.</p>
          ) : (
            <ul className="index track-list">
              {tracks.map((track, i) => (
                <li
                  key={track.id}
                  className={track.id === activeTrackId ? 'active' : undefined}
                  onClick={() => onPlayTracks(tracks, i)}
                >
                  <span className="row-title">
                    <span className="row-no">{formatNo(i + 1)}</span>
                    {track.title}
                    <span className="row-artist"> — {track.artist}</span>
                  </span>
                  <span className="row-right">
                    <button
                      type="button"
                      className="mini-btn"
                      title="Remove from playlist"
                      onClick={(e) => {
                        e.stopPropagation();
                        void removeTrack(track.id);
                      }}
                    >
                      &#10005;
                    </button>
                    <span className="row-dur">{formatTime(track.duration)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {pickerOpen ? (
            <div className="track-picker">
              <h3 className="panel-subheading">Add from library</h3>
              {pickable.length === 0 ? (
                <p className="empty-note">No tracks available.</p>
              ) : (
                <ul className="index track-list">
                  {pickable.map((track) => {
                    const already = tracks.some((t) => t.id === track.id);
                    return (
                      <li key={track.id} className={already ? 'used' : undefined}>
                        <span className="row-title">
                          {track.title}
                          <span className="row-artist"> — {track.artist}</span>
                        </span>
                        <span className="row-right">
                          <button
                            type="button"
                            className="mini-btn"
                            disabled={already}
                            onClick={() => void addTrack(track.id)}
                          >
                            {already ? 'ADDED' : 'ADD'}
                          </button>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
