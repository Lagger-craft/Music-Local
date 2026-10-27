import type { VuLevels } from '../hooks/usePlayer';

interface VUMetersProps {
  levels: VuLevels;
}

/** Three VU bars driven by the analyser level data (or idle 8%). */
export function VUMeters({ levels }: VUMetersProps) {
  return (
    <div className="meters" aria-hidden="true">
      {levels.map((level, i) => (
        <div className="bar" key={i}>
          <i style={{ width: `${level}%` }} />
        </div>
      ))}
    </div>
  );
}
