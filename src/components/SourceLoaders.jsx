// Takes the chosen files out of a file input, then empties it so the same files can be chosen again.
function takeChosenFiles(input) {
  const files = [...(input.files ?? [])];
  input.value = '';
  return files;
}

// The three ways to open a database: upload, fetch by URL, and the catalog. Each card has the same
// layout: its heading, a short text, and its action at the bottom, ending in a full-width button.
// Uploads take files, chosen or dropped, and whole folders, dropped.
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
  const chooseFiles = () => {
    /** @type {HTMLElement | null} */ (document.activeElement)?.blur?.();
    fileInputRef.current?.click();
  };

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
        <div>
          <p className="section-label">Upload</p>
          <h2>Drag databases here</h2>
        </div>
        <p className="helper-copy">
          Database files (<code>.json</code>), drop-in databases (<code>.ini</code>) and <code>downloader.ini</code>,
          zipped or not. Drop several files or whole folders to choose among their databases.
        </p>
        <div className="source-card-action">
          {/* The whole card takes drops; this shows where, and opens the file chooser too. */}
          <div className="dropzone-surface" onClick={chooseFiles}>
            <span className="dropzone-note">Drop files or folders here</span>
          </div>
          <button type="button" className="dropzone-action" onClick={chooseFiles}>
            Choose files
          </button>
        </div>
        <input
          id="database-file-input"
          ref={fileInputRef}
          style={{ display: 'none' }}
          type="file"
          multiple
          accept=".json,.json.zip,.ini,.ini.zip,.zip,application/json,application/zip,text/plain"
          onChange={(event) => onFilesChosen(takeChosenFiles(event.target))}
        />
      </section>

      <section className="panel source-card">
        <div>
          <p className="section-label">Fetch</p>
          <h2>Open a remote database</h2>
        </div>
        <p className="helper-copy">
          Enter a direct link to a database or database list. Once it loads, the page address
          updates so you can share this view.
        </p>
        <form className="source-card-action" onSubmit={onFetchSubmit}>
          <div>
            <label className="catalog-meta-label" htmlFor="database-url">
              URL
            </label>
            <input
              id="database-url"
              type="url"
              placeholder="https://example.com/custom-db.ini.zip"
              value={databaseUrl}
              onChange={(event) => onDatabaseUrlChange(event.target.value)}
            />
          </div>
          <button type="submit">Fetch database</button>
        </form>
      </section>

      <section className="panel source-card">
        <div>
          <p className="section-label">Catalog</p>
          <h2>Browse known databases</h2>
        </div>
        <p className="helper-copy">Pick one or several databases from a list of known ones.</p>
        <div className="source-card-action">
          <p className="catalog-count-inline">
            {catalogReady
              ? `${catalogCount} entries available`
              : 'Catalog unavailable'}
          </p>
          {catalogStatus === 'loading' ? (
            <p className="helper-copy">Loading catalog entries.</p>
          ) : null}
          {catalogStatus === 'error' ? <p className="status error">{catalogError}</p> : null}
          <button
            type="button"
            onClick={() => {
              /** @type {HTMLElement | null} */ (document.activeElement)?.blur?.();
              onBrowseCatalog();
            }}
            disabled={!catalogReady}
          >
            Browse catalog
          </button>
        </div>
      </section>
    </section>
  );
}

export default SourceLoaders;
