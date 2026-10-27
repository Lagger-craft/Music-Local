import { useCallback, useState, type ChangeEvent } from 'react';
import { useAuth } from './hooks/useAuth';
import { usePlayer } from './hooks/usePlayer';
import { useLibrary } from './hooks/useLibrary';
import { usePlaylists } from './hooks/usePlaylists';
import { useUpload } from './hooks/useUpload';
import type { Track } from './types';
import { LoginScreen } from './components/LoginScreen';
import { Deck } from './components/Deck';
import { LibraryPanel } from './components/LibraryPanel';
import { PlaylistsPanel } from './components/PlaylistsPanel';

type PanelTab = 'library' | 'playlists';

export default function App() {
  const auth = useAuth();
  const player = usePlayer();
  const library = useLibrary();
  const playlists = usePlaylists();
  const upload = useUpload(library.refresh);
  const [tab, setTab] = useState<PanelTab>('library');

  // Favorite toggle shared by the deck like button and library rows:
  // flip server-side, then mirror in the library list and the queue.
  const toggleFavorite = useCallback(
    async (track: Track) => {
      const next = !track.favorite;
      const applied = await library.setFavorite(track, next);
      player.patchTrack(track.id, { favorite: applied });
    },
    [library, player],
  );

  // Deck like button acts on the current track.
  const onDeckLike = useCallback(() => {
    if (player.currentTrack) void toggleFavorite(player.currentTrack);
  }, [player.currentTrack, toggleFavorite]);

  // Clicking a library/playlist track sets the queue to that visible list.
  const playTrack = useCallback(
    (track: Track, visibleList: Track[]) => {
      const index = visibleList.findIndex((t) => t.id === track.id);
      player.playQueue(visibleList, index >= 0 ? index : 0);
    },
    [player],
  );

  const onTabChange = (e: ChangeEvent<HTMLInputElement>) =>
    setTab(e.target.value as PanelTab);

  if (auth.status === 'loading') {
    return (
      <main className="layout layout-center">
        <div className="deck boot-splash">
          <div className="brand">
            <span>Tape-o-matic 3000</span>
            <span>Booting...</span>
          </div>
          <div className="lcd">
            <div className="now">CHECKING DECK...</div>
          </div>
        </div>
      </main>
    );
  }

  if (!auth.user) {
    return <LoginScreen onLogin={auth.login} />;
  }

  return (
    <div className="layout">
      <Deck
        queue={player.queue}
        currentTrack={player.currentTrack}
        index={player.index}
        status={player.status}
        playing={player.playing}
        currentTime={player.currentTime}
        duration={player.duration}
        levels={player.levels}
        onSeek={player.seekFraction}
        onPlayAt={(i) => player.playQueue(player.queue, i)}
        onTogglePlay={player.togglePlay}
        onStop={player.stop}
        onNext={player.next}
        onPrev={player.prev}
        onLike={onDeckLike}
      />

      <aside className="side-panel plastic-card" aria-label="Controls">
        <header className="panel-header">
          <div className="tabs" role="tablist" aria-label="Panel views">
            <label className={`tab${tab === 'library' ? ' on' : ''}`}>
              <input
                type="radio"
                name="panel-tab"
                value="library"
                checked={tab === 'library'}
                onChange={onTabChange}
              />
              Library
            </label>
            <label className={`tab${tab === 'playlists' ? ' on' : ''}`}>
              <input
                type="radio"
                name="panel-tab"
                value="playlists"
                checked={tab === 'playlists'}
                onChange={onTabChange}
              />
              Playlists
            </label>
          </div>
          <div className="session">
            <span className="user-name">{auth.user.username}</span>
            <button type="button" className="mini-btn" onClick={() => void auth.logout()}>
              LOGOUT
            </button>
          </div>
        </header>

        {tab === 'library' ? (
          <LibraryPanel
            library={library}
            upload={upload}
            activeTrackId={player.currentTrack?.id ?? null}
            onPlayTrack={playTrack}
            onToggleFavorite={(t) => void toggleFavorite(t)}
          />
        ) : (
          <PlaylistsPanel
            playlistsState={playlists}
            activeTrackId={player.currentTrack?.id ?? null}
            onPlayTracks={player.playQueue}
          />
        )}
      </aside>
    </div>
  );
}
