import { useRef, type ChangeEvent } from 'react';
import type { UploadState } from '../hooks/useUpload';
import { splitPreview } from '../hooks/summary';

/** Visible rows per skipped/error list; the rest collapses behind a toggle. */
const SUMMARY_PREVIEW = 6;

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
            <CompactList items={result.skipped} label="skipped" render={(s) => `${s.filename}: ${s.reason}`} />
          ) : null}
          {result.errors.length > 0 ? (
            <CompactList items={result.errors} label="errors" render={(e) => `${e.filename}: ${e.error}`} />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/**
 * Skipped/errors list that stays short: the first rows show inline and the
 * remainder collapses behind a toggle. A 500-song folder upload reports every
 * unsupported file (thumbnails, .txt), and rendering hundreds of rows pushes
 * the library list — the thing needed to load a track — off the panel.
 */
function CompactList<T>({
  items,
  label,
  render,
}: {
  items: T[];
  label: string;
  render: (item: T) => string;
}) {
  const { preview, rest } = splitPreview(items, SUMMARY_PREVIEW);
  return (
    <ul className="summary-list">
      {preview.map((item, i) => (
        <li key={`${label}-${i}`}>{render(item)}</li>
      ))}
      {rest.length > 0 ? (
        <details className="summary-more">
          <summary>
            … and {rest.length} more {label}
          </summary>
          <ul>
            {rest.map((item, i) => (
              <li key={`${label}-more-${i}`}>{render(item)}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </ul>
  );
}
