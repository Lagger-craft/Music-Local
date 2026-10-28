import { useCallback, useState } from 'react';
import { notifyUnauthorized } from '../api';
import type { UploadResult } from '../types';
import { planBatches, relativePath } from './batching';

export interface UploadState {
  uploading: boolean;
  /** 0-100 while uploading. */
  progress: number;
  result: UploadResult | null;
  error: string | null;
}

const INITIAL_STATE: UploadState = { uploading: false, progress: 0, result: null, error: null };

/**
 * Multipart upload with progress: form fields alternate `files` (one file)
 * and `paths` (its relative path, e.g. `My Album/01 - song.mp3` from
 * webkitRelativePath, falling back to the bare filename).
 *
 * Files are sent as sequential batches (see `planBatches`); progress is
 * reported over the whole selection and the per-batch results are merged into
 * one summary. A failed batch stops the run and reports the partial result.
 */
export function useUpload(onUploaded: () => void) {
  const [state, setState] = useState<UploadState>(INITIAL_STATE);

  const upload = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;

      const batches = planBatches(files);
      const totalBytes = files.reduce((sum, f) => sum + f.size, 0) || 1;
      setState({ uploading: true, progress: 0, result: null, error: null });

      let bytesDone = 0;
      let aggregate: UploadResult = { added: 0, tracks: [], skipped: [], coversApplied: 0, errors: [] };
      let failure: string | null = null;

      /** Send one batch; resolves when it completes or fails (never rejects). */
      const runBatch = (batch: File[]): Promise<void> =>
        new Promise((resolve) => {
          const form = new FormData();
          for (const file of batch) {
            form.append('files', file, file.name);
            form.append('paths', relativePath(file));
          }

          const xhr = new XMLHttpRequest();
          xhr.open('POST', '/api/library/upload');
          xhr.responseType = 'text';

          xhr.upload.onprogress = (e) => {
            if (!e.lengthComputable) return;
            const pct = Math.min(100, Math.round(((bytesDone + e.loaded) / totalBytes) * 100));
            setState((s) => (s.uploading ? { ...s, progress: pct } : s));
          };
          xhr.onload = () => {
            if (xhr.status === 401) {
              notifyUnauthorized();
              failure = 'Session expired.';
              resolve();
              return;
            }
            if (xhr.status < 200 || xhr.status >= 300) {
              failure = `Upload failed: HTTP ${xhr.status}`;
              resolve();
              return;
            }
            try {
              const batchResult = resultOf(xhr.responseText);
              aggregate = {
                added: aggregate.added + batchResult.added,
                tracks: [...aggregate.tracks, ...batchResult.tracks],
                skipped: [...aggregate.skipped, ...batchResult.skipped],
                coversApplied: aggregate.coversApplied + batchResult.coversApplied,
                errors: [...aggregate.errors, ...batchResult.errors],
              };
              bytesDone += batch.reduce((sum, f) => sum + f.size, 0);
              resolve();
            } catch {
              failure = 'Upload finished but the response could not be parsed.';
              resolve();
            }
          };
          xhr.onerror = () => {
            failure = 'Upload failed (network error).';
            resolve();
          };
          xhr.onabort = () => resolve();

          xhr.send(form);
        });

      void (async () => {
        for (const batch of batches) {
          await runBatch(batch);
          if (failure !== null) break;
        }
        const partial = aggregate.added > 0 || aggregate.skipped.length > 0 || aggregate.errors.length > 0;
        if (failure !== null) {
          setState({ uploading: false, progress: 0, result: partial ? aggregate : null, error: failure });
          if (partial) onUploaded();
          return;
        }
        setState({ uploading: false, progress: 100, result: aggregate, error: null });
        onUploaded();
      })();
    },
    [onUploaded],
  );

  const clearResult = useCallback(() => setState(INITIAL_STATE), []);

  return { ...state, upload, clearResult };
}

/** Parse one batch response body exactly once. */
function resultOf(text: string): UploadResult {
  return JSON.parse(text) as UploadResult;
}
