import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { Playlist, PlaylistTrack } from '../types';

interface PlaylistListResponse {
  items: Playlist[];
}

interface PlaylistTracksResponse {
  items: PlaylistTrack[];
}

/**
 * Playlists state: list/create/rename/delete, ordered track listing, and
 * full-replace ordering via PUT /api/playlists/:id/tracks.
 */
export function usePlaylists() {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tracks, setTracks] = useState<PlaylistTrack[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await api<PlaylistListResponse>('/api/playlists');
      setPlaylists(res.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load playlists.');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Select a playlist and load its ordered tracks. */
  const select = useCallback(async (id: string | null) => {
    setSelectedId(id);
    setTracks([]);
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api<PlaylistTracksResponse>(`/api/playlists/${id}/tracks`);
      setTracks([...res.items].sort((a, b) => a.position - b.position));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load playlist tracks.');
    } finally {
      setLoading(false);
    }
  }, []);

  const create = useCallback(
    async (name: string): Promise<Playlist | null> => {
      const trimmed = name.trim();
      if (!trimmed) return null;
      try {
        const created = await api<Playlist>('/api/playlists', {
          method: 'POST',
          body: { name: trimmed },
        });
        await refresh();
        return created;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create playlist.');
        return null;
      }
    },
    [refresh],
  );

  const rename = useCallback(
    async (id: string, name: string): Promise<void> => {
      const trimmed = name.trim();
      if (!trimmed) return;
      try {
        await api<Playlist>(`/api/playlists/${id}`, { method: 'PATCH', body: { name: trimmed } });
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to rename playlist.');
      }
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string): Promise<void> => {
      try {
        await api<void>(`/api/playlists/${id}`, { method: 'DELETE' });
        if (selectedId === id) {
          setSelectedId(null);
          setTracks([]);
        }
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete playlist.');
      }
    },
    [refresh, selectedId],
  );

  /** PUT the full ordered id list; server returns the new ordered items. */
  const replaceTracks = useCallback(
    async (id: string, trackIds: string[]): Promise<void> => {
      try {
        const res = await api<PlaylistTracksResponse>(`/api/playlists/${id}/tracks`, {
          method: 'PUT',
          body: { trackIds },
        });
        setTracks([...res.items].sort((a, b) => a.position - b.position));
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update playlist.');
      }
    },
    [refresh],
  );

  return {
    playlists,
    selectedId,
    tracks,
    loading,
    error,
    refresh,
    select,
    create,
    rename,
    remove,
    replaceTracks,
  };
}
