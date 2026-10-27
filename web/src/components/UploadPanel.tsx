import { useRef, type ChangeEvent } from 'react';
import type { UploadState } from '../hooks/useUpload';

interface UploadPanelProps {
  upload: UploadState & {
    upload: (files: File[]) => void;
    clearResult: () => void;
  };
}

/**
 * Upload panel: two buttons (loose files / whole folder via webkitdirectory),
 * an XHR progress bar and the added/skipped/coversApplied/errors summary.
 */
export function UploadPanel({ upload }: UploadPanelProps) {
  const filesInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const onFilesChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) upload.upload(files);
    e.target.value = '';
  };

  const { uploading, progress, result, error } = upload;

  return (
    <section className="upload-panel plastic-card" aria-label="Upload music">
      <h2 className="panel-heading">Add Music</h2>

      <div className="upload-buttons">
        <button
          type="button"
          className="btn"
          onClick={() => filesInputRef.current?.click()}
          disabled={uploading}
        >
          Upload files
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => folderInputRef.current?.click()}
          disabled={uploading}
        >
          Upload folder (+cover art)
        </button>
        <input
          ref={filesInputRef}
          type="file"
          multiple
          hidden
          accept="audio/*,.mp3,.flac,.m4a,.aac,.ogg,.opus,.wav,image/*"
          onChange={onFilesChange}
        />
        <input
          ref={folderInputRef}
          type="file"
          multiple
          hidden
          onChange={onFilesChange}
          {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
        />
      </div>

      {uploading ? (
        <div className="upload-progress" aria-label={`Uploading ${progress}%`}>
          <div className="rail">
            <div className="pos" style={{ left: `calc(${progress}% - ${progress * 0.14}px)` }} />
          </div>
          <div className="labels">
            <span>UPLOADING...</span>
            <span>{progress}%</span>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="upload-error" role="alert">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="upload-summary" role="status">
          <p className="summary-line">
            ADDED {result.added} TRACK{result.added === 1 ? '' : 'S'} —{' '}
            {result.coversApplied} COVER{result.coversApplied === 1 ? '' : 'S'} APPLIED — SKIPPED{' '}
            {result.skipped.length} — ERRORS {result.errors.length}
          </p>
          {result.skipped.length > 0 ? (
            <ul className="summary-list">
              {result.skipped.map((s, i) => (
                <li key={`s-${i}`}>
                  {s.filename}: {s.reason}
                </li>
              ))}
            </ul>
          ) : null}
          {result.errors.length > 0 ? (
            <ul className="summary-list">
              {result.errors.map((e, i) => (
                <li key={`e-${i}`}>
                  {e.filename}: {e.error}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
