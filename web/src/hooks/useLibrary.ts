import { useCallback, useEffect, useState } from 'react';
import { api, qs } from '../api';
import type { LibraryOverview, Track, TracksResponse } from '../types';

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Library state: debounced search (300ms), artist/album/favorites filters,
 * the resulting track list and the overview facets for the filter selects.
 */
export function useLibrary() {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [artist, setArtist] = useState('');
  const [album, setAlbum] = useState('');
  const [favoritesOnly, setFavoritesOnly] = useState(false);

  const [tracks, setTracks] = useState<Track[]>([]);
  const [total, setTotal] = useState(0);
  const [overview, setOverview] = useState<LibraryOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debounce the search box by 300ms.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const refreshTracks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<TracksResponse>(
        `/api/tracks${qs({
          q: debouncedQuery.trim(),
          artist,
          album,
          favorite: favoritesOnly ? 1 : undefined,
        })}`,
      );
      setTracks(res.items);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load library.');
    } finally {
      setLoading(false);
    }
  }, [debouncedQuery, artist, album, favoritesOnly]);

  const refreshOverview = useCallback(async () => {
    try {
      setOverview(await api<LibraryOverview>('/api/library/overview'));
    } catch {
      // Facets are non-critical; keep the previous overview on failure.
    }
  }, []);

  const refresh = useCallback(() => {
    void refreshTracks();
    void refreshOverview();
  }, [refreshTracks, refreshOverview]);

  useEffect(() => {
    void refreshTracks();
  }, [refreshTracks]);

  useEffect(() => {
    void refreshOverview();
  }, [refreshOverview]);

  /** Flip a favorite server-side and mirror it in the loaded list. */
  const setFavorite = useCallback(async (track: Track, favorite: boolean): Promise<boolean> => {
    try {
      const res = await api<{ favorite: boolean }>(`/api/tracks/${track.id}/favorite`, {
        method: 'PUT',
        body: { favorite },
      });
      setTracks((list) =>
        list.map((t) => (t.id === track.id ? { ...t, favorite: res.favorite } : t)),
      );
      return res.favorite;
    } catch {
      return track.favorite;
    }
  }, []);

  return {
    query,
    setQuery,
    debouncedQuery,
    artist,
    setArtist,
    album,
    setAlbum,
    favoritesOnly,
    setFavoritesOnly,
    tracks,
    total,
    overview,
    loading,
    error,
    refresh,
    setFavorite,
  };
}
