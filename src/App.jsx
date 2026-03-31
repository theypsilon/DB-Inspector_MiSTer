import {
  memo,
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { flushSync } from 'react-dom';
import {
  applyInspectionFilter,
  formatBytes,
  loadDatabaseSourceFile,
  loadDatabaseSourceUrl,
  loadRuntimeDatabaseCatalog,
  summarizeInspectionStorage,
} from './lib/database.js';

const DATABASE_URL_PARAM = 'database-url';
const FILTER_URL_PARAM = 'filter';
const FILTER_INPUT_DEBOUNCE_MS = 600;
const TREE_LIST_GAP_PX = 13;
const TREE_OVERSCAN_PX = 900;
const BACKGROUND_DOWNLOAD_FRAME_NAME = 'background-download-frame';
const DEFAULT_CLUSTER_SIZE_BYTES = 128 * 1024;
const CLUSTER_SIZE_OPTIONS = [
  4 * 1024,
  8 * 1024,
  16 * 1024,
  32 * 1024,
  64 * 1024,
  128 * 1024,
  256 * 1024,
  512 * 1024,
  1024 * 1024,
];

let backgroundDownloadFrame = null;

export default function App() {
  const fileInputRef = useRef(null);
  const autoLoadHandledRef = useRef(false);
  const inspectionRef = useRef(null);
  const iniSourceRef = useRef(null);
  const filterOverrideDecisionRef = useRef({ onAccept: null, onDecline: null });
  const uploadCatalogUrlsRef = useRef(new Set());
  const dropzoneDragDepthRef = useRef(0);
  const dropzoneDropPulseTimeoutRef = useRef(0);
  const filterSearchParamReadyRef = useRef(false);
  const expectedFilterSearchParamValueRef = useRef('');
  const pendingPreservedFilterRef = useRef(null);
  const [databaseUrl, setDatabaseUrl] = useState(() => readDatabaseUrlSearchParam());
  const [loadingMessage, setLoadingMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [inspection, setInspection] = useState(null);
  const [filterInput, setFilterInput] = useState('');
  const [debouncedFilterInput, setDebouncedFilterInput] = useState('');
  const [clusterSizeBytes, setClusterSizeBytes] = useState(DEFAULT_CLUSTER_SIZE_BYTES);
  const [iniSource, setIniSource] = useState(null);
  const [sourceDefaultFilter, setSourceDefaultFilter] = useState('');
  const [sourceDefaultFilterPresent, setSourceDefaultFilterPresent] = useState(false);
  const [sourceDefaultFilterOverridesDatabaseDefault, setSourceDefaultFilterOverridesDatabaseDefault] =
    useState(false);
  const [misterDefaultFilter, setMisterDefaultFilter] = useState('');
  const [misterDefaultFilterPresent, setMisterDefaultFilterPresent] = useState(false);
  const [databaseDetailed, setDatabaseDetailed] = useState(false);
  const [runtimeCatalogOptions, setRuntimeCatalogOptions] = useState([]);
  const [customCatalogOptions, setCustomCatalogOptions] = useState([]);
  const [catalogStatus, setCatalogStatus] = useState('loading');
  const [catalogError, setCatalogError] = useState('');
  const [catalogModalOpen, setCatalogModalOpen] = useState(false);
  const [iniPickerOpen, setIniPickerOpen] = useState(false);
  const [filterOverridePrompt, setFilterOverridePrompt] = useState(null);
  const [dropzoneActive, setDropzoneActive] = useState(false);
  const [dropzoneDropPulse, setDropzoneDropPulse] = useState(false);
  const catalogOptions = useMemo(
    () => mergeCatalogEntries(customCatalogOptions, runtimeCatalogOptions),
    [customCatalogOptions, runtimeCatalogOptions],
  );
  const catalogReady = catalogOptions.length > 0;
  const catalogDisplayStatus = catalogReady ? 'ready' : catalogStatus;
  const inspectionKeyBase = inspection
    ? `${inspection.source.sourceLabel}:${inspection.overview.dbId}:${inspection.overview.timestamp}`
    : 'empty';
  const displayedInspection = useMemo(
    () => (inspection ? applyInspectionFilter(inspection, debouncedFilterInput) : null),
    [inspection, debouncedFilterInput],
  );
  const storageSummary = useMemo(
    () =>
      displayedInspection
        ? summarizeInspectionStorage(displayedInspection, clusterSizeBytes)
        : null,
    [clusterSizeBytes, displayedInspection],
  );
  const effectiveDefaultFilter = useMemo(
    () =>
      resolveEffectiveDefaultFilter({
        sourceDefaultFilter,
        sourceDefaultFilterPresent,
        sourceDefaultFilterOverridesDatabaseDefault,
        misterDefaultFilter,
        misterDefaultFilterPresent,
        databaseDefaultFilter: inspection?.overview.defaultFilter || '',
      }),
    [
      inspection,
      misterDefaultFilter,
      misterDefaultFilterPresent,
      sourceDefaultFilter,
      sourceDefaultFilterOverridesDatabaseDefault,
      sourceDefaultFilterPresent,
    ],
  );
  const filterPending = filterInput !== debouncedFilterInput;
  const inspectionKey = `${inspectionKeyBase}:${String(debouncedFilterInput).trim().toLowerCase()}`;
  const canResetFilter =
    normalizeFilterPromptValue(filterInput) !== normalizeFilterPromptValue(effectiveDefaultFilter);

  useEffect(() => {
    inspectionRef.current = inspection;
  }, [inspection]);

  useEffect(() => {
    filterSearchParamReadyRef.current = false;

    const sharedFilter = readFilterSearchParam();
    const preservedFilter = pendingPreservedFilterRef.current;
    if (preservedFilter === null && !sharedFilter.isPresent && !inspection) {
      expectedFilterSearchParamValueRef.current = '';
      return;
    }

    pendingPreservedFilterRef.current = null;
    const nextFilter =
      preservedFilter !== null
        ? preservedFilter
        : sharedFilter.isPresent
          ? sharedFilter.value
          : effectiveDefaultFilter;
    expectedFilterSearchParamValueRef.current = nextFilter;
    setFilterInput(nextFilter);
    setDebouncedFilterInput(nextFilter);
  }, [effectiveDefaultFilter, inspectionKeyBase]);

  useEffect(() => {
    if (filterInput === debouncedFilterInput) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setDebouncedFilterInput(filterInput);
    }, FILTER_INPUT_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [debouncedFilterInput, filterInput]);

  useEffect(() => {
    if (!inspection) {
      filterSearchParamReadyRef.current = false;
      return;
    }

    if (debouncedFilterInput === expectedFilterSearchParamValueRef.current) {
      filterSearchParamReadyRef.current = true;
    }
  }, [inspection, inspectionKeyBase, debouncedFilterInput]);

  useEffect(() => {
    iniSourceRef.current = iniSource;
  }, [iniSource]);

  useEffect(() => {
    if (!inspection || !filterSearchParamReadyRef.current) {
      return;
    }

    if (inspection.source.sourceKind !== 'url') {
      writeFilterSearchParam('', { isPresent: false });
      return;
    }

    if (debouncedFilterInput === effectiveDefaultFilter) {
      writeFilterSearchParam('', { isPresent: false });
      return;
    }

    writeFilterSearchParam(debouncedFilterInput, { isPresent: true });
  }, [effectiveDefaultFilter, inspection, debouncedFilterInput]);

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
      const sharedFilter = readFilterSearchParam();
      setDatabaseUrl(sharedDatabaseUrl);
      setFilterInput(sharedFilter.isPresent ? sharedFilter.value : '');
      setDebouncedFilterInput(sharedFilter.isPresent ? sharedFilter.value : '');
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
    if (!catalogModalOpen && !iniPickerOpen && !filterOverridePrompt) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setCatalogModalOpen(false);
        setIniPickerOpen(false);
        handleFilterOverrideDecision(false);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [catalogModalOpen, iniPickerOpen, filterOverridePrompt]);

  useEffect(
    () => () => {
      if (dropzoneDropPulseTimeoutRef.current) {
        window.clearTimeout(dropzoneDropPulseTimeoutRef.current);
      }

      for (const url of uploadCatalogUrlsRef.current) {
        URL.revokeObjectURL(url);
      }

      uploadCatalogUrlsRef.current.clear();
    },
    [],
  );

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

        setRuntimeCatalogOptions(entries);
        setCatalogStatus('ready');
      } catch (error) {
        if (cancelled) {
          return;
        }

        setRuntimeCatalogOptions([]);
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
    setSourceDefaultFilter('');
    setSourceDefaultFilterPresent(false);
    setSourceDefaultFilterOverridesDatabaseDefault(false);
    setMisterDefaultFilter('');
    setMisterDefaultFilterPresent(false);
  }

  function queueCurrentFilterForPreservedLoad(preserveCurrentFilter) {
    const activeFilterInput = String(filterInput).trim() ? filterInput : null;
    pendingPreservedFilterRef.current =
      preserveCurrentFilter && activeFilterInput !== null ? activeFilterInput : null;
  }

  function handleFilterOverrideDecision(acceptOverride) {
    const { onAccept, onDecline } = filterOverrideDecisionRef.current;
    filterOverrideDecisionRef.current = {
      onAccept: null,
      onDecline: null,
    };
    setFilterOverridePrompt(null);

    if (acceptOverride) {
      onAccept?.();
      return;
    }

    onDecline?.();
  }

  function maybeConfirmFilterOverride({ nextFilter, nextFilterPresent, onAccept, onDecline }) {
    const currentFilter = String(filterInput);
    if (!String(currentFilter).trim() || !nextFilterPresent) {
      return false;
    }

    if (normalizeFilterPromptValue(currentFilter) === normalizeFilterPromptValue(nextFilter)) {
      return false;
    }

    filterOverrideDecisionRef.current = { onAccept, onDecline };
    setFilterOverridePrompt({
      currentFilter,
      nextFilter,
    });
    return true;
  }

  function startRemoteDatabaseLoad(
    url,
    {
      registerInCatalog = false,
      sourceDefaultFilter = '',
      sourceDefaultFilterPresent = false,
      sourceDefaultFilterOverridesDatabaseDefault = false,
      misterDefaultFilter = '',
      misterDefaultFilterPresent = false,
      preserveCurrentFilter = false,
    } = {},
  ) {
    const requestedUrl = String(url).trim();
    if (!requestedUrl) {
      return;
    }

    queueCurrentFilterForPreservedLoad(preserveCurrentFilter);

    setDatabaseUrl(requestedUrl);
    setLoadingMessage(`Fetching ${requestedUrl}...`);
    setErrorMessage('');
    clearLoadedSource();

    window.setTimeout(() => {
      void loadRemoteSource(requestedUrl, {
        skipPrepare: true,
        registerInCatalog,
        sourceDefaultFilter,
        sourceDefaultFilterPresent,
        sourceDefaultFilterOverridesDatabaseDefault,
        misterDefaultFilter,
        misterDefaultFilterPresent,
        preserveCurrentFilter,
      });
    }, 0);
  }

  async function handleLoadedSource(
    loadedSource,
    {
      origin,
      requestedUrl = '',
      syncSearchParam = true,
      visitedUrls = new Set(),
      registerInCatalog = true,
      sourceDefaultFilter: nextSourceDefaultFilter = '',
      sourceDefaultFilterPresent: nextSourceDefaultFilterPresent = false,
      sourceDefaultFilterOverridesDatabaseDefault:
        nextSourceDefaultFilterOverridesDatabaseDefault = false,
      misterDefaultFilter: nextMisterDefaultFilter = '',
      misterDefaultFilterPresent: nextMisterDefaultFilterPresent = false,
      preserveCurrentFilter = false,
    } = {},
  ) {
    if (registerInCatalog) {
      setCustomCatalogOptions((current) =>
        mergeCustomCatalogEntries(
          createCatalogEntriesFromLoadedSource(loadedSource, mergeCatalogEntries(current, runtimeCatalogOptions)),
          current,
        ),
      );
    }

    if (loadedSource.kind === 'database') {
      setSourceDefaultFilter(nextSourceDefaultFilter);
      setSourceDefaultFilterPresent(nextSourceDefaultFilterPresent);
      setSourceDefaultFilterOverridesDatabaseDefault(
        nextSourceDefaultFilterOverridesDatabaseDefault,
      );
      setMisterDefaultFilter(nextMisterDefaultFilter);
      setMisterDefaultFilterPresent(nextMisterDefaultFilterPresent);
      setInspection(loadedSource.inspection);
      setIniSource(null);
      setIniPickerOpen(false);
      setCatalogModalOpen(false);

      if (origin === 'upload') {
        setDatabaseUrl('');
        writeDatabaseUrlSearchParam('', {
          pushHistory: true,
          preserveFilter: preserveCurrentFilter,
        });
      } else {
        const sharedUrl = loadedSource.inspection.source.sourceLabel;
        setDatabaseUrl(sharedUrl);
        if (syncSearchParam) {
          writeDatabaseUrlSearchParam(sharedUrl, {
            pushHistory: true,
            preserveFilter: preserveCurrentFilter,
          });
        }
      }

      return;
    }

    if (loadedSource.entries.length === 1) {
      const [entry] = loadedSource.entries;
      const shouldPreserveCurrentFilter =
        preserveCurrentFilter && !entry.defaultFilterPresent;
      const loadSelectedEntry = (preserveSelectedFilter) => {
        queueCurrentFilterForPreservedLoad(preserveSelectedFilter);
        void loadRemoteSource(entry.dbUrl, {
          syncSearchParam: origin === 'url' ? syncSearchParam : true,
          visitedUrls,
          registerInCatalog: false,
          sourceDefaultFilter: entry.defaultFilter || '',
          sourceDefaultFilterPresent: entry.defaultFilterPresent,
          sourceDefaultFilterOverridesDatabaseDefault: entry.defaultFilterPresent,
          misterDefaultFilter: loadedSource.defaultFilter || '',
          misterDefaultFilterPresent: loadedSource.defaultFilterPresent,
          preserveCurrentFilter: preserveSelectedFilter,
        });
      };

      if (
        maybeConfirmFilterOverride({
          nextFilter: entry.defaultFilter || '',
          nextFilterPresent: entry.defaultFilterPresent,
          onAccept: () => loadSelectedEntry(false),
          onDecline: () => loadSelectedEntry(true),
        })
      ) {
        return;
      }

      setIniSource(null);
      setIniPickerOpen(false);
      setDatabaseUrl(entry.dbUrl);
      queueCurrentFilterForPreservedLoad(shouldPreserveCurrentFilter);
      await loadRemoteSource(entry.dbUrl, {
        syncSearchParam: origin === 'url' ? syncSearchParam : true,
        visitedUrls,
        registerInCatalog: false,
        sourceDefaultFilter: entry.defaultFilter || '',
        sourceDefaultFilterPresent: entry.defaultFilterPresent,
        sourceDefaultFilterOverridesDatabaseDefault: entry.defaultFilterPresent,
        misterDefaultFilter: loadedSource.defaultFilter || '',
        misterDefaultFilterPresent: loadedSource.defaultFilterPresent,
        preserveCurrentFilter: shouldPreserveCurrentFilter,
      });
      return;
    }

    setInspection(null);
    setSourceDefaultFilter('');
    setSourceDefaultFilterPresent(false);
    setSourceDefaultFilterOverridesDatabaseDefault(false);
    setMisterDefaultFilter(loadedSource.defaultFilter || '');
    setMisterDefaultFilterPresent(loadedSource.defaultFilterPresent);
    setIniSource(loadedSource);

    if (origin === 'upload') {
      setDatabaseUrl('');
      writeDatabaseUrlSearchParam('', {
        pushHistory: true,
        preserveFilter: preserveCurrentFilter,
      });
      return;
    }

    setDatabaseUrl(requestedUrl);
    if (syncSearchParam) {
      writeDatabaseUrlSearchParam(requestedUrl, {
        pushHistory: true,
        preserveFilter: preserveCurrentFilter,
      });
    }
  }

  async function loadFile(file) {
    if (!file) {
      return;
    }

    queueCurrentFilterForPreservedLoad(true);
    setLoadingMessage(`Loading ${file.name}...`);
    setErrorMessage('');
    clearLoadedSource();

    try {
      const loadedSource = await loadDatabaseSourceFile(file);
      if (loadedSource.kind === 'database') {
        const objectUrl = URL.createObjectURL(file);
        uploadCatalogUrlsRef.current.add(objectUrl);
        loadedSource.inspection.source.sourceUrl = objectUrl;
      }

      await handleLoadedSource(loadedSource, {
        origin: 'upload',
        registerInCatalog: true,
        preserveCurrentFilter: true,
      });
    } catch (error) {
      setIniPickerOpen(false);
      setErrorMessage(error.message);
    } finally {
      setLoadingMessage('');
    }
  }

  async function loadRemoteSource(
    input,
    {
      syncSearchParam = true,
      visitedUrls = new Set(),
      skipPrepare = false,
      registerInCatalog = true,
      sourceDefaultFilter = '',
      sourceDefaultFilterPresent = false,
      sourceDefaultFilterOverridesDatabaseDefault = false,
      misterDefaultFilter = '',
      misterDefaultFilterPresent = false,
      preserveCurrentFilter = false,
    } = {},
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
      setErrorMessage(`Detected a loop while following linked databases from ${requestedUrl}.`);
      return;
    }

    if (!skipPrepare) {
      setLoadingMessage(`Fetching ${requestedUrl}...`);
      setErrorMessage('');
      clearLoadedSource();
    }

    try {
      const loadedSource = await loadDatabaseSourceUrl(requestedUrl);
      const nextVisitedUrls = new Set(visitedUrls);
      if (normalizedRequestedUrl) {
        nextVisitedUrls.add(normalizedRequestedUrl);
      }

      const normalizedLoadedUrl = normalizeComparableUrl(getLoadedSourceUrl(loadedSource));
      if (normalizedLoadedUrl) {
        nextVisitedUrls.add(normalizedLoadedUrl);
      }

      await handleLoadedSource(loadedSource, {
        origin: 'url',
        requestedUrl,
        syncSearchParam,
        visitedUrls: nextVisitedUrls,
        registerInCatalog,
        sourceDefaultFilter,
        sourceDefaultFilterPresent,
        sourceDefaultFilterOverridesDatabaseDefault,
        misterDefaultFilter,
        misterDefaultFilterPresent,
        preserveCurrentFilter,
      });
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setLoadingMessage('');
    }
  }

  async function loadUrl(event) {
    event.preventDefault();
    queueCurrentFilterForPreservedLoad(true);
    await loadRemoteSource(databaseUrl, { preserveCurrentFilter: true });
  }

  function loadIniEntry(entry) {
    if (!entry?.dbUrl) {
      return;
    }

    if (
      maybeConfirmFilterOverride({
        nextFilter: entry.defaultFilter || '',
        nextFilterPresent: entry.defaultFilterPresent,
        onAccept: () =>
          startRemoteDatabaseLoad(entry.dbUrl, {
            registerInCatalog: false,
            sourceDefaultFilter: entry.defaultFilter || '',
            sourceDefaultFilterPresent: entry.defaultFilterPresent,
            sourceDefaultFilterOverridesDatabaseDefault: entry.defaultFilterPresent,
            misterDefaultFilter: iniSource?.defaultFilter || '',
            misterDefaultFilterPresent: iniSource?.defaultFilterPresent,
            preserveCurrentFilter: false,
          }),
        onDecline: () =>
          startRemoteDatabaseLoad(entry.dbUrl, {
            registerInCatalog: false,
            sourceDefaultFilter: entry.defaultFilter || '',
            sourceDefaultFilterPresent: entry.defaultFilterPresent,
            sourceDefaultFilterOverridesDatabaseDefault: entry.defaultFilterPresent,
            misterDefaultFilter: iniSource?.defaultFilter || '',
            misterDefaultFilterPresent: iniSource?.defaultFilterPresent,
            preserveCurrentFilter: true,
          }),
      })
    ) {
      return;
    }

    startRemoteDatabaseLoad(entry.dbUrl, {
      registerInCatalog: false,
      sourceDefaultFilter: entry.defaultFilter || '',
      sourceDefaultFilterPresent: entry.defaultFilterPresent,
      sourceDefaultFilterOverridesDatabaseDefault: entry.defaultFilterPresent,
      misterDefaultFilter: iniSource?.defaultFilter || '',
      misterDefaultFilterPresent: iniSource?.defaultFilterPresent,
      preserveCurrentFilter: !entry.defaultFilterPresent,
    });
  }

  function triggerDropzoneDropPulse() {
    setDropzoneDropPulse(false);

    window.requestAnimationFrame(() => {
      setDropzoneDropPulse(true);
    });

    if (dropzoneDropPulseTimeoutRef.current) {
      window.clearTimeout(dropzoneDropPulseTimeoutRef.current);
    }

    dropzoneDropPulseTimeoutRef.current = window.setTimeout(() => {
      setDropzoneDropPulse(false);
      dropzoneDropPulseTimeoutRef.current = 0;
    }, 560);
  }

  function handleDropzoneDragEnter(event) {
    if (!isFileDragEvent(event)) {
      return;
    }

    event.preventDefault();
    dropzoneDragDepthRef.current += 1;
    setDropzoneActive(true);
  }

  function handleDropzoneDragOver(event) {
    if (!isFileDragEvent(event)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';

    if (!dropzoneActive) {
      setDropzoneActive(true);
    }
  }

  function handleDropzoneDragLeave(event) {
    if (!isFileDragEvent(event)) {
      return;
    }

    event.preventDefault();
    dropzoneDragDepthRef.current = Math.max(0, dropzoneDragDepthRef.current - 1);

    if (dropzoneDragDepthRef.current === 0) {
      setDropzoneActive(false);
    }
  }

  function handleDrop(event) {
    event.preventDefault();
    dropzoneDragDepthRef.current = 0;
    setDropzoneActive(false);

    if (isFileDragEvent(event)) {
      triggerDropzoneDropPulse();
    }

    const file = event.dataTransfer.files?.[0];
    void loadFile(file);
  }

  return (
    <main className="app-shell">
      <section className="hero panel">
        <div>
          <p className="eyebrow">Downloader Databases</p>
          <h1>Custom Database Inspector</h1>
          <p className="hero-copy">
            Open a Downloader database from your computer or from a web link. Review its details,
            browse folders and files, filter its content, inspect archives, and spot warnings in
            one place.
          </p>
        </div>
        <div className="hero-note">
          <strong>About MiSTer Downloader</strong>
          <p>
            MiSTer Downloader is the updater used on{' '}
            <a
              href="https://github.com/MiSTer-devel/Main_MiSTer/wiki"
              target="_blank"
              rel="noreferrer"
            >
              MiSTer FPGA
            </a>{' '}
            to install and refresh cores, content, and support files from database definitions.
            This inspector helps you review those custom database files in the browser before using
            them.
          </p>
          <a
            href="https://github.com/MiSTer-devel/Downloader_MiSTer/blob/main/docs/custom-databases.md"
            target="_blank"
            rel="noreferrer"
          >
            Read the custom database spec
          </a>
        </div>
      </section>

      <section className="loader-grid">
        <section
          className={[
            'panel',
            'dropzone',
            'source-card',
            dropzoneActive ? 'dropzone-active' : '',
            dropzoneDropPulse ? 'dropzone-drop-feedback' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          onDragEnter={handleDropzoneDragEnter}
          onDragOver={handleDropzoneDragOver}
          onDragLeave={handleDropzoneDragLeave}
          onDrop={handleDrop}
        >
          <p className="section-label">Upload</p>
          <h2>Drag a database here</h2>
          <p>
            Supported files: <code>.json</code>, <code>.json.zip</code>, <code>.ini</code>,
            <code>.ini.zip</code>, and ZIP files that contain one of those formats.
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
              onClick={() => setCatalogModalOpen(true)}
              disabled={!catalogReady}
            >
              Browse catalog
            </button>
          </div>
          <p className="catalog-count-inline">
            {catalogReady
              ? `${catalogOptions.length} entries available`
              : 'Catalog unavailable'}
          </p>
          {catalogDisplayStatus === 'loading' ? (
            <p className="helper-copy">Loading catalog entries.</p>
          ) : null}
          {catalogDisplayStatus === 'error' ? <p className="status error">{catalogError}</p> : null}
          <EmptyState message="Choose a database in the catalog modal to open it." />
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
            <p className="section-label">Database List</p>
            <h2>Choose a database</h2>
            <p className="helper-copy">
              {iniSource.source.sourceLabel} contains {iniSource.entries.length}{' '}
              {iniSource.entries.length === 1 ? 'entry' : 'entries'}. Choose the one you want to
              open.
            </p>
            <div className="button-row">
              <button type="button" onClick={() => setIniPickerOpen(true)}>
                Browse entries
              </button>
            </div>
            <EmptyState message="Choose a database in the list modal to open it." />
          </section>
        ) : null}

        {displayedInspection ? (
          <>
            <section className="panel overview-panel">
              <div className="overview-header">
                <div>
                  <p className="section-label">Database</p>
                  <h2>{displayedInspection.overview.dbId}</h2>
                </div>
                <div className="overview-side">
                  <div className="highlight-row">
                    <HighlightCard
                      label="Version"
                      value={`v${displayedInspection.overview.version}`}
                      accent="version"
                    />
                    <HighlightCard
                      label="Timestamp"
                      value={displayedInspection.overview.timestampLabel}
                      subvalue={`Epoch ${displayedInspection.overview.timestamp}`}
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
                    { label: 'Loaded from', value: displayedInspection.source.sourceLabel, kind: 'url' },
                    {
                      label: 'Container',
                      value:
                        displayedInspection.source.containerType === 'zip'
                          ? `ZIP file (${displayedInspection.source.extractedEntry})`
                          : 'JSON file',
                    },
                  ]}
                />
                <MetadataCard
                  title="Counts"
                  fields={[
                    { label: 'Files', value: displayedInspection.overview.counts.files.toLocaleString() },
                    { label: 'Folders', value: displayedInspection.overview.counts.folders.toLocaleString() },
                    {
                      label: 'Archives',
                      value: displayedInspection.overview.counts.archives.toLocaleString(),
                    },
                  ]}
                />
                {databaseDetailed ? (
                  <MetadataCard
                    title="Options"
                    fields={[
                      {
                        label: 'base_files_url',
                        value: displayedInspection.overview.baseFilesUrl || 'None',
                        kind: 'url',
                      },
                      {
                        label: 'Default filter',
                        value: displayedInspection.overview.defaultFilter || 'None',
                      },
                      {
                        label: 'Imported db_files',
                        value: displayedInspection.overview.importedDatabases.length
                          ? displayedInspection.overview.importedDatabases
                          : ['None'],
                      },
                    ]}
                  />
                ) : null}
              </div>
            </section>

            <CollapsibleSection
              label="FILTER"
              title="Enter terms to filter by"
              defaultOpen
              className="filter-panel"
            >
              <div className="filter-toolbar">
                <div className="catalog-search">
                  <textarea
                    id="inspection-filter"
                    className="filter-input"
                    aria-label="FILTER"
                    placeholder="console !cheats"
                    value={filterInput}
                    onChange={(event) => setFilterInput(event.target.value)}
                    rows={1}
                    wrap="off"
                    spellCheck={false}
                  />
                </div>
                {canResetFilter ? (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setFilterInput(effectiveDefaultFilter)}
                  >
                    Clear
                  </button>
                ) : null}
              </div>
              <p className="helper-copy">
                Filter Downloader databases with terms like <code>console</code>, <code>arcade</code>,
                or <code>!cheats</code>. Positive terms keep matching tagged items, negative terms
                remove them, untagged items remain visible, and <code>essential</code> stays
                included unless you exclude it.{' '}
                <a
                  href="https://github.com/MiSTer-devel/Downloader_MiSTer/blob/main/docs/download-filters.md"
                  target="_blank"
                  rel="noreferrer"
                >
                  Read the official guide
                </a>
                .
              </p>
              {displayedInspection.overview.defaultFilter ? (
                <p className="helper-copy">
                  Database default: <code>{displayedInspection.overview.defaultFilter}</code>.
                </p>
              ) : null}
              <p className="catalog-count-inline disk-usage-inline">
                {filterPending ? (
                  'Updating preview...'
                ) : (
                  <>
                    <span>{buildFilterSummaryCopy(displayedInspection.activeFilter)}</span>
                    {storageSummary ? (
                      <>
                        <span>Size:</span>
                        <span
                          className="disk-usage-value"
                          title={buildRawByteHoverCopy(storageSummary)}
                        >
                          {formatBytes(storageSummary.clusteredBytes)}
                        </span>
                        <span>at</span>
                        <select
                          aria-label="Cluster size"
                          className="cluster-size-select"
                          value={clusterSizeBytes}
                          onChange={(event) => setClusterSizeBytes(Number(event.target.value))}
                        >
                          {CLUSTER_SIZE_OPTIONS.map((option) => (
                            <option key={option} value={option}>
                              {formatBytes(option)}
                            </option>
                          ))}
                        </select>
                        <span>clusters.</span>
                      </>
                    ) : null}
                  </>
                )}
              </p>
            </CollapsibleSection>

            <FilesystemSection
              key={`filesystem:${inspectionKey}`}
              tree={displayedInspection.filesystemTree}
              emptyMessage={
                displayedInspection.activeFilter.isFiltering
                  ? 'No files or folders match the current filter.'
                  : 'No top-level files or folders were found.'
              }
            />

            {displayedInspection.archiveViews.length ? (
              <ArchiveSummariesSection
                key={`archives:${inspectionKey}`}
                archiveViews={displayedInspection.archiveViews}
                emptyMessage={
                  displayedInspection.activeFilter.isFiltering
                    ? 'No archive summary entries match the current filter.'
                    : 'This database does not define any archives.'
                }
              />
            ) : null}

            <CollapsibleSection
              label="Diagnostics"
              title="Issues and warnings"
              defaultOpen
            >
              {displayedInspection.issues.length ? (
                <ul className="issue-list">
                  {displayedInspection.issues.map((issue) => (
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

            {displayedInspection.overview.tagDictionary.length ? (
              <TagDictionary tags={displayedInspection.overview.tagDictionary} />
            ) : null}
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
              Upload a local database file or open one from the web to inspect its details, files,
              folders, archives, and warnings.
            </p>
          </section>
        ) : null}
      </div>

      {catalogModalOpen ? (
        <CatalogPickerModal
          options={catalogOptions}
          status={catalogDisplayStatus}
          error={catalogError}
          initialDatabaseUrl={databaseUrl}
          onClose={() => setCatalogModalOpen(false)}
          onOpenDatabase={(url) => {
            startRemoteDatabaseLoad(url, {
              registerInCatalog: false,
              preserveCurrentFilter: true,
            });
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

      {filterOverridePrompt ? (
        <FilterOverrideModal
          currentFilter={filterOverridePrompt.currentFilter}
          nextFilter={filterOverridePrompt.nextFilter}
          onAccept={() => handleFilterOverrideDecision(true)}
          onDecline={() => handleFilterOverrideDecision(false)}
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
      label="Catalog"
      title="Browse database catalog"
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
                flushSync(() => {
                  onClose();
                });
                runAfterNextPaint(() => {
                  onOpenDatabase(selectedOption.dbUrl);
                });
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
            Search catalog
          </label>
          <input
            id="catalog-modal-search"
            type="search"
            placeholder="Search by ID, title, or URL"
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
              <span className="catalog-meta-label">Database ID</span>
              <code>{selectedOption.dbId}</code>
            </div>
            <div>
              <span className="catalog-meta-label">Title</span>
              <strong>{selectedOption.title}</strong>
            </div>
            <div className="catalog-selected-url">
              <span className="catalog-meta-label">URL</span>
              <a href={selectedOption.dbUrl} target="_blank" rel="noreferrer">
                {selectedOption.dbUrl}
              </a>
            </div>
          </div>
        </article>
      ) : null}
      {status === 'loading' ? (
        <p className="helper-copy">Loading catalog entries.</p>
      ) : null}
      {status === 'error' ? <p className="status error">{error}</p> : null}
      {status === 'ready' ? (
        filteredOptions.length ? (
          <div className="catalog-list modal-list" role="listbox" aria-label="Catalog results">
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
      label="List"
      title="Choose a database from this list"
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
                flushSync(() => {
                  onClose();
                });
                runAfterNextPaint(() => {
                  onOpenDatabase(selectedEntry);
                });
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
            Search list
          </label>
          <input
            id="ini-modal-search"
            type="search"
            placeholder="Search by ID or URL"
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
              <span className="catalog-meta-label">Database ID</span>
              <code>{selectedEntry.dbId}</code>
            </div>
            <div className="catalog-selected-url">
              <span className="catalog-meta-label">URL</span>
              <a href={selectedEntry.dbUrl} target="_blank" rel="noreferrer">
                {selectedEntry.dbUrl}
              </a>
            </div>
          </div>
        </article>
      ) : null}
      {filteredEntries.length ? (
        <div className="catalog-list modal-list" role="listbox" aria-label="Database list entries">
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
                <strong>Database</strong>
              </div>
              <span className="catalog-option-url">{entry.dbUrl}</span>
            </button>
          ))}
        </div>
      ) : (
        <EmptyState message="No entries match the current search." />
      )}
    </ModalFrame>
  );
});

const FilterOverrideModal = memo(function FilterOverrideModal({
  currentFilter,
  nextFilter,
  onAccept,
  onDecline,
}) {
  return (
    <ModalFrame
      label="FILTER"
      title="Replace the current filter?"
      onClose={onDecline}
      footer={
        <>
          <button type="button" className="secondary-button" onClick={onDecline}>
            Keep current
          </button>
          <button type="button" onClick={onAccept}>
            Replace filter
          </button>
        </>
      }
    >
      <p className="helper-copy">
        This database provides its own filter. Choose whether to keep the current filter or replace
        it with the incoming one.
      </p>
      <div className="filter-override-grid">
        <div>
          <span className="catalog-meta-label">Current FILTER</span>
          <code>{formatFilterPromptValue(currentFilter)}</code>
        </div>
        <div>
          <span className="catalog-meta-label">Incoming FILTER</span>
          <code>{formatFilterPromptValue(nextFilter)}</code>
        </div>
      </div>
    </ModalFrame>
  );
});

const FilesystemSection = memo(function FilesystemSection({ tree, emptyMessage }) {
  const index = useMemo(() => buildFlatNodeIndex(tree.children), [tree]);

  return (
    <TreeSection
      label="Content"
      title="Files and folders"
      listClassName="tree-root"
      emptyMessage={emptyMessage}
      index={index}
    />
  );
});

const ArchiveSummariesSection = memo(function ArchiveSummariesSection({ archiveViews, emptyMessage }) {
  const index = useMemo(() => buildFlatArchiveIndex(archiveViews), [archiveViews]);

  return (
    <TreeSection
      label="Content"
      title="Archives"
      listClassName="archive-list"
      emptyMessage={emptyMessage}
      index={index}
    />
  );
});

const TreeSection = memo(function TreeSection({
  label,
  title,
  listClassName,
  emptyMessage,
  index,
}) {
  const containerRef = useRef(null);
  const [detailed, setDetailed] = useState(false);
  const [collapsedIds, setCollapsedIds] = useState(() => new Set());
  const [detailOverrides, setDetailOverrides] = useState(() => new Map());
  const [measuredHeights, setMeasuredHeights] = useState(() => new Map());
  const visibleRowIds = useMemo(
    () => collectVisibleRowIds(index.rootIds, index.rowsById, collapsedIds),
    [index, collapsedIds],
  );
  const viewport = useWindowViewport();
  const containerTop = containerRef.current
    ? containerRef.current.getBoundingClientRect().top + viewport.scrollY
    : 0;
  const virtualRows = useMemo(
    () =>
      buildVirtualRows({
        rowIds: visibleRowIds,
        rowsById: index.rowsById,
        collapsedIds,
        detailOverrides,
        defaultDetailed: detailed,
        measuredHeights,
        containerTop,
        viewport,
      }),
    [visibleRowIds, index, collapsedIds, detailOverrides, detailed, measuredHeights, containerTop, viewport],
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

  const handleRowHeightChange = useCallback((rowId, height) => {
    setMeasuredHeights((current) => {
      const previous = current.get(rowId);
      if (previous === height) {
        return current;
      }

      const next = new Map(current);
      next.set(rowId, height);
      return next;
    });
  }, []);

  useEffect(() => {
    setMeasuredHeights(new Map());
  }, [index]);

  return (
    <CollapsibleSection
      label={label}
      title={title}
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
      {visibleRowIds.length ? (
        <div className={listClassName} ref={containerRef} style={{ height: `${virtualRows.totalHeight}px` }}>
          {virtualRows.items.map(({ rowId, top, trimTopGuide, trimBottomGuide }) => {
            const row = index.rowsById.get(rowId);
            if (!row) {
              return null;
            }

            return (
              <TreeEntryRow
                key={row.id}
                row={row}
                collapsed={collapsedIds.has(row.id)}
                detailsVisible={detailOverrides.get(row.id) ?? detailed}
                onToggleCollapsed={handleToggleCollapsed}
                onToggleDetails={handleToggleDetails}
                onHeightChange={handleRowHeightChange}
                virtualStyle={buildVirtualRowStyle(top, {
                  trimTopGuide,
                  trimBottomGuide,
                })}
              />
            );
          })}
        </div>
      ) : (
        <EmptyState message={emptyMessage} />
      )}
    </CollapsibleSection>
  );
});

const OPENABLE_TEXT_FILE_EXTENSIONS = new Set(['txt', 'ini', 'md']);
const OPENABLE_IMAGE_FILE_EXTENSIONS = new Set([
  'apng',
  'avif',
  'bmp',
  'gif',
  'ico',
  'jpeg',
  'jpg',
  'png',
  'svg',
  'webp',
]);

function isBrowserOpenableFile(path) {
  const normalizedPath = String(path).trim().toLowerCase();
  const extension = normalizedPath.split('.').pop();
  if (!extension || extension === normalizedPath) {
    return false;
  }

  return (
    OPENABLE_TEXT_FILE_EXTENSIONS.has(extension) ||
    extension === 'pdf' ||
    OPENABLE_IMAGE_FILE_EXTENSIONS.has(extension)
  );
}

function resolveDownloadFileName(fileName, url) {
  const normalizedName = String(fileName || '').trim();
  if (normalizedName) {
    return normalizedName;
  }

  try {
    const parsedUrl = new URL(String(url).trim());
    const leaf = parsedUrl.pathname.split('/').pop();
    return leaf || 'download';
  } catch {
    return 'download';
  }
}

function ensureBackgroundDownloadFrame() {
  if (typeof document === 'undefined') {
    return null;
  }

  if (backgroundDownloadFrame?.isConnected) {
    return backgroundDownloadFrame;
  }

  const existingFrame = document.querySelector(
    `iframe[data-download-target="${BACKGROUND_DOWNLOAD_FRAME_NAME}"]`,
  );
  if (existingFrame instanceof HTMLIFrameElement) {
    backgroundDownloadFrame = existingFrame;
    return backgroundDownloadFrame;
  }

  const iframe = document.createElement('iframe');
  iframe.name = BACKGROUND_DOWNLOAD_FRAME_NAME;
  iframe.dataset.downloadTarget = BACKGROUND_DOWNLOAD_FRAME_NAME;
  iframe.tabIndex = -1;
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.display = 'none';
  document.body.append(iframe);
  backgroundDownloadFrame = iframe;
  return backgroundDownloadFrame;
}

function triggerBrowserDownload(href, fileName, target = '') {
  if (typeof document === 'undefined') {
    return;
  }

  const link = document.createElement('a');
  link.href = href;
  link.download = resolveDownloadFileName(fileName, href);
  link.rel = 'noreferrer';
  if (target) {
    link.target = target;
  }
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
}

async function triggerFileDownload(url, fileName) {
  if (!url || typeof window === 'undefined') {
    return;
  }

  try {
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok) {
      throw new Error(`Could not download ${url}.`);
    }

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    triggerBrowserDownload(objectUrl, fileName);
    window.setTimeout(() => {
      URL.revokeObjectURL(objectUrl);
    }, 60_000);
  } catch {
    const fallbackFrame = ensureBackgroundDownloadFrame();
    triggerBrowserDownload(url, fileName, fallbackFrame?.name || '');
  }
}

function normalizeFilterPromptValue(value) {
  return String(value).trim().replace(/\s+/g, ' ');
}

function formatFilterPromptValue(value) {
  const normalizedValue = normalizeFilterPromptValue(value);
  return normalizedValue || 'Empty filter';
}

function resolveEffectiveDefaultFilter({
  sourceDefaultFilter,
  sourceDefaultFilterPresent,
  sourceDefaultFilterOverridesDatabaseDefault,
  misterDefaultFilter,
  misterDefaultFilterPresent,
  databaseDefaultFilter,
}) {
  if (sourceDefaultFilterPresent && sourceDefaultFilterOverridesDatabaseDefault) {
    return sourceDefaultFilter;
  }

  const hasDatabaseDefaultFilter = Boolean(String(databaseDefaultFilter).trim());
  if (hasDatabaseDefaultFilter) {
    return resolveInheritedFilterValue(
      databaseDefaultFilter,
      misterDefaultFilterPresent ? misterDefaultFilter : '',
    );
  }

  if (misterDefaultFilterPresent) {
    return misterDefaultFilter;
  }

  if (sourceDefaultFilterPresent) {
    return sourceDefaultFilter;
  }

  return '';
}

function resolveInheritedFilterValue(filterValue, inheritedFilterValue) {
  return String(filterValue || '')
    .replaceAll(/\[\s*mister\s*\]/gi, inheritedFilterValue)
    .trim();
}

function readDatabaseUrlSearchParam() {
  if (typeof window === 'undefined') {
    return '';
  }

  const searchParams = new URLSearchParams(window.location.search);
  return searchParams.get(DATABASE_URL_PARAM) ?? '';
}

function readFilterSearchParam() {
  if (typeof window === 'undefined') {
    return { isPresent: false, value: '' };
  }

  const searchParams = new URLSearchParams(window.location.search);
  return {
    isPresent: searchParams.has(FILTER_URL_PARAM),
    value: searchParams.get(FILTER_URL_PARAM) ?? '',
  };
}

function writeDatabaseUrlSearchParam(value, { pushHistory = false, preserveFilter = true } = {}) {
  if (typeof window === 'undefined') {
    return;
  }

  const currentUrl = new URL(window.location.href);
  if (value) {
    currentUrl.searchParams.set(DATABASE_URL_PARAM, value);
  } else {
    currentUrl.searchParams.delete(DATABASE_URL_PARAM);
  }

  if (!preserveFilter) {
    currentUrl.searchParams.delete(FILTER_URL_PARAM);
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

function writeFilterSearchParam(value, { pushHistory = false, isPresent = true } = {}) {
  if (typeof window === 'undefined') {
    return;
  }

  const currentUrl = new URL(window.location.href);
  if (isPresent) {
    currentUrl.searchParams.set(FILTER_URL_PARAM, value);
  } else {
    currentUrl.searchParams.delete(FILTER_URL_PARAM);
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

function buildFilterSummaryCopy(activeFilter) {
  if (!activeFilter) {
    return 'Showing the full database.';
  }

  if (activeFilter.hasError) {
    return 'The current filter is invalid, so the full database is shown.';
  }

  const { files, folders, archives } = activeFilter.resultCounts;
  if (!activeFilter.isFiltering) {
    return `Showing the full database: ${files} files, ${folders} folders, ${archives} archives.`;
  }

  return `Showing ${files} files, ${folders} folders, and ${archives} archives for this filter.`;
}

function buildRawByteHoverCopy(storageSummary) {
  if (!storageSummary) {
    return '';
  }

  const suffix = storageSummary.unsizedFileCount
    ? ` ${storageSummary.unsizedFileCount.toLocaleString()} file${
        storageSummary.unsizedFileCount === 1 ? ' has' : 's have'
      } no declared size and ${storageSummary.unsizedFileCount === 1 ? 'is' : 'are'} excluded.`
    : '';

  return `Raw file sizes: ${formatBytes(storageSummary.rawBytes)} (${storageSummary.rawBytes.toLocaleString()} bytes).${suffix}`;
}

function getLoadedSourceUrl(loadedSource) {
  if (loadedSource.kind === 'database') {
    return loadedSource.inspection.source.sourceUrl || loadedSource.inspection.source.sourceLabel;
  }

  return loadedSource.source.sourceUrl || loadedSource.source.sourceLabel;
}

function createCatalogEntriesFromLoadedSource(loadedSource, existingEntries = []) {
  if (loadedSource.kind === 'database') {
    const dbId = loadedSource.inspection.overview.dbId || '(missing)';
    const dbUrl = getCatalogEntryUrl(loadedSource);
    const matchDbUrls = getCatalogMatchUrls(loadedSource);
    if (!dbUrl) {
      return [];
    }

    return [
      {
        key: buildCustomCatalogEntryKey(dbId, dbUrl),
        dbId,
        dbUrl,
        matchDbUrls,
        title:
          findPreservedCatalogTitle(existingEntries, dbId, matchDbUrls) ||
          buildLoadedDatabaseCatalogTitle(loadedSource.inspection),
      },
    ];
  }

  return loadedSource.entries.map((entry) => ({
    key: buildCustomCatalogEntryKey(entry.dbId, entry.dbUrl),
    dbId: entry.dbId,
    dbUrl: entry.dbUrl,
    title:
      findPreservedCatalogTitle(existingEntries, entry.dbId, entry.dbUrl) ||
      buildCatalogTitleFromLocation(entry.dbUrl, entry.dbId),
  }));
}

function mergeCustomCatalogEntries(nextEntries, currentEntries) {
  return mergeCatalogEntryList(nextEntries, currentEntries);
}

function mergeCatalogEntries(customEntries, runtimeEntries) {
  return mergeCatalogEntryList(customEntries, runtimeEntries, { preferExistingTitle: true });
}

function findPreservedCatalogTitle(existingEntries, dbId, matchDbUrls) {
  const existingEntry = findCatalogOverrideEntry({ dbId, matchDbUrls }, existingEntries);
  return existingEntry?.title || '';
}

function buildLoadedDatabaseCatalogTitle(inspection) {
  if (inspection.source.sourceKind === 'upload') {
    return `Uploaded: ${inspection.source.sourceLabel}`;
  }

  return buildCatalogTitleFromLocation(
    inspection.source.sourceLabel || inspection.source.sourceUrl,
    inspection.overview.dbId,
  );
}

function buildCatalogTitleFromLocation(location, dbId = '') {
  try {
    const parsedUrl = new URL(String(location).trim());
    const segments = parsedUrl.pathname.split('/').filter(Boolean);
    const tail = segments.slice(-2).join(' / ');
    return `${parsedUrl.hostname} / ${tail || parsedUrl.pathname || dbId || 'database'}`;
  } catch {
    const normalizedLocation = String(location || '').trim();
    return normalizedLocation || dbId || 'Custom database';
  }
}

function buildCustomCatalogEntryKey(dbId, dbUrl) {
  return `custom:${normalizeCatalogDbId(dbId)}:${normalizeComparableUrl(dbUrl) || String(dbUrl).trim()}`;
}

function getCatalogEntryUrl(loadedSource) {
  if (loadedSource.kind !== 'database') {
    return '';
  }

  const source = loadedSource.inspection.source;
  if (source.sourceKind === 'upload') {
    return source.sourceUrl || '';
  }

  return source.sourceLabel || source.sourceUrl || '';
}

function getCatalogMatchUrls(loadedSource) {
  if (loadedSource.kind !== 'database') {
    return [];
  }

  const source = loadedSource.inspection.source;
  return [...new Set([source.sourceLabel, source.sourceUrl, source.requestedUrl, source.resolvedUrl])]
    .map((value) => normalizeComparableUrl(value))
    .filter(Boolean);
}

function mergeCatalogEntryList(incomingEntries, existingEntries, { preferExistingTitle = false } = {}) {
  const remainingEntries = [...existingEntries];
  const mergedIncomingEntries = [];

  for (const incomingEntry of incomingEntries) {
    const matchingIndex = findCatalogOverrideIndex(incomingEntry, remainingEntries);
    if (matchingIndex !== -1) {
      const [existingEntry] = remainingEntries.splice(matchingIndex, 1);
      mergedIncomingEntries.push(
        mergeCatalogEntry(incomingEntry, existingEntry, { preferExistingTitle }),
      );
      continue;
    }

    mergedIncomingEntries.push(incomingEntry);
  }

  return [...mergedIncomingEntries, ...remainingEntries];
}

function findCatalogOverrideEntry(entry, entries) {
  const matchingIndex = findCatalogOverrideIndex(entry, entries);
  return matchingIndex === -1 ? null : entries[matchingIndex];
}

function findCatalogOverrideIndex(entry, entries) {
  const comparableUrls = getCatalogComparableUrls(entry);
  if (comparableUrls.length) {
    const exactUrlIndex = entries.findIndex((existingEntry) => {
      const existingComparableUrls = getCatalogComparableUrls(existingEntry);
      return existingComparableUrls.some((existingUrl) => comparableUrls.includes(existingUrl));
    });
    if (exactUrlIndex !== -1) {
      return exactUrlIndex;
    }
  }

  const sameDbIdIndexes = entries
    .map((existingEntry, index) =>
      normalizeCatalogDbId(existingEntry.dbId) === normalizeCatalogDbId(entry.dbId) ? index : -1,
    )
    .filter((index) => index !== -1);

  return sameDbIdIndexes.length === 1 ? sameDbIdIndexes[0] : -1;
}

function normalizeCatalogDbId(dbId) {
  return String(dbId || '').trim().toLowerCase();
}

function mergeCatalogEntry(incomingEntry, existingEntry, { preferExistingTitle = false } = {}) {
  return {
    ...incomingEntry,
    matchDbUrls: [...new Set([...getCatalogComparableUrls(incomingEntry), ...getCatalogComparableUrls(existingEntry)])],
    title:
      (preferExistingTitle ? existingEntry?.title || incomingEntry.title : incomingEntry.title || existingEntry?.title) ||
      '',
  };
}

function getCatalogComparableUrls(entry) {
  const matchDbUrls = Array.isArray(entry?.matchDbUrls) ? entry.matchDbUrls : [];
  const normalizedUrls = [
    ...matchDbUrls,
    normalizeComparableUrl(entry?.dbUrl),
  ].filter(Boolean);

  return [...new Set(normalizedUrls)];
}

function isFileDragEvent(event) {
  const types = Array.from(event.dataTransfer?.types ?? []);
  return types.includes('Files');
}

function runAfterNextPaint(callback) {
  window.requestAnimationFrame(() => {
    window.setTimeout(() => {
      callback();
    }, 0);
  });
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

const TreeEntryRow = memo(function TreeEntryRow({
  row,
  collapsed,
  detailsVisible,
  onToggleCollapsed,
  onToggleDetails,
  onHeightChange,
  virtualStyle,
}) {
  const rowRef = useRef(null);
  const isArchive = row.type === 'archive';
  const childIds = row.childIds;
  const showCollapseControl = isArchive || childIds.length > 0;
  const title = isArchive ? row.archive.title : row.node.name;
  const badge = isArchive ? 'ZIP' : row.node.badge;
  const badgeClassName = isArchive
    ? 'node-badge archive-badge'
    : `node-badge ${row.node.kind === 'file' ? 'file-badge' : 'folder-badge'}`;
  const identifier = isArchive ? row.archive.id : row.node.path;
  const identifierLabel = isArchive ? 'Archive' : 'Path';
  const showIdentifier = isArchive || identifier !== title;
  const primaryFields = isArchive ? row.archive.primaryFields : row.node.primaryFields;
  const details = isArchive ? row.archive.details : row.node.details;
  const issues = isArchive ? row.archive.issues : [];
  const isFile = !isArchive && row.node.kind === 'file';
  const downloadUrl = isFile ? row.node.downloadUrl : null;
  const openUrl = isFile && isBrowserOpenableFile(row.node.path) ? downloadUrl : null;
  const bodyCollapsed = isFile && collapsed;
  const hasVisibleChildren = childIds.length > 0 && !collapsed;
  const containerClassName = [
    'tree-entry',
    row.depth ? 'tree-entry-indented' : '',
    isArchive ? 'archive-card' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const Container = isArchive ? 'article' : 'div';

  useLayoutEffect(() => {
    const element = rowRef.current;
    if (!element) {
      return undefined;
    }

    const reportHeight = () => {
      onHeightChange(row.id, Math.ceil(element.getBoundingClientRect().height));
    };

    reportHeight();

    if (typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const observer = new ResizeObserver(() => {
      reportHeight();
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [row.id, collapsed, detailsVisible, onHeightChange]);

  const handleToggleRowDetails = () => {
    if (isFile && collapsed && !detailsVisible) {
      onToggleCollapsed(row.id);
    }

    onToggleDetails(row.id);
  };

  const handleToggleRowCollapsed = () => {
    if (isFile && !collapsed && detailsVisible) {
      onToggleDetails(row.id);
    }

    onToggleCollapsed(row.id);
  };

  const handleDownload = () => {
    void triggerFileDownload(downloadUrl, row.node.name);
  };

  return (
    <Container
      ref={rowRef}
      className={containerClassName}
      style={{ ...buildTreeDepthStyle(row.depth), ...virtualStyle }}
    >
      {row.depth || hasVisibleChildren ? (
        <div className="tree-guides" aria-hidden="true">
          {row.depth ? (
            <span
              className={`tree-guide-parent${row.isLastSibling ? '' : ' tree-guide-parent-continue'}`}
              style={buildTreeGuideStyle(row.depth - 1)}
            />
          ) : null}
          {row.depth ? <span className="tree-guide-elbow" style={buildTreeGuideStyle(row.depth)} /> : null}
          {hasVisibleChildren ? (
            <span className="tree-guide-child" style={buildTreeGuideStyle(row.depth)} />
          ) : null}
        </div>
      ) : null}
      <div className="tree-row">
        {showCollapseControl ? (
          <button
            type="button"
            className="collapse-button"
            onClick={handleToggleRowCollapsed}
          >
            {collapsed ? '+' : '-'}
          </button>
        ) : (
          <span className="collapse-spacer" aria-hidden="true">
            <span className="leaf-marker" />
          </span>
        )}
        <div className={isArchive ? 'tree-card archive-surface' : 'tree-card'}>
          <div className="tree-heading">
            <div className="tree-title-row">
              <span className={badgeClassName}>{badge}</span>
              <h3 title={title}>{title}</h3>
              {showIdentifier ? (
                <span className="tree-identifier-inline">
                  <span className="tree-identifier-label">{identifierLabel}</span>
                  <code title={identifier}>{identifier}</code>
                </span>
              ) : null}
            </div>
            <div className="tree-heading-actions">
              <div className="node-action-row">
                <button
                  type="button"
                  className="inline-action-button"
                  onClick={handleToggleRowDetails}
                >
                  {detailsVisible ? 'Hide details' : 'Show details'}
                </button>
                {openUrl || downloadUrl ? (
                  <div className="node-download-actions">
                    {openUrl ? (
                      <a
                        className="inline-action-button open-button"
                        href={openUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        OPEN
                      </a>
                    ) : null}
                    {downloadUrl ? (
                      <button
                        type="button"
                        className="download-button"
                        onClick={handleDownload}
                      >
                        Download
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
          {!bodyCollapsed ? <PrimaryFieldRow fields={primaryFields} /> : null}
          {!bodyCollapsed && detailsVisible ? <MetadataList fields={details} /> : null}
          {issues.length ? (
            <ul className="inline-issues">
              {issues.map((issue) => (
                <li key={issue.id} className={`issue issue-${issue.level}`}>
                  <span className="issue-level">{issue.level}</span>
                  <span>{issue.message}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {isArchive && !collapsed && !childIds.length ? (
            <div className="archive-empty-inline">
              <EmptyState message="No summary entries could be rendered for this archive." />
            </div>
          ) : null}
        </div>
      </div>
    </Container>
  );
});

function buildFlatNodeIndex(nodes) {
  const rowsById = new Map();
  const rootIds = [];
  const collapsibleIds = [];

  function visit(node, depth, ancestorContinuationDepths, siblingIndex, siblingCount, parentId = null) {
    const childIds = [];
    const isLastSibling = siblingIndex === siblingCount - 1;
    const row = {
      id: node.id,
      type: 'node',
      node,
      parentId,
      depth,
      childIds,
      isLastSibling,
      ancestorContinuationDepths,
      canCollapse: node.kind === 'file' || (Array.isArray(node.children) && node.children.length > 0),
    };

    rowsById.set(row.id, row);
    if (row.canCollapse) {
      collapsibleIds.push(row.id);
    }

    if (Array.isArray(node.children) && node.children.length) {
      const nextAncestorContinuationDepths = isLastSibling
        ? ancestorContinuationDepths
        : ancestorContinuationDepths.concat(depth);

      node.children.forEach((child, childIndex) => {
        childIds.push(
          visit(child, depth + 1, nextAncestorContinuationDepths, childIndex, node.children.length, row.id),
        );
      });
    }

    return row.id;
  }

  nodes.forEach((node, index) => {
    rootIds.push(visit(node, 0, [], index, nodes.length));
  });

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

  function visitNode(node, depth, ancestorContinuationDepths, siblingIndex, siblingCount, parentId) {
    const childIds = [];
    const isLastSibling = siblingIndex === siblingCount - 1;
    const row = {
      id: node.id,
      type: 'node',
      node,
      parentId,
      depth,
      childIds,
      isLastSibling,
      ancestorContinuationDepths,
      canCollapse: node.kind === 'file' || (Array.isArray(node.children) && node.children.length > 0),
    };

    rowsById.set(row.id, row);
    if (row.canCollapse) {
      collapsibleIds.push(row.id);
    }

    if (Array.isArray(node.children) && node.children.length) {
      const nextAncestorContinuationDepths = isLastSibling
        ? ancestorContinuationDepths
        : ancestorContinuationDepths.concat(depth);

      node.children.forEach((child, childIndex) => {
        childIds.push(
          visitNode(
            child,
            depth + 1,
            nextAncestorContinuationDepths,
            childIndex,
            node.children.length,
            row.id,
          ),
        );
      });
    }

    return row.id;
  }

  archiveViews.forEach((archive, archiveIndex) => {
    const childIds = [];
    const isLastSibling = archiveIndex === archiveViews.length - 1;
    const row = {
      id: archive.nodeId,
      type: 'archive',
      archive,
      parentId: null,
      depth: 0,
      childIds,
      isLastSibling,
      ancestorContinuationDepths: [],
      canCollapse: true,
    };

    rowsById.set(row.id, row);
    rootIds.push(row.id);
    collapsibleIds.push(row.id);

    const nextAncestorContinuationDepths = isLastSibling ? [] : [0];

    archive.tree.children.forEach((child, childIndex) => {
      childIds.push(
        visitNode(
          child,
          1,
          nextAncestorContinuationDepths,
          childIndex,
          archive.tree.children.length,
          row.id,
        ),
      );
    });
  });

  return {
    rootIds,
    rowsById,
    collapsibleIds,
  };
}

function collectVisibleRowIds(rootIds, rowsById, collapsedIds) {
  const visibleRowIds = [];

  function visit(rowId) {
    const row = rowsById.get(rowId);
    if (!row) {
      return;
    }

    visibleRowIds.push(rowId);
    if (row.childIds.length && !collapsedIds.has(row.id)) {
      for (const childId of row.childIds) {
        visit(childId);
      }
    }
  }

  for (const rowId of rootIds) {
    visit(rowId);
  }

  return visibleRowIds;
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

function buildTreeGuideStyle(depth) {
  return { '--tree-guide-depth': depth };
}

function buildVirtualRowStyle(top, { trimTopGuide = false, trimBottomGuide = false } = {}) {
  return {
    position: 'absolute',
    top: `${top}px`,
    left: 0,
    right: 0,
    '--tree-guide-top-overlap': trimTopGuide ? '0px' : 'var(--tree-guide-overlap)',
    '--tree-guide-bottom-overlap': trimBottomGuide ? '0px' : 'var(--tree-guide-overlap)',
  };
}

function useWindowViewport() {
  const [viewport, setViewport] = useState(() => ({
    scrollY: typeof window === 'undefined' ? 0 : window.scrollY,
    height: typeof window === 'undefined' ? 0 : window.innerHeight,
    layoutVersion: 0,
  }));

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    let frameId = 0;
    let resizeObserver = null;
    let pendingForce = false;

    const updateViewport = () => {
      const force = pendingForce;
      frameId = 0;
      pendingForce = false;
      setViewport((current) => {
        const next = {
          scrollY: window.scrollY,
          height: window.innerHeight,
          layoutVersion: force ? current.layoutVersion + 1 : current.layoutVersion,
        };

        if (
          current.scrollY === next.scrollY &&
          current.height === next.height &&
          current.layoutVersion === next.layoutVersion
        ) {
          return current;
        }

        return next;
      });
    };

    const scheduleUpdate = (force = false) => {
      if (force) {
        pendingForce = true;
      }

      if (!frameId) {
        frameId = window.requestAnimationFrame(updateViewport);
      }
    };

    const handleToggle = () => {
      scheduleUpdate(true);
    };

    scheduleUpdate();
    window.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('resize', scheduleUpdate);
    document.addEventListener('toggle', handleToggle, true);

    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        scheduleUpdate(true);
      });
      resizeObserver.observe(document.body);
      resizeObserver.observe(document.documentElement);
    }

    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }

      window.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('resize', scheduleUpdate);
      document.removeEventListener('toggle', handleToggle, true);
      resizeObserver?.disconnect();
    };
  }, []);

  return viewport;
}

function buildVirtualRows({
  rowIds,
  rowsById,
  collapsedIds,
  detailOverrides,
  defaultDetailed,
  measuredHeights,
  containerTop,
  viewport,
}) {
  if (!rowIds.length) {
    return {
      totalHeight: 0,
      items: [],
    };
  }

  const offsets = new Array(rowIds.length);
  const bottoms = new Array(rowIds.length);
  let totalHeight = 0;

  for (let index = 0; index < rowIds.length; index += 1) {
    const rowId = rowIds[index];
    const row = rowsById.get(rowId);
    const collapsed = collapsedIds.has(rowId);
    const detailsVisible = detailOverrides.get(rowId) ?? defaultDetailed;
    const measuredHeight = measuredHeights.get(rowId);
    const rowHeight =
      measuredHeight ?? estimateRowHeight(row, { collapsed, detailsVisible });

    offsets[index] = totalHeight;
    bottoms[index] = totalHeight + rowHeight;
    totalHeight += rowHeight;

    if (index < rowIds.length - 1) {
      totalHeight += TREE_LIST_GAP_PX;
    }
  }

  const viewportTop = viewport.scrollY - containerTop - TREE_OVERSCAN_PX;
  const viewportBottom = viewport.scrollY + viewport.height - containerTop + TREE_OVERSCAN_PX;
  const startIndex = lowerBound(bottoms, viewportTop);
  const endIndex = Math.min(rowIds.length, upperBound(offsets, viewportBottom));
  const rowIndexById = new Map();
  for (let index = 0; index < rowIds.length; index += 1) {
    rowIndexById.set(rowIds[index], index);
  }

  const renderedIndexes = new Set();
  for (let index = startIndex; index < endIndex; index += 1) {
    renderedIndexes.add(index);
  }

  if (startIndex < rowIds.length) {
    let ancestorRowId = rowsById.get(rowIds[startIndex])?.parentId ?? null;
    while (ancestorRowId) {
      const ancestorIndex = rowIndexById.get(ancestorRowId);
      if (ancestorIndex == null) {
        break;
      }

      renderedIndexes.add(ancestorIndex);
      ancestorRowId = rowsById.get(ancestorRowId)?.parentId ?? null;
    }
  }

  const sortedIndexes = Array.from(renderedIndexes).sort((left, right) => left - right);
  if (!sortedIndexes.length) {
    sortedIndexes.push(Math.max(0, Math.min(rowIds.length - 1, startIndex)));
  }
  const items = [];

  for (const index of sortedIndexes) {
    items.push({
      rowId: rowIds[index],
      top: offsets[index],
      trimTopGuide: index === sortedIndexes[0] && sortedIndexes[0] > 0,
      trimBottomGuide:
        index === sortedIndexes[sortedIndexes.length - 1] &&
        sortedIndexes[sortedIndexes.length - 1] < rowIds.length - 1,
    });
  }

  return {
    totalHeight,
    items,
  };
}

function estimateRowHeight(row, { collapsed, detailsVisible }) {
  if (!row) {
    return 180;
  }

  if (row.type === 'archive') {
    let estimate = 180;
    if (detailsVisible) {
      estimate += 120;
    }

    if (row.archive.issues.length) {
      estimate += Math.min(row.archive.issues.length, 4) * 42;
    }

    if (!collapsed && !row.childIds.length) {
      estimate += 48;
    }

    return estimate;
  }

  if (row.node.kind === 'file' && collapsed) {
    return 120;
  }

  let estimate = row.node.kind === 'folder' ? 145 : 155;
  if (detailsVisible) {
    estimate += 110;
  }

  return estimate;
}

function lowerBound(values, target) {
  let low = 0;
  let high = values.length;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (values[middle] < target) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
}

function upperBound(values, target) {
  let low = 0;
  let high = values.length;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (values[middle] <= target) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
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
    >
      <p className="dictionary-meta">{tags.length} entries</p>
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
      {fields.map((field, index) =>
        field.kind === 'tags' ? (
          <div key={`${field.label}:${index}`} className="primary-tags">
            <FieldValue field={field} />
          </div>
        ) : (
          <div key={`${field.label}:${index}`} className="primary-pill">
            <span>{field.label}</span>
            <FieldValue field={field} />
          </div>
        ),
      )}
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
          Open all
        </button>
        <button type="button" className="secondary-button" onClick={onCollapseAll}>
          Close all
        </button>
      </div>
    </div>
  );
}

function DetailedToggle({ detailed, onDetailedChange }) {
  return (
    <button
      type="button"
      className="toggle-group toggle-group-button"
      aria-label="Detailed toggle"
      aria-pressed={detailed}
      onClick={() => onDetailedChange(!detailed)}
    >
      <span className="toggle-label">Detailed</span>
      <span className={!detailed ? 'toggle-chip active' : 'toggle-chip'}>
        Off
      </span>
      <span className={detailed ? 'toggle-chip active' : 'toggle-chip'}>
        On
      </span>
    </button>
  );
}
