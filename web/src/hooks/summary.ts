/**
 * Compact-summary helpers (pure logic, no React): keeps long upload-result
 * lists from burying the panels below them.
 */

/**
 * Split a list into the first `max` items and the remainder, preserving
 * order. The preview always renders; the rest collapses behind a toggle.
 */
export function splitPreview<T>(items: T[], max: number): { preview: T[]; rest: T[] } {
  const cut = Math.max(0, Math.min(max, items.length));
  return { preview: items.slice(0, cut), rest: items.slice(cut) };
}
