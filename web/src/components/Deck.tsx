import type { Track } from '../types';
import type { DeckStatus, VuLevels } from '../hooks/usePlayer';
import { formatNo, formatTime } from '../lib/format';
import { VUMeters } from './VUMeters';
import { ProgressRail } from './ProgressRail';
import { Transport } from './Transport';

interface DeckProps {
  queue: Track[];
  currentTrack: Track | null;
  index: number;
  status: DeckStatus;
  playing: boolean;
  currentTime: number;
  duration: number;
  levels: VuLevels;
  onSeek: (fraction: number) => void;
  onPlayAt: (index: number) => void;
  onTogglePlay: () => void;
  onStop: () => void;
  onNext: () => void;
  onPrev: () => void;
  onLike: () => void;
}

/**
 * The retro deck shell: brand bar, cassette window with reels that spin only
 * while playing, LCD strip (status + scrolling marquee), VU meters, tape
 * counter rail, transport buttons and the queue as index cards.
 */
export function Deck({
  queue,
  currentTrack,
  index,
  status,
  playing,
  currentTime,
  duration,
  levels,
  onSeek,
  onPlayAt,
  onTogglePlay,
  onStop,
  onNext,
  onPrev,
  onLike,
}: DeckProps) {
  const statusVerb =
    status === 'play'
      ? 'PLAY \u25B6'
      : status === 'pause'
        ? 'PAUSE \u25AE\u25AE'
        : 'STOP \u25A0';
  const statusLine = currentTrack
    ? `${statusVerb}  TRACK ${formatNo(index + 1)}`
    : 'STOP \u25A0  TRACK --';

  const marqueeText = currentTrack
    ? `Now playing: ${currentTrack.title} \u2014 by ${currentTrack.artist} ...`
    : 'No tape loaded ... pick a track from the Library panel ...';

  return (
    <main className={`deck${playing ? ' playing' : ''}`} aria-label="Deck">
      <div className="brand">
        <span>Tape-o-matic 3000</span>
        <span>Stereo / Dolby-ish</span>
      </div>

      <div className="cassette" aria-hidden="true">
        <div className="reel" />
        <div className="reel slow" />
        <div className="tape" />
      </div>

      <div className="lcd">
        <div className="now">{statusLine}</div>
        <div className="marquee" key={currentTrack?.id ?? 'none'}>
          {marqueeText}
        </div>
      </div>

      <VUMeters levels={levels} />

      <ProgressRail currentTime={currentTime} duration={duration} onSeek={onSeek} />

      <Transport
        status={status}
        liked={currentTrack?.favorite ?? false}
        hasTrack={currentTrack !== null}
        onPrev={onPrev}
        onTogglePlay={onTogglePlay}
        onStop={onStop}
        onNext={onNext}
        onLike={onLike}
      />

      <section className="index queue-index" aria-label="Queue">
        <h2>Playlist Index</h2>
        {queue.length === 0 ? (
          <p className="empty-note">Queue empty. Click a track to load the tape.</p>
        ) : (
          <ul>
            {queue.map((track, i) => (
              <li
                key={track.id}
                className={i === index ? 'active' : undefined}
                onClick={() => onPlayAt(i)}
              >
                <span>
                  {formatNo(i + 1)} {track.title}
                </span>
                <span>{formatTime(track.duration)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
