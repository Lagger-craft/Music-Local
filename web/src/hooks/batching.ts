/**
 * Upload batching — pure planning logic, no React and no I/O, so it runs under
 * `node --test` straight from the TypeScript source.
 */

/**
 * Reverse proxies in front of the app (Traefik's default `readTimeout`) kill
 * requests whose body takes 60s to arrive, so one giant multipart POST fails
 * with a network error on big folders. Split the selection into sequential
 * batches instead — small enough that each request finishes well inside that
 * window.
 */
export const BATCH_MAX_FILES = 20;
export const BATCH_MAX_BYTES = 30 * 1024 * 1024;

/** Mirror of the server's folder-cover rule (server/src/util.js FOLDER_COVER_RE). */
const FOLDER_COVER_RE = /^(cover|folder|album|front)(?: - .*)?\.(jpe?g|png|webp)$/i;

/** Repository-relative path, mirroring webkitRelativePath with a filename fallback. */
export function relativePath(file: File): string {
  const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  return relative && relative.length > 0 ? relative : file.name;
}

/** Last path segment of a repository-relative path. */
function baseName(rel: string): string {
  const slash = rel.lastIndexOf('/');
  return slash === -1 ? rel : rel.slice(slash + 1);
}

/** Whether a file is folder-cover art by the server's naming rule. */
function isFolderCover(file: File): boolean {
  return FOLDER_COVER_RE.test(baseName(relativePath(file)));
}

const totalBytes = (list: File[]): number => list.reduce((sum, f) => sum + f.size, 0);

/**
 * Pack the selection into sequential batches that respect the file and byte
 * budgets. Files are grouped by relative directory and whole directories stay
 * in one request whenever they fit: the server pairs a folder's cover art with
 * the audio files stored in the same batch.
 *
 * A directory that no longer fits (a single 500-track album is the common
 * case) is split into chunks, and its cover files repeat in every chunk — the
 * server re-stores and applies them per request, so each chunk still pairs
 * cover + tracks instead of silently losing the art.
 */
export function planBatches(files: File[]): File[][] {
  const groups = new Map<string, File[]>();
  const order: string[] = [];
  for (const file of files) {
    const rel = relativePath(file);
    const slash = rel.lastIndexOf('/');
    const dir = slash === -1 ? '' : rel.slice(0, slash);
    if (!groups.has(dir)) {
      groups.set(dir, []);
      order.push(dir);
    }
    groups.get(dir)!.push(file);
  }

  const batches: File[][] = [];
  let current: File[] = [];
  let currentBytes = 0;
  const flushCurrent = () => {
    if (current.length === 0) return;
    batches.push(current);
    current = [];
    currentBytes = 0;
  };

  for (const dir of order) {
    const group = groups.get(dir)!;
    const groupBytes = totalBytes(group);
    const fits = group.length <= BATCH_MAX_FILES && groupBytes <= BATCH_MAX_BYTES;
    if (!fits) {
      // Oversized directory: chunk the payload files and repeat the cover in
      // every chunk. A folder of nothing but images has no payload to pair
      // with, so its covers are chunked like any other file instead.
      flushCurrent();
      const covers = group.filter(isFolderCover);
      const payload = group.filter((file) => !isFolderCover(file));
      const rideAlong = payload.length > 0 ? covers : [];
      const chunkables = payload.length > 0 ? payload : covers;
      const budgetPerChunk = Math.max(1, BATCH_MAX_BYTES - totalBytes(rideAlong));

      let chunk: File[] = [];
      let chunkBytes = 0;
      const flushChunk = () => {
        if (chunk.length === 0) return;
        batches.push([...chunk, ...rideAlong]);
        chunk = [];
        chunkBytes = 0;
      };
      for (const file of chunkables) {
        const exceeds =
          chunk.length > 0 &&
          (chunk.length + 1 > BATCH_MAX_FILES || chunkBytes + file.size > budgetPerChunk);
        if (exceeds) flushChunk();
        chunk.push(file);
        chunkBytes += file.size;
      }
      flushChunk();
      continue;
    }

    // Whole directories ride together while they fit, so small folders do not
    // each pay for a request of their own.
    const exceeds =
      current.length > 0 &&
      (current.length + group.length > BATCH_MAX_FILES || currentBytes + groupBytes > BATCH_MAX_BYTES);
    if (exceeds) flushCurrent();
    current.push(...group);
    currentBytes += groupBytes;
  }
  flushCurrent();
  return batches;
}
