// Formatting helpers (tape-deck style m:ss labels).

/** Format seconds as `m:ss` (e.g. 228 -> "3:48"). */
export function formatTime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
    return '0:00';
  }
  const whole = Math.floor(seconds);
  const mins = Math.floor(whole / 60);
  const secs = String(whole % 60).padStart(2, '0');
  return `${mins}:${secs}`;
}

/** Two-digit list numbering: 1 -> "01". */
export function formatNo(n: number): string {
  return String(n).padStart(2, '0');
}
