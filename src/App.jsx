import {
  memo,
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { flushSync } from 'react-dom';
import {
  loadDatabaseSourceFile,
  loadDatabaseSourceUrl,
  loadRuntimeDatabaseCatalog,
} from './lib/database.js';

const DATABASE_URL_PARAM = 'database-url';

export default function App() {
  const fileInputRef = useRef(null);
  const autoLoadHandledRef = useRef(false);
  const inspectionRef = useRef(null);
  const iniSourceRef = useRef(null);
  const [databaseUrl, setDatabaseUrl] = useState(() => readDatabaseUrlSearchParam());
  const [loadingMessage, setLoadingMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [inspection, setInspection] = useState(null);
  const [iniSource, setIniSource] = useState(null);
  const [databaseDetailed, setDatabaseDetailed] = useState(false);
  const [catalogOptions, setCatalogOptions] = useState([]);
  const [catalogStatus, setCatalogStatus] = useState('loading');
  const [catalogError, setCatalogError] = useState('');
  const [catalogModalOpen, setCatalogModalOpen] = useState(false);
  const [iniPickerOpen, setIniPickerOpen] = useState(false);
  const inspectionKey = inspection
    ? `${inspection.source.sourceLabel}:${inspection.overview.dbId}:${inspection.overview.timestamp}`
    : 'empty';

  useEffect(() => {
    inspectionRef.current = inspection;
  }, [inspection]);

  useEffect(() => {
    iniSourceRef.current = iniSource;
  }, [iniSource]);

  useEffect(() => {
    if (autoLoadHandledRef.current) {
      return;
    }

    autoLoadHandledRef.current = true;
    const sharedDatabaseUrl = readDatabaseUrlSearchParam();
    if (!sharedDatabaseUrl) {
      return;
    }

    void loadRemoteSource(sharedDatabaseUrl, { syncSearchParam: false });
  }, []);

  useEffect(() => {
    function handlePopState() {
      const sharedDatabaseUrl = readDatabaseUrlSearchParam();
      setDatabaseUrl(sharedDatabaseUrl);
      setErrorMessage('');

      if (sharedDatabaseUrl) {
        void loadRemoteSource(sharedDatabaseUrl, { syncSearchParam: false });
        return;
      }

      if (iniSourceRef.current?.source?.sourceKind === 'url') {
        setIniSource(null);
      }

      if (inspectionRef.current?.source?.sourceKind === 'url') {
        setInspection(null);
      }
    }

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  useEffect(() => {
    if (!iniSource?.entries.length) {
      setIniPickerOpen(false);
      return;
    }

    setIniPickerOpen(true);
  }, [iniSource]);

  useEffect(() => {
    if (!catalogModalOpen && !iniPickerOpen) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setCatalogModalOpen(false);
        setIniPickerOpen(false);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [catalogModalOpen, iniPickerOpen]);

  useEffect(() => {
    let cancelled = false;

    async function loadCatalog() {
      setCatalogStatus('loading');
      setCatalogError('');

      try {
        const entries = await loadRuntimeDatabaseCatalog();
        if (cancelled) {
          return;
        }

        setCatalogOptions(entries);
        setCatalogStatus('ready');
      } catch (error) {
        if (cancelled) {
          return;
        }

        setCatalogOptions([]);
        setCatalogStatus('error');
        setCatalogError(error.message);
      }
    }

    void loadCatalog();

    return () => {
      cancelled = true;
    };
  }, []);

  function clearLoadedSource() {
    setInspection(null);
    setIniSource(null);
  }

  function openRemoteDatabaseFromModal(url, { closeCatalog = false, closeIni = false } = {}) {
    const requestedUrl = String(url).trim();
    if (!requestedUrl) {
      return;
    }

    flushSync(() => {
      if (closeCatalog) {
        setCatalogModalOpen(false);
      }

      if (closeIni) {
        setIniPickerOpen(false);
      }

      setDatabaseUrl(requestedUrl);
      setLoadingMessage(`Fetching ${requestedUrl}...`);
      setErrorMessage('');
      clearLoadedSource();
    });

    window.setTimeout(() => {
      void loadRemoteSource(requestedUrl, { skipPrepare: true });
    }, 0);
  }

  async function handleLoadedSource(
    loadedSource,
    { origin, requestedUrl = '', syncSearchParam = true, visitedUrls = new Set() } = {},
  ) {
    if (loadedSource.kind === 'database') {
      setInspection(loadedSource.inspection);
      setIniSource(null);
      setIniPickerOpen(false);
      setCatalogModalOpen(false);

      if (origin === 'upload') {
        setDatabaseUrl('');
        writeDatabaseUrlSearchParam('', { pushHistory: true });
      } else {
        const sharedUrl = loadedSource.inspection.source.sourceLabel;
        setDatabaseUrl(sharedUrl);
        if (syncSearchParam) {
          writeDatabaseUrlSearchParam(sharedUrl, { pushHistory: true });
        }
      }

      return;
    }

    if (loadedSource.entries.length === 1) {
      const [entry] = loadedSource.entries;
      setIniSource(null);
      setIniPickerOpen(false);
      setDatabaseUrl(entry.dbUrl);
      await loadRemoteSource(entry.dbUrl, {
        syncSearchParam: origin === 'url' ? syncSearchParam : true,
        visitedUrls,
      });
      return;
    }

    setInspection(null);
    setIniSource(loadedSource);

    if (origin === 'upload') {
      setDatabaseUrl('');
      writeDatabaseUrlSearchParam('', { pushHistory: true });
      return;
    }

    setDatabaseUrl(requestedUrl);
    if (syncSearchParam) {
      writeDatabaseUrlSearchParam(requestedUrl, { pushHistory: true });
    }
  }

  async function loadFile(file) {
    if (!file) {
      return;
    }

    setLoadingMessage(`Loading ${file.name}...`);
    setErrorMessage('');
    clearLoadedSource();

    try {
      const loadedSource = await loadDatabaseSourceFile(file);
      await handleLoadedSource(loadedSource, { origin: 'upload' });
    } catch (error) {
      setIniPickerOpen(false);
      setErrorMessage(error.message);
    } finally {
      setLoadingMessage('');
    }
  }

  async function loadRemoteSource(
    input,
    { syncSearchParam = true, visitedUrls = new Set(), skipPrepare = false } = {},
  ) {
    const requestedUrl = String(input).trim();
    if (!requestedUrl) {
      if (skipPrepare) {
        setLoadingMessage('');
      }
      setErrorMessage('Enter a URL first.');
      return;
    }

    const normalizedRequestedUrl = normalizeComparableUrl(requestedUrl);
    if (normalizedRequestedUrl && visitedUrls.has(normalizedRequestedUrl)) {
      if (skipPrepare) {
        setLoadingMessage('');
      }
      setErrorMessage(`Detected a loop while following db_url references from ${requestedUrl}.`);
      return;
    }

    if (!skipPrepare) {
      setLoadingMessage(`Fetching ${requestedUrl}...`);
      setErrorMessage('');
      clearLoadedSource();
    }

    try {
      const nextVisitedUrls = new Set(visitedUrls);
      if (normalizedRequestedUrl) {
        nextVisitedUrls.add(normalizedRequestedUrl);
      }

      const loadedSource = await loadDatabaseSourceUrl(requestedUrl);
      await handleLoadedSource(loadedSource, {
        origin: 'url',
        requestedUrl,
        syncSearchParam,
        visitedUrls: nextVisitedUrls,
      });
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setLoadingMessage('');
    }
  }

  async function loadUrl(event) {
    event.preventDefault();
    await loadRemoteSource(databaseUrl);
  }

  function loadIniEntry(entry) {
    if (!entry?.dbUrl) {
      return;
    }

    openRemoteDatabaseFromModal(entry.dbUrl, { closeIni: true });
  }

  function handleDrop(event) {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    void loadFile(file);
  }

  return (
    <main className="app-shell">
      <section className="hero panel">
        <div>
          <p className="eyebrow">MiSTer Downloader</p>
          <h1>Custom Database Inspector</h1>
          <p className="hero-copy">
            Load a custom downloader database from disk or fetch it from a URL. The app inspects
            downloader JSON databases, understands downloader INI lists that point to databases,
            resolves indexed tags through the tag dictionary, follows remote archive summaries,
            and renders the filesystem and archive trees in the browser.
          </p>
        </div>
        <div className="hero-note">
          <strong>Remote fetch note</strong>
          <p>
            Database and summary URLs still need normal browser access. If the host blocks CORS,
            the inspector cannot fetch that resource from GitHub Pages.
          </p>
        </div>
      </section>

      <section className="loader-grid">
        <section
          className="panel dropzone source-card"
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
        >
          <p className="section-label">Upload</p>
          <h2>Drag a database here</h2>
          <p>
            Accepted: .json, .json.zip, .ini, .ini.zip, or any ZIP whose first supported entry is
            a downloader JSON or INI source.
          </p>
          <label className="dropzone-surface" htmlFor="database-file-input">
            <span className="dropzone-note">Drop database files here</span>
            <span className="dropzone-hint">or click to choose a file from disk</span>
            <span className="dropzone-action">Choose file</span>
          </label>
          <input
            id="database-file-input"
            ref={fileInputRef}
            className="hidden-input"
            type="file"
            accept=".json,.json.zip,.ini,.ini.zip,.zip,application/json,application/zip,text/plain"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              void loadFile(file);
            }}
          />
        </section>

        <section className="panel source-card">
          <p className="section-label">Fetch</p>
          <h2>Open a remote database</h2>
          <form className="url-form" onSubmit={loadUrl}>
            <label className="field-label" htmlFor="database-url">
              URL
            </label>
            <input
              id="database-url"
              type="url"
              placeholder="https://example.com/custom-db.ini.zip"
              value={databaseUrl}
              onChange={(event) => setDatabaseUrl(event.target.value)}
            />
            <button type="submit">Fetch database</button>
          </form>
          <p className="helper-copy">
            The URL must end in <code>.json</code>, <code>.json.zip</code>, <code>.ini</code>, or
            <code>.ini.zip</code>. INI sources with multiple entries open a chooser first.
            Archive summary files are fetched automatically when present, and successful remote
            fetches update the page URL so you can share the inspector state directly.
          </p>
        </section>

        <section className="panel source-panel source-card">
          <p className="section-label">Picker</p>
          <h2>Use Update_All_MiSTer catalog</h2>
          <p className="helper-copy">
            Browse the runtime-loaded `Update_All_MiSTer` catalog in a modal instead of keeping the
            full picker expanded in the page layout.
          </p>
          <div className="button-row">
            <button
              type="button"
              onClick={() => setCatalogModalOpen(true)}
              disabled={catalogStatus !== 'ready'}
            >
              Browse catalog
            </button>
          </div>
          <p className="catalog-count-inline">
            {catalogStatus === 'ready'
              ? `${catalogOptions.length} entries available`
              : 'Catalog unavailable'}
          </p>
          {catalogStatus === 'loading' ? (
            <p className="helper-copy">
              Reading the current `Update_All_MiSTer/src/update_all/databases.py` catalog at
              runtime.
            </p>
          ) : null}
          {catalogStatus === 'error' ? <p className="status error">{catalogError}</p> : null}
          <EmptyState message="Choose a catalog entry in the modal, then open it from there." />
        </section>
      </section>

      <div className="results-stack">
        {errorMessage ? (
          <section className="panel status-panel">
            <p className="status error">{errorMessage}</p>
          </section>
        ) : null}

        {iniSource ? (
          <section className="panel source-panel">
            <p className="section-label">INI</p>
            <h2>Choose a database from this list</h2>
            <p className="helper-copy">
              {iniSource.source.sourceLabel} was parsed as {describeSourceContainer(iniSource.source)}
              {' and contains '}
              {iniSource.entries.length} {iniSource.entries.length === 1 ? 'entry' : 'entries'}.
            </p>
            <div className="button-row">
              <button type="button" onClick={() => setIniPickerOpen(true)}>
                Browse entries
              </button>
            </div>
            <EmptyState message="Choose an INI entry in the modal, then open it from there." />
          </section>
        ) : null}

        {inspection ? (
          <>
            <section className="panel overview-panel">
              <div className="overview-header">
                <div>
                  <p className="section-label">Database</p>
                  <h2>{inspection.overview.dbId}</h2>
                </div>
                <div className="overview-side">
                  <div className="highlight-row">
                    <HighlightCard
                      label="Version"
                      value={`v${inspection.overview.version}`}
                      accent="version"
                    />
                    <HighlightCard
                      label="Timestamp"
                      value={inspection.overview.timestampLabel}
                      subvalue={`Epoch ${inspection.overview.timestamp}`}
                      accent="timestamp"
                    />
                  </div>
                  <div className="overview-controls">
                    <DetailedToggle
                      detailed={databaseDetailed}
                      onDetailedChange={setDatabaseDetailed}
                    />
                  </div>
                </div>
              </div>

              <div className="overview-grid">
                <MetadataCard
                  title="Source"
                  fields={[
                    { label: 'Loaded from', value: inspection.source.sourceLabel, kind: 'url' },
                    {
                      label: 'Container',
                      value:
                        inspection.source.containerType === 'zip'
                          ? `ZIP archive -> ${inspection.source.extractedEntry}`
                          : 'Plain JSON',
                    },
                  ]}
                />
                <MetadataCard
                  title="Counts"
                  fields={[
                    { label: 'Files', value: inspection.overview.counts.files.toLocaleString() },
                    { label: 'Folders', value: inspection.overview.counts.folders.toLocaleString() },
                    {
                      label: 'Archives',
                      value: inspection.overview.counts.archives.toLocaleString(),
                    },
                  ]}
                />
                {databaseDetailed ? (
                  <MetadataCard
                    title="Options"
                    fields={[
                      {
                        label: 'base_files_url',
                        value: inspection.overview.baseFilesUrl || 'None',
                        kind: 'url',
                      },
                      {
                        label: 'Default filter',
                        value: inspection.overview.defaultFilter || 'None',
                      },
                      {
                        label: 'Imported db_files',
                        value: inspection.overview.importedDatabases.length
                          ? inspection.overview.importedDatabases
                          : ['None'],
                      },
                    ]}
                  />
                ) : null}
              </div>
            </section>

            <FilesystemSection key={`filesystem:${inspectionKey}`} tree={inspection.filesystemTree} />

            <ArchiveSummariesSection
              key={`archives:${inspectionKey}`}
              archiveViews={inspection.archiveViews}
            />

            <CollapsibleSection
              label="Diagnostics"
              title="Issues and warnings"
              defaultOpen
            >
              {inspection.issues.length ? (
                <ul className="issue-list">
                  {inspection.issues.map((issue) => (
                    <li key={issue.id} className={`issue issue-${issue.level}`}>
                      <span className="issue-level">{issue.level}</span>
                      <strong>{issue.context}</strong>
                      <span>{issue.message}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState message="No schema or path issues were detected by the browser-side inspector." />
              )}
            </CollapsibleSection>

            <TagDictionary tags={inspection.overview.tagDictionary} />
          </>
        ) : loadingMessage ? (
          <section className="panel empty-screen loading-screen">
            <div className="loading-spinner" aria-hidden="true" />
            <p className="section-label">Loading</p>
            <h2>Database is being loaded</h2>
            <p>{loadingMessage}</p>
          </section>
        ) : !iniSource ? (
          <section className="panel empty-screen">
            <p className="section-label">Ready</p>
            <h2>No database loaded yet</h2>
            <p>
              Upload a local JSON or INI source, or fetch a remote one to inspect the database
              metadata, path tree, archive contents, and resolved tags.
            </p>
          </section>
        ) : null}
      </div>

      {catalogModalOpen ? (
        <CatalogPickerModal
          options={catalogOptions}
          status={catalogStatus}
          error={catalogError}
          initialDatabaseUrl={databaseUrl}
          onClose={() => setCatalogModalOpen(false)}
          onOpenDatabase={(url) => {
            openRemoteDatabaseFromModal(url, { closeCatalog: true });
          }}
        />
      ) : null}

      {iniPickerOpen && iniSource ? (
        <IniPickerModal
          iniSource={iniSource}
          onClose={() => setIniPickerOpen(false)}
          onOpenDatabase={(entry) => {
            void loadIniEntry(entry);
          }}
        />
      ) : null}
    </main>
  );
}

const CatalogPickerModal = memo(function CatalogPickerModal({
  options,
  status,
  error,
  initialDatabaseUrl,
  onClose,
  onOpenDatabase,
}) {
  const initialSelectedKey = useMemo(() => {
    const normalizedCurrentUrl = normalizeComparableUrl(initialDatabaseUrl);
    return options.find((option) => normalizeComparableUrl(option.dbUrl) === normalizedCurrentUrl)?.key ?? '';
  }, [initialDatabaseUrl, options]);
  const [query, setQuery] = useState('');
  const [selectedKey, setSelectedKey] = useState(initialSelectedKey);
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());

  useEffect(() => {
    setSelectedKey(initialSelectedKey);
  }, [initialSelectedKey]);

  const filteredOptions = useMemo(() => {
    if (!deferredQuery) {
      return options;
    }

    return options.filter((option) => {
      const haystack = `${option.dbId} ${option.title} ${option.dbUrl}`.toLowerCase();
      return haystack.includes(deferredQuery);
    });
  }, [deferredQuery, options]);

  const selectedOption = useMemo(
    () => options.find((item) => item.key === selectedKey) ?? null,
    [options, selectedKey],
  );

  return (
    <ModalFrame
      label="Picker"
      title="Browse Update_All_MiSTer catalog"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="secondary-button" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            onClick={() => {
              if (selectedOption) {
                onOpenDatabase(selectedOption.dbUrl);
              }
            }}
            disabled={!selectedOption}
          >
            Open selected database
          </button>
        </>
      }
    >
      <div className="modal-toolbar">
        <div className="catalog-search">
          <label className="field-label" htmlFor="catalog-modal-search">
            Search database picker
          </label>
          <input
            id="catalog-modal-search"
            type="search"
            placeholder="Search by db_id, title, or URL"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            disabled={status !== 'ready'}
          />
        </div>
        <p className="catalog-count">
          {status === 'ready'
            ? `${filteredOptions.length} of ${options.length} entries`
            : 'Catalog unavailable'}
        </p>
      </div>
      {selectedOption ? (
        <article className="compact-selected modal-selected">
          <p className="section-label">Selected</p>
          <div className="catalog-selected-grid compact-selected-grid">
            <div>
              <span className="catalog-meta-label">db_id</span>
              <code>{selectedOption.dbId}</code>
            </div>
            <div>
              <span className="catalog-meta-label">Title</span>
              <strong>{selectedOption.title}</strong>
            </div>
            <div className="catalog-selected-url">
              <span className="catalog-meta-label">db_url</span>
              <a href={selectedOption.dbUrl} target="_blank" rel="noreferrer">
                {selectedOption.dbUrl}
              </a>
            </div>
          </div>
        </article>
      ) : null}
      {status === 'loading' ? (
        <p className="helper-copy">
          Reading the current `Update_All_MiSTer/src/update_all/databases.py` catalog at runtime.
        </p>
      ) : null}
      {status === 'error' ? <p className="status error">{error}</p> : null}
      {status === 'ready' ? (
        filteredOptions.length ? (
          <div className="catalog-list modal-list" role="listbox" aria-label="Database picker results">
            {filteredOptions.map((option) => (
              <button
                key={option.key}
                type="button"
                className={
                  option.key === selectedKey
                    ? 'catalog-option catalog-option-selected'
                    : 'catalog-option'
                }
                onClick={() => setSelectedKey(option.key)}
              >
                <div className="catalog-option-head">
                  <code>{option.dbId}</code>
                  <strong>{option.title}</strong>
                </div>
                <span className="catalog-option-url">{option.dbUrl}</span>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState message="No catalog entries match the current search." />
        )
      ) : null}
    </ModalFrame>
  );
});

const IniPickerModal = memo(function IniPickerModal({ iniSource, onClose, onOpenDatabase }) {
  const [query, setQuery] = useState('');
  const [selectedKey, setSelectedKey] = useState(iniSource.entries[0]?.key ?? '');
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());

  useEffect(() => {
    setSelectedKey(iniSource.entries[0]?.key ?? '');
  }, [iniSource]);

  const filteredEntries = useMemo(() => {
    if (!deferredQuery) {
      return iniSource.entries;
    }

    return iniSource.entries.filter((entry) => {
      const haystack = `${entry.dbId} ${entry.dbUrl}`.toLowerCase();
      return haystack.includes(deferredQuery);
    });
  }, [deferredQuery, iniSource]);

  const selectedEntry = useMemo(
    () => iniSource.entries.find((entry) => entry.key === selectedKey) ?? null,
    [iniSource, selectedKey],
  );

  return (
    <ModalFrame
      label="INI"
      title="Choose a database from this INI"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="secondary-button" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            onClick={() => {
              if (selectedEntry) {
                onOpenDatabase(selectedEntry);
              }
            }}
            disabled={!selectedEntry}
          >
            Open selected database
          </button>
        </>
      }
    >
      <div className="modal-toolbar">
        <div className="catalog-search">
          <label className="field-label" htmlFor="ini-modal-search">
            Search INI entries
          </label>
          <input
            id="ini-modal-search"
            type="search"
            placeholder="Search by db_id or URL"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <p className="catalog-count">
          {filteredEntries.length} of {iniSource.entries.length} entries
        </p>
      </div>
      {selectedEntry ? (
        <article className="compact-selected modal-selected">
          <p className="section-label">Selected</p>
          <div className="catalog-selected-grid compact-selected-grid">
            <div>
              <span className="catalog-meta-label">db_id</span>
              <code>{selectedEntry.dbId}</code>
            </div>
            <div className="catalog-selected-url">
              <span className="catalog-meta-label">db_url</span>
              <a href={selectedEntry.dbUrl} target="_blank" rel="noreferrer">
                {selectedEntry.dbUrl}
              </a>
            </div>
          </div>
        </article>
      ) : null}
      {filteredEntries.length ? (
        <div className="catalog-list modal-list" role="listbox" aria-label="INI database entries">
          {filteredEntries.map((entry) => (
            <button
              key={entry.key}
              type="button"
              className={
                entry.key === selectedKey
                  ? 'catalog-option catalog-option-selected'
                  : 'catalog-option'
              }
              onClick={() => setSelectedKey(entry.key)}
            >
              <div className="catalog-option-head">
                <code>{entry.dbId}</code>
                <strong>Referenced database</strong>
              </div>
              <span className="catalog-option-url">{entry.dbUrl}</span>
            </button>
          ))}
        </div>
      ) : (
        <EmptyState message="No INI entries match the current search." />
      )}
    </ModalFrame>
  );
});

const FilesystemSection = memo(function FilesystemSection({ tree }) {
  const [detailed, setDetailed] = useState(false);
  const [collapsedIds, setCollapsedIds] = useState(() => new Set());
  const [detailOverrides, setDetailOverrides] = useState(() => new Map());
  const index = useMemo(() => buildFlatNodeIndex(tree.children), [tree]);
  const visibleRows = useMemo(
    () => collectVisibleRows(index.rootIds, index.rowsById, collapsedIds),
    [index, collapsedIds],
  );

  const handleDetailedChange = useCallback((nextDetailed) => {
    startTransition(() => {
      setDetailed(nextDetailed);
    });
  }, []);

  const handleExpandAll = useCallback(() => {
    startTransition(() => {
      setCollapsedIds(new Set());
    });
  }, []);

  const handleCollapseAll = useCallback(() => {
    startTransition(() => {
      setCollapsedIds(new Set(index.collapsibleIds));
    });
  }, [index]);

  const handleToggleCollapsed = useCallback((rowId) => {
    startTransition(() => {
      setCollapsedIds((current) => toggleSetMembership(current, rowId));
    });
  }, []);

  const handleToggleDetails = useCallback(
    (rowId) => {
      startTransition(() => {
        setDetailOverrides((current) => toggleDetailOverride(current, rowId, detailed));
      });
    },
    [detailed],
  );

  return (
    <CollapsibleSection
      label="Filesystem"
      title="Files and folders"
      defaultOpen
      actions={
        <SectionControls
          detailed={detailed}
          onDetailedChange={handleDetailedChange}
          onExpandAll={handleExpandAll}
          onCollapseAll={handleCollapseAll}
        />
      }
    >
      {visibleRows.length ? (
        <div className="tree-root">
          {visibleRows.map((row) => (
            <FlatNodeRow
              key={row.id}
              row={row}
              collapsed={collapsedIds.has(row.id)}
              detailsVisible={detailOverrides.get(row.id) ?? detailed}
              onToggleCollapsed={handleToggleCollapsed}
              onToggleDetails={handleToggleDetails}
            />
          ))}
        </div>
      ) : (
        <EmptyState message="No top-level files or folders were found." />
      )}
    </CollapsibleSection>
  );
});

const ArchiveSummariesSection = memo(function ArchiveSummariesSection({ archiveViews }) {
  const [detailed, setDetailed] = useState(false);
  const [collapsedIds, setCollapsedIds] = useState(() => new Set());
  const [detailOverrides, setDetailOverrides] = useState(() => new Map());
  const index = useMemo(() => buildFlatArchiveIndex(archiveViews), [archiveViews]);
  const visibleRows = useMemo(
    () => collectVisibleRows(index.rootIds, index.rowsById, collapsedIds),
    [index, collapsedIds],
  );

  const handleDetailedChange = useCallback((nextDetailed) => {
    startTransition(() => {
      setDetailed(nextDetailed);
    });
  }, []);

  const handleExpandAll = useCallback(() => {
    startTransition(() => {
      setCollapsedIds(new Set());
    });
  }, []);

  const handleCollapseAll = useCallback(() => {
    startTransition(() => {
      setCollapsedIds(new Set(index.collapsibleIds));
    });
  }, [index]);

  const handleToggleCollapsed = useCallback((rowId) => {
    startTransition(() => {
      setCollapsedIds((current) => toggleSetMembership(current, rowId));
    });
  }, []);

  const handleToggleDetails = useCallback(
    (rowId) => {
      startTransition(() => {
        setDetailOverrides((current) => toggleDetailOverride(current, rowId, detailed));
      });
    },
    [detailed],
  );

  return (
    <CollapsibleSection
      label="Archives"
      title="Archive summaries"
      defaultOpen
      actions={
        <SectionControls
          detailed={detailed}
          onDetailedChange={handleDetailedChange}
          onExpandAll={handleExpandAll}
          onCollapseAll={handleCollapseAll}
        />
      }
    >
      {visibleRows.length ? (
        <div className="archive-list">
          {visibleRows.map((row) =>
            row.type === 'archive' ? (
              <FlatArchiveRow
                key={row.id}
                row={row}
                collapsed={collapsedIds.has(row.id)}
                detailsVisible={detailOverrides.get(row.id) ?? detailed}
                onToggleCollapsed={handleToggleCollapsed}
                onToggleDetails={handleToggleDetails}
              />
            ) : (
              <FlatNodeRow
                key={row.id}
                row={row}
                collapsed={collapsedIds.has(row.id)}
                detailsVisible={detailOverrides.get(row.id) ?? detailed}
                onToggleCollapsed={handleToggleCollapsed}
                onToggleDetails={handleToggleDetails}
              />
            ),
          )}
        </div>
      ) : (
        <EmptyState message="This database does not define any archives." />
      )}
    </CollapsibleSection>
  );
});

function readDatabaseUrlSearchParam() {
  if (typeof window === 'undefined') {
    return '';
  }

  const searchParams = new URLSearchParams(window.location.search);
  return searchParams.get(DATABASE_URL_PARAM) ?? '';
}

function writeDatabaseUrlSearchParam(value, { pushHistory = false } = {}) {
  if (typeof window === 'undefined') {
    return;
  }

  const currentUrl = new URL(window.location.href);
  if (value) {
    currentUrl.searchParams.set(DATABASE_URL_PARAM, value);
  } else {
    currentUrl.searchParams.delete(DATABASE_URL_PARAM);
  }

  if (currentUrl.toString() === window.location.href) {
    return;
  }

  if (pushHistory) {
    window.history.pushState({}, '', currentUrl);
  } else {
    window.history.replaceState({}, '', currentUrl);
  }
}

function normalizeComparableUrl(value) {
  try {
    return new URL(String(value).trim()).toString().toLowerCase();
  } catch {
    return '';
  }
}

function describeSourceContainer(source) {
  if (source?.containerType === 'zip') {
    return `ZIP archive -> ${source.extractedEntry}`;
  }

  if (source?.containerType === 'ini') {
    return 'plain INI';
  }

  return 'plain JSON';
}

function ModalFrame({ label, title, onClose, footer, children }) {
  return (
    <div
      className="modal-overlay"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section className="modal-panel" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-header">
          <div>
            <p className="section-label">{label}</p>
            <h2>{title}</h2>
          </div>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-footer">{footer}</div> : null}
      </section>
    </div>
  );
}

const FlatArchiveRow = memo(function FlatArchiveRow({
  row,
  collapsed,
  detailsVisible,
  onToggleCollapsed,
  onToggleDetails,
}) {
  const { archive, childIds } = row;
  return (
    <article
      className={row.depth ? 'tree-entry tree-entry-indented archive-card' : 'tree-entry archive-card'}
      style={buildTreeDepthStyle(row.depth)}
    >
      <div className="tree-row">
        <button
          type="button"
          className="collapse-button"
          onClick={() => onToggleCollapsed(row.id)}
        >
          {collapsed ? '+' : '-'}
        </button>
        <div className="tree-card archive-surface">
          <div className="tree-heading">
            <div className="tree-title-row">
              <span className="node-badge archive-badge">ZIP</span>
              <h3>{archive.title}</h3>
            </div>
            <div className="tree-heading-actions">
              <div className="node-action-row">
                <button
                  type="button"
                  className="inline-action-button"
                  onClick={() => onToggleDetails(row.id)}
                >
                  {detailsVisible ? 'Hide details' : 'Show details'}
                </button>
              </div>
              <code>{archive.id}</code>
            </div>
          </div>
          <PrimaryFieldRow fields={archive.primaryFields} />
          {detailsVisible ? <MetadataList fields={archive.details} /> : null}
          {archive.issues.length ? (
            <ul className="inline-issues">
              {archive.issues.map((issue) => (
                <li key={issue.id} className={`issue issue-${issue.level}`}>
                  <span className="issue-level">{issue.level}</span>
                  <span>{issue.message}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {!collapsed && !childIds.length ? (
            <div className="archive-empty-inline">
              <EmptyState message="No summary entries could be rendered for this archive." />
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
});

const FlatNodeRow = memo(function FlatNodeRow({
  row,
  collapsed,
  detailsVisible,
  onToggleCollapsed,
  onToggleDetails,
}) {
  const { node, canCollapse } = row;
  const bodyCollapsed = node.kind === 'file' && collapsed;

  return (
    <div
      className={row.depth ? 'tree-entry tree-entry-indented' : 'tree-entry'}
      style={buildTreeDepthStyle(row.depth)}
    >
      <div className="tree-row">
        {canCollapse ? (
          <button
            type="button"
            className="collapse-button"
            onClick={() => onToggleCollapsed(row.id)}
          >
            {collapsed ? '+' : '-'}
          </button>
        ) : (
          <span className="collapse-spacer" />
        )}
        <div className="tree-card">
          <div className="tree-heading">
            <div className="tree-title-row">
              <span className={`node-badge ${node.kind === 'file' ? 'file-badge' : 'folder-badge'}`}>
                {node.badge}
              </span>
              <h3>{node.name}</h3>
            </div>
            <div className="tree-heading-actions">
              <div className="node-action-row">
                <button
                  type="button"
                  className="inline-action-button"
                  onClick={() => onToggleDetails(row.id)}
                >
                  {detailsVisible ? 'Hide details' : 'Show details'}
                </button>
                {node.kind === 'file' && node.downloadUrl ? (
                  <a
                    className="download-button"
                    href={node.downloadUrl}
                    target="_blank"
                    rel="noreferrer"
                    download
                  >
                    Download
                  </a>
                ) : null}
              </div>
              <code>{node.path}</code>
            </div>
          </div>
          {!bodyCollapsed ? <PrimaryFieldRow fields={node.primaryFields} /> : null}
          {!bodyCollapsed && detailsVisible ? <MetadataList fields={node.details} /> : null}
        </div>
      </div>
    </div>
  );
});

function buildFlatNodeIndex(nodes) {
  const rowsById = new Map();
  const rootIds = [];
  const collapsibleIds = [];

  function visit(node, depth) {
    const childIds = [];
    const row = {
      id: node.id,
      type: 'node',
      node,
      depth,
      childIds,
      canCollapse: node.kind === 'file' || (Array.isArray(node.children) && node.children.length > 0),
    };

    rowsById.set(row.id, row);
    if (row.canCollapse) {
      collapsibleIds.push(row.id);
    }

    if (Array.isArray(node.children) && node.children.length) {
      for (const child of node.children) {
        childIds.push(visit(child, depth + 1));
      }
    }

    return row.id;
  }

  for (const node of nodes) {
    rootIds.push(visit(node, 0));
  }

  return {
    rootIds,
    rowsById,
    collapsibleIds,
  };
}

function buildFlatArchiveIndex(archiveViews) {
  const rowsById = new Map();
  const rootIds = [];
  const collapsibleIds = [];

  function visitNode(node, depth) {
    const childIds = [];
    const row = {
      id: node.id,
      type: 'node',
      node,
      depth,
      childIds,
      canCollapse: node.kind === 'file' || (Array.isArray(node.children) && node.children.length > 0),
    };

    rowsById.set(row.id, row);
    if (row.canCollapse) {
      collapsibleIds.push(row.id);
    }

    if (Array.isArray(node.children) && node.children.length) {
      for (const child of node.children) {
        childIds.push(visitNode(child, depth + 1));
      }
    }

    return row.id;
  }

  for (const archive of archiveViews) {
    const childIds = [];
    const row = {
      id: archive.nodeId,
      type: 'archive',
      archive,
      depth: 0,
      childIds,
      canCollapse: true,
    };

    rowsById.set(row.id, row);
    rootIds.push(row.id);
    collapsibleIds.push(row.id);

    for (const child of archive.tree.children) {
      childIds.push(visitNode(child, 1));
    }
  }

  return {
    rootIds,
    rowsById,
    collapsibleIds,
  };
}

function collectVisibleRows(rootIds, rowsById, collapsedIds) {
  const visibleRows = [];

  function visit(rowId) {
    const row = rowsById.get(rowId);
    if (!row) {
      return;
    }

    visibleRows.push(row);
    if (row.childIds.length && !collapsedIds.has(row.id)) {
      for (const childId of row.childIds) {
        visit(childId);
      }
    }
  }

  for (const rowId of rootIds) {
    visit(rowId);
  }

  return visibleRows;
}

function toggleSetMembership(currentSet, value) {
  const next = new Set(currentSet);
  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }

  return next;
}

function toggleDetailOverride(currentMap, rowId, defaultDetailed) {
  const currentVisible = currentMap.get(rowId) ?? defaultDetailed;
  const nextVisible = !currentVisible;
  const next = new Map(currentMap);

  if (nextVisible === defaultDetailed) {
    next.delete(rowId);
  } else {
    next.set(rowId, nextVisible);
  }

  return next;
}

function buildTreeDepthStyle(depth) {
  return { '--tree-depth': depth };
}

function HighlightCard({ label, value, subvalue, accent }) {
  return (
    <div className={`highlight-card ${accent}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {subvalue ? <small>{subvalue}</small> : null}
    </div>
  );
}

function TagDictionary({ tags }) {
  const [open, setOpen] = useState(true);

  return (
    <CollapsibleSection
      label="Tags"
      title="Tag dictionary"
      className="tag-dictionary"
      open={open}
      onToggle={setOpen}
      summaryAside={<span className="dictionary-count">{tags.length} entries</span>}
      actions={
        open ? (
          <button type="button" className="secondary-button" onClick={() => setOpen(false)}>
            Collapse
          </button>
        ) : null
      }
    >
      {tags.length ? (
        <div className="tag-cloud">
          {tags.map((tag) => (
            <span key={`${tag.name}:${tag.index}`} className="dictionary-pill">
              <strong>{tag.name}</strong>
              <span>{tag.index}</span>
            </span>
          ))}
        </div>
      ) : (
        <EmptyState message="No tag dictionary was provided." />
      )}
    </CollapsibleSection>
  );
}

function CollapsibleSection({
  label,
  title,
  defaultOpen = false,
  actions,
  children,
  className = '',
  open,
  onToggle,
  summaryAside = null,
}) {
  return (
    <details
      className={className ? `panel collapsible-panel ${className}` : 'panel collapsible-panel'}
      open={open ?? defaultOpen}
      onToggle={(event) => onToggle?.(event.currentTarget.open)}
    >
      <summary className="section-summary">
        <div>
          <p className="section-label">{label}</p>
          <h2>{title}</h2>
        </div>
        <div className="section-summary-side">
          {summaryAside}
          <span className="summary-indicator" />
        </div>
      </summary>
      <div className="collapsible-content">
        {actions ? <div className="collapsible-actions">{actions}</div> : null}
        {children}
      </div>
    </details>
  );
}

function MetadataCard({ title, fields }) {
  return (
    <article className="metadata-card">
      <h3>{title}</h3>
      <MetadataList fields={fields} />
    </article>
  );
}

function PrimaryFieldRow({ fields }) {
  if (!fields.length) {
    return null;
  }

  return (
    <div className="primary-row">
      {fields.map((field, index) => (
        <div key={`${field.label}:${index}`} className="primary-pill">
          <span>{field.label}</span>
          <FieldValue field={field} />
        </div>
      ))}
    </div>
  );
}

function MetadataList({ fields }) {
  if (!fields.length) {
    return null;
  }

  return (
    <dl className="metadata-list">
      {fields.map((field, index) => (
        <div key={`${field.label}:${index}`} className="metadata-item">
          <dt>{field.label}</dt>
          <dd>
            <FieldValue field={field} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function FieldValue({ field }) {
  const value = field.value;

  if (field.kind === 'tags' && Array.isArray(value)) {
    return (
      <div className="tag-chip-list">
        {value.map((tag) => (
          <TagChip key={tag.id} tag={tag} />
        ))}
      </div>
    );
  }

  if (Array.isArray(value)) {
    return (
      <div className="chip-list">
        {value.map((item, index) => (
          <span key={`${item}:${index}`} className="mini-chip">
            {item}
          </span>
        ))}
      </div>
    );
  }

  if (field.kind === 'url' && typeof value === 'string' && value.startsWith('http')) {
    return (
      <a href={value} target="_blank" rel="noreferrer">
        {value}
      </a>
    );
  }

  if (field.kind === 'code') {
    return <code>{value}</code>;
  }

  return <span>{value}</span>;
}

function TagChip({ tag }) {
  return (
    <span
      className="tag-chip"
      data-tooltip={tag.rawLabel ? `Raw tag: ${tag.rawLabel}` : undefined}
    >
      {tag.label}
    </span>
  );
}

function EmptyState({ message }) {
  return <p className="empty-state">{message}</p>;
}

function SectionControls({
  detailed,
  onDetailedChange,
  onExpandAll,
  onCollapseAll,
}) {
  return (
    <div className="section-controls">
      <DetailedToggle detailed={detailed} onDetailedChange={onDetailedChange} />
      <div className="button-row">
        <button type="button" onClick={onExpandAll}>
          Uncollapse all
        </button>
        <button type="button" className="secondary-button" onClick={onCollapseAll}>
          Collapse all
        </button>
      </div>
    </div>
  );
}

function DetailedToggle({ detailed, onDetailedChange }) {
  return (
    <div className="toggle-group" aria-label="Detailed toggle">
      <span className="toggle-label">Detailed</span>
      <button
        type="button"
        className={!detailed ? 'toggle-chip active' : 'toggle-chip'}
        onClick={() => onDetailedChange(false)}
      >
        Off
      </button>
      <button
        type="button"
        className={detailed ? 'toggle-chip active' : 'toggle-chip'}
        onClick={() => onDetailedChange(true)}
      >
        On
      </button>
    </div>
  );
}
