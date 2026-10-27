import type { ReactNode } from 'react';
import type { Track } from '../types';
import { formatNo, formatTime } from '../lib/format';

interface TrackListProps {
  tracks: Track[];
  /** Active (currently loaded) track id, highlighted in orange. */
  activeId?: string | null;
  /** Called with the row index; index refers to the position in `tracks`. */
  onPlay: (index: number) => void;
  /** Optional per-row extra controls (heart, remove, ...), rendered on the right. */
  renderActions?: (track: Track) => ReactNode;
}

/**
 * Index-card track rows (wireframe style): `nn  title — artist` on the left,
 * duration plus optional actions on the right. Playing a row sets the queue
 * to this visible list.
 */
export function TrackList({ tracks, activeId, onPlay, renderActions }: TrackListProps) {
  if (tracks.length === 0) {
    return <p className="empty-note">No tapes loaded. Add music in the panel above.</p>;
  }
  return (
    <ul className="index track-list">
      {tracks.map((track, i) => (
        <li
          key={track.id}
          className={track.id === activeId ? 'active' : undefined}
          onClick={() => onPlay(i)}
        >
          <span className="row-title">
            <span className="row-no">{formatNo(i + 1)}</span>
            {track.title}
            <span className="row-artist"> — {track.artist}</span>
          </span>
          <span className="row-right">
            {renderActions ? renderActions(track) : null}
            <span className="row-dur">{formatTime(track.duration)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
