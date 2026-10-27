import { useCallback, useState } from 'react';
import { notifyUnauthorized } from '../api';
import type { UploadResult } from '../types';

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
 */
export function useUpload(onUploaded: () => void) {
  const [state, setState] = useState<UploadState>(INITIAL_STATE);

  const upload = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;

      const form = new FormData();
      for (const file of files) {
        form.append('files', file, file.name);
        const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
        form.append('paths', relative && relative.length > 0 ? relative : file.name);
      }

      setState({ uploading: true, progress: 0, result: null, error: null });

      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/library/upload');
      xhr.responseType = 'text';

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          setState((s) => (s.uploading ? { ...s, progress: pct } : s));
        }
      };
      xhr.onload = () => {
        if (xhr.status === 401) {
          notifyUnauthorized();
          setState({ uploading: false, progress: 0, result: null, error: 'Session expired.' });
          return;
        }
        if (xhr.status < 200 || xhr.status >= 300) {
          setState({
            uploading: false,
            progress: 0,
            result: null,
            error: `Upload failed: HTTP ${xhr.status}`,
          });
          return;
        }
        try {
          const result = JSON.parse(xhr.responseText) as UploadResult;
          setState({ uploading: false, progress: 100, result, error: null });
          onUploaded();
        } catch {
          setState({
            uploading: false,
            progress: 0,
            result: null,
            error: 'Upload finished but the response could not be parsed.',
          });
        }
      };
      xhr.onerror = () => {
        setState({
          uploading: false,
          progress: 0,
          result: null,
          error: 'Upload failed (network error).',
        });
      };

      xhr.send(form);
    },
    [onUploaded],
  );

  const clearResult = useCallback(() => setState(INITIAL_STATE), []);

  return { ...state, upload, clearResult };
}
