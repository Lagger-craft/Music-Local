interface VolumeControlProps {
  /** Output volume, 0-1. */
  volume: number;
  onVolumeChange: (volume: number) => void;
}

/** Chunky retro output-volume slider with an LCD-style percentage readout. */
export function VolumeControl({ volume, onVolumeChange }: VolumeControlProps) {
  const percent = Math.round(volume * 100);
  return (
    <div className="volume">
      <label htmlFor="deck-volume">Volume</label>
      <input
        id="deck-volume"
        type="range"
        min={0}
        max={100}
        step={1}
        value={percent}
        onChange={(e) => onVolumeChange(Number(e.target.value) / 100)}
      />
      <span className="volume-value" aria-hidden="true">
        {percent}%
      </span>
    </div>
  );
}
