import { useCallback, type MouseEvent } from 'react';
import { formatTime } from '../lib/format';

interface ProgressRailProps {
  currentTime: number;
  duration: number;
  onSeek: (fraction: number) => void;
}

/** Tape-counter progress rail: click to seek, m:ss labels. */
export function ProgressRail({ currentTime, duration, onSeek }: ProgressRailProps) {
  const handleClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const fraction = (e.clientX - rect.left) / rect.width;
      onSeek(Math.min(Math.max(fraction, 0), 1));
    },
    [onSeek],
  );

  const pct = duration > 0 ? Math.min((currentTime / duration) * 100, 100) : 0;

  return (
    <div
      className="counter"
      onClick={handleClick}
      role="slider"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') onSeek(Math.min((currentTime + 5) / (duration || 1), 1));
        if (e.key === 'ArrowLeft') onSeek(Math.max((currentTime - 5) / (duration || 1), 0));
      }}
    >
      <div className="rail">
        <div className="pos" style={{ left: `calc(${pct}% - ${pct * 0.14}px)` }} />
      </div>
      <div className="labels">
        <span>{formatTime(currentTime)}</span>
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  );
}
