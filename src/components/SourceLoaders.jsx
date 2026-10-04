import { useRef } from 'react';
import EmptyState from './ui/EmptyState.jsx';

// Takes the chosen files out of a file input, then empties it so the same files can be chosen again.
function takeChosenFiles(input) {
  const files = [...(input.files ?? [])];
  input.value = '';
  return files;
}

// The three ways to open a database: upload, fetch by URL, and the catalog. Uploads take files or
// whole folders, chosen or dropped.
function SourceLoaders({
  dropzone,
  fileInputRef,
  onFilesChosen,
  databaseUrl,
  onDatabaseUrlChange,
  onFetchSubmit,
  catalogReady,
  catalogCount,
  catalogStatus,
  catalogError,
  onBrowseCatalog,
}) {
  const folderInputRef = useRef(null);
  return (
    <section className="loader-grid">
      <section
        className={[
          'panel',
          'dropzone',
          'source-card',
          dropzone.isDragActive ? 'dropzone-active' : '',
          dropzone.isDropPulseActive ? 'dropzone-drop-feedback' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        {...dropzone.dropzoneProps}
      >
        <p className="section-label">Upload</p>
        <h2>Drag databases here</h2>
        <p className="helper-copy">
          Supports database files (<code>.json</code>), drop-in databases (<code>.ini</code>), and <code>downloader.ini</code>.
          All can be zipped. Drop several files or whole folders to choose among the databases they hold.
        </p>
        <button
          type="button"
          className="dropzone-surface"
          onClick={() => {
            document.activeElement?.blur?.();
            fileInputRef.current?.click();
          }}
        >
          <span className="dropzone-note">Drop files or folders here</span>
          <span className="dropzone-hint">or click to choose files from disk</span>
          <span className="dropzone-action">Choose files</span>
        </button>
        <div className="button-row">
          <button
            type="button"
            className="inline-action-button"
            onClick={() => {
              document.activeElement?.blur?.();
              folderInputRef.current?.click();
            }}
          >
            Choose a folder
          </button>
        </div>
        <input
          id="database-file-input"
          ref={fileInputRef}
          style={{ display: 'none' }}
          type="file"
          multiple
          accept=".json,.json.zip,.ini,.ini.zip,.zip,application/json,application/zip,text/plain"
          onChange={(event) => onFilesChosen(takeChosenFiles(event.target), { fromFolder: false })}
        />
        <input
          id="database-folder-input"
          ref={folderInputRef}
          style={{ display: 'none' }}
          type="file"
          webkitdirectory=""
          onChange={(event) => onFilesChosen(takeChosenFiles(event.target), { fromFolder: true })}
        />
      </section>

      <section className="panel source-card">
        <p className="section-label">Fetch</p>
        <h2>Open a remote database</h2>
        <form className="url-form" onSubmit={onFetchSubmit}>
          <label className="field-label" htmlFor="database-url">
            URL
          </label>
          <input
            id="database-url"
            type="url"
            placeholder="https://example.com/custom-db.ini.zip"
            value={databaseUrl}
            onChange={(event) => onDatabaseUrlChange(event.target.value)}
          />
          <button type="submit">Fetch database</button>
        </form>
        <p className="helper-copy">
          Enter a direct link to a database or database list. If the file includes more than one
          database, you can choose which one to open. After a successful load, the page address
          updates so you can share this view.
        </p>
      </section>

      <section className="panel source-panel source-card">
        <p className="section-label">Catalog</p>
        <h2>Browse known databases</h2>
        <p className="helper-copy">
          Open a list of known databases in a modal and load one directly from there.
        </p>
        <div className="button-row">
          <button
            type="button"
            onClick={() => {
              document.activeElement?.blur?.();
              onBrowseCatalog();
            }}
            disabled={!catalogReady}
          >
            Browse catalog
          </button>
        </div>
        <p className="catalog-count-inline">
          {catalogReady
            ? `${catalogCount} entries available`
            : 'Catalog unavailable'}
        </p>
        {catalogStatus === 'loading' ? (
          <p className="helper-copy">Loading catalog entries.</p>
        ) : null}
        {catalogStatus === 'error' ? <p className="status error">{catalogError}</p> : null}
        <EmptyState message="Choose a database in the catalog modal to open it." />
      </section>
    </section>
  );
}

export default SourceLoaders;
