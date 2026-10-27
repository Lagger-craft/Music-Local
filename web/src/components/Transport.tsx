import type { DeckStatus } from '../hooks/usePlayer';

interface TransportProps {
  status: DeckStatus;
  liked: boolean;
  hasTrack: boolean;
  onPrev: () => void;
  onTogglePlay: () => void;
  onStop: () => void;
  onNext: () => void;
  onLike: () => void;
}

/** Five chunky transport buttons with pressed states (wireframe style). */
export function Transport({
  status,
  liked,
  hasTrack,
  onPrev,
  onTogglePlay,
  onStop,
  onNext,
  onLike,
}: TransportProps) {
  return (
    <div className="transport">
      <button type="button" title="Rewind" onClick={onPrev} disabled={!hasTrack}>
        &#9664;&#9664;
      </button>
      <button
        type="button"
        title="Play/Pause"
        className={status === 'play' ? 'pressed' : undefined}
        onClick={onTogglePlay}
        disabled={!hasTrack}
      >
        {status === 'play' ? '\u25AE\u25AE' : '\u25B6'}
      </button>
      <button type="button" title="Stop" onClick={onStop} disabled={!hasTrack}>
        &#9632;
      </button>
      <button type="button" title="Forward" onClick={onNext} disabled={!hasTrack}>
        &#9654;&#9654;
      </button>
      <button
        type="button"
        title="Favorite"
        className={liked ? 'rec on' : 'rec'}
        onClick={onLike}
        disabled={!hasTrack}
      >
        {liked ? '\u2665' : '\u2661'}
      </button>
    </div>
  );
}
