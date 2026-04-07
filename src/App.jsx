import {
  memo,
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal, flushSync } from 'react-dom';
import { strToU8, zipSync } from 'fflate';
import {
  applyInspectionFilter,
  formatBytes,
  loadDatabaseSourceFile,
  loadDatabaseSourceUrl,
  loadRuntimeDatabaseCatalog,
  summarizeInspectionStorage,
} from './lib/database.js';

console.log('[DB Inspector] Tree virtualization:', __VIRTUALIZE__ ? 'enabled' : 'disabled');

const DATABASE_URL_PARAM = 'database-url';
const FILTER_URL_PARAM = 'filter';
const DETAILED_URL_PARAM = 'detailed';
const FILTER_INPUT_DEBOUNCE_MS = 600;
const TREE_LIST_GAP_PX = 13;
const TREE_OVERSCAN_PX = 900;
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

const isTouchDevice =
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 0);

function useDebouncedValue(value, delay) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [value, delay]);

  return debouncedValue;
}

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
  const [databaseDetailed, setDatabaseDetailed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).has(DETAILED_URL_PARAM);
  });
  const handleDatabaseDetailedChange = useCallback((next) => {
    startTransition(() => {
      setDatabaseDetailed(next);
    });
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      if (next) {
        url.searchParams.set(DETAILED_URL_PARAM, '');
      } else {
        url.searchParams.delete(DETAILED_URL_PARAM);
      }
      history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
  }, []);
  const handleDownloadError = useCallback((error) => {
    setDownloadErrorUrl(error);
  }, []);
  const [runtimeCatalogOptions, setRuntimeCatalogOptions] = useState([]);
  const [customCatalogOptions, setCustomCatalogOptions] = useState([]);
  const [catalogStatus, setCatalogStatus] = useState('loading');
  const [catalogError, setCatalogError] = useState('');
  const [catalogModalOpen, setCatalogModalOpen] = useState(false);
  const [installModalOpen, setInstallModalOpen] = useState(false);
  const [downloadErrorUrl, setDownloadErrorUrl] = useState(null);
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
  const filesystemIndex = useMemo(
    () => (displayedInspection ? buildFlatNodeIndex(displayedInspection.filesystemTree.children) : null),
    [displayedInspection],
  );
  const archivesIndex = useMemo(
    () =>
      displayedInspection?.archiveViews.length
        ? buildFlatArchiveIndex(displayedInspection.archiveViews)
        : null,
    [displayedInspection],
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
  const tagDictionary = displayedInspection?.overview.tagDictionary ?? [];
  const hasEssentialHint = tagDictionary.some((t) => t.name === 'essential');
  const hasUntaggedItems = useMemo(() => {
    if (!filesystemIndex) return false;
    for (const [, row] of filesystemIndex.rowsById) {
      const tags = row.node?.primaryFields?.find((f) => f.kind === 'tags');
      if (!tags || !Array.isArray(tags.value) || tags.value.length === 0) return true;
    }
    return false;
  }, [filesystemIndex]);
  const globalSearch = useGlobalSearch({ filesystemIndex, archivesIndex, tagDictionary, hasEssentialHint, hasInspection: !!displayedInspection });

  useEffect(() => {
    const match = globalSearch.currentMatch;
    if (match?.section !== 'filter') return;
    const el = document.getElementById(match.rowId);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.top < 0 || rect.bottom > window.innerHeight) {
      el.scrollIntoView({ block: 'center' });
    }
    if (!CSS.highlights) return;
    CSS.highlights.delete('search-match');
    const query = globalSearch.activeQuery.toLowerCase();
    if (!query) return;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const ranges = [];
    let textNode = walker.nextNode();
    while (textNode) {
      const idx = textNode.textContent.toLowerCase().indexOf(query);
      if (idx !== -1) {
        const range = new Range();
        range.setStart(textNode, idx);
        range.setEnd(textNode, idx + query.length);
        ranges.push(range);
      }
      textNode = walker.nextNode();
    }
    if (ranges.length) CSS.highlights.set('search-match', new Highlight(...ranges));
  }, [globalSearch.currentMatch?.token]);

  useEffect(() => {
    if (!CSS.highlights) return;
    const query = globalSearch.activeQuery.toLowerCase();
    const el = document.getElementById('filter-essential-hint');
    if (!query || !el) { CSS.highlights.delete('search-match-all-filter'); return; }
    if (globalSearch.currentMatch?.rowId === 'filter-essential-hint') { CSS.highlights.delete('search-match-all-filter'); return; }
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const ranges = [];
    let textNode = walker.nextNode();
    while (textNode) {
      const idx = textNode.textContent.toLowerCase().indexOf(query);
      if (idx !== -1) {
        const range = new Range();
        range.setStart(textNode, idx);
        range.setEnd(textNode, idx + query.length);
        ranges.push(range);
      }
      textNode = walker.nextNode();
    }
    if (ranges.length) CSS.highlights.set('search-match-all-filter', new Highlight(...ranges));
    else CSS.highlights.delete('search-match-all-filter');
  }, [globalSearch.activeQuery, globalSearch.currentMatch]);

  useEffect(() => {
    inspectionRef.current = inspection;
  }, [inspection]);

  useEffect(() => {
    const onMouseDown = (event) => {
      const tooltip = event.target.closest('.tree-title-tooltip, .chip-tooltip, .info-tip');
      if (tooltip) tooltip.setAttribute('data-selecting', '');
    };
    const onMouseUp = () => {
      for (const el of document.querySelectorAll('[data-selecting]')) {
        el.removeAttribute('data-selecting');
      }
    };
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const [nodeAnchor, setNodeAnchor] = useState(null);

  useEffect(() => {
    if (!inspection) {
      return;
    }

    if (
      inspection.source.sourceKind === 'url' &&
      inspection.source.requestedUrl &&
      window.location.hash === '#install'
    ) {
      setInstallModalOpen(true);
      return;
    }

    const anchor = parseNodeAnchor();
    if (anchor) {
      setNodeAnchor(anchor);
    } else {
      const sectionHash = window.location.hash.slice(1);
      if (sectionHash) {
        runAfterNextPaint(() => {
          const target = document.getElementById(`section-${sectionHash}`);
          if (!target) return;

          if (target.tagName === 'DETAILS' && !target.open) {
            target.open = true;
          }

          target.scrollIntoView({ block: 'start' });
          window.setTimeout(() => {
            target.scrollIntoView({ block: 'start' });
          }, 300);
        });
      }
    }
  }, [inspectionKeyBase]);

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
          <p className="helper-copy">
            Supports database files (<code>.json</code>), drop-in databases (<code>.ini</code>), and <code>downloader.ini</code>.
            All can be zipped.
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
            <section id="section-database" className="panel overview-panel">
              <div className="overview-header">
                <div>
                  <p className="section-label">Database</p>
                  <h2>
                    <SectionAnchor anchor="database" />
                    {displayedInspection.overview.dbId}
                  </h2>
                  <GitHubRepoLink source={displayedInspection.source} dbId={displayedInspection.overview.dbId} />
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
                      onDetailedChange={handleDatabaseDetailedChange}
                    />
                    {displayedInspection.source.sourceKind === 'url' && displayedInspection.source.requestedUrl ? (
                      <button
                        type="button"
                        className="install-button"
                        onClick={() => {
                          setInstallModalOpen(true);
                          history.replaceState(null, '', '#install');
                        }}
                      >
                        Install
                      </button>
                    ) : null}
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
              anchor="filter"
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
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        event.target.blur();
                      }
                    }}
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
                Filter content with terms (a.k.a. tags) like <code>console</code>, <code>arcade</code>,
                or <code>!cheats</code>. Positive terms keep matching tagged items, negative terms
                remove them{hasEssentialHint
                  ? <>{hasUntaggedItems ? <>, untagged items remain visible,</> : null} and <code id="filter-essential-hint" className="clickable-code" role="button" tabIndex={0} onClick={() => { globalSearch.setQuery('essential'); globalSearch.openSearch(); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); globalSearch.setQuery('essential'); globalSearch.openSearch(); } }}>essential</code> stays
                included unless you exclude it</>
                  : hasUntaggedItems ? <>, and untagged items remain visible</> : null}.{' '}
                <a
                  href="https://github.com/MiSTer-devel/Downloader_MiSTer/blob/main/docs/download-filters.md"
                  target="_blank"
                  rel="noreferrer"
                  style={{ whiteSpace: 'nowrap' }}
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
                          className="disk-usage-value info-hint"
                          tabIndex={0}
                          role="button"
                          onClick={(event) => {
                            event.currentTarget.classList.toggle('tooltip-below', event.currentTarget.getBoundingClientRect().top < 80);
                            event.currentTarget.toggleAttribute('data-open');
                          }}
                          onMouseLeave={(event) => {
                            event.currentTarget.removeAttribute('data-open');
                          }}
                          onBlur={(event) => {
                            event.currentTarget.removeAttribute('data-open');
                          }}
                        >
                          {formatBytes(storageSummary.clusteredBytes)}
                          <span className="info-tip">{buildRawByteHoverCopy(storageSummary)}</span>
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
                        <span
                          className="info-hint"
                          tabIndex={0}
                          role="button"
                          aria-label="Cluster size info"
                          onClick={(event) => {
                            event.currentTarget.classList.toggle('tooltip-below', event.currentTarget.getBoundingClientRect().top < 80);
                            event.currentTarget.toggleAttribute('data-open');
                          }}
                          onMouseLeave={(event) => {
                            event.currentTarget.removeAttribute('data-open');
                          }}
                          onBlur={(event) => {
                            event.currentTarget.removeAttribute('data-open');
                          }}
                        >
                          &#9432;
                          <span className="info-tip">
                            SD cards over 32 GB are usually formatted with 128 KB clusters (exFAT default).
                            Cards of 32 GB or smaller typically use 32 KB clusters (FAT32 default).
                          </span>
                        </span>
                      </>
                    ) : null}
                  </>
                )}
              </p>
            </CollapsibleSection>

            <FilesystemSection
              key={`filesystem:${inspectionKey}`}
              index={filesystemIndex}
              emptyMessage={
                displayedInspection.activeFilter.isFiltering
                  ? 'No files or folders match the current filter.'
                  : 'No top-level files or folders were found.'
              }
              detailed={databaseDetailed}
              onDetailedChange={handleDatabaseDetailedChange}
              anchorRowId={nodeAnchor?.section === 'filesystem' ? nodeAnchor.rowId : null}
              altAnchorRowId={nodeAnchor?.section === 'filesystem' ? nodeAnchor.altRowId : null}
              onAnchorHandled={() => setNodeAnchor(null)}
              searchMatch={globalSearch.currentMatch?.section === 'filesystem' ? globalSearch.currentMatch : null}
              searchQuery={globalSearch.activeQuery}
              onDownloadError={handleDownloadError}
            />

            {displayedInspection.archiveViews.length ? (
              <ArchiveSummariesSection
                key={`archives:${inspectionKey}`}
                index={archivesIndex}
                emptyMessage={
                  displayedInspection.activeFilter.isFiltering
                    ? 'No archive summary entries match the current filter.'
                    : 'This database does not define any archives.'
                }
                detailed={databaseDetailed}
                onDetailedChange={handleDatabaseDetailedChange}
                anchorRowId={nodeAnchor?.section === 'archives' ? nodeAnchor.rowId : null}
                altAnchorRowId={nodeAnchor?.section === 'archives' ? nodeAnchor.altRowId : null}
                onAnchorHandled={() => setNodeAnchor(null)}
                searchMatch={globalSearch.currentMatch?.section === 'archives' ? globalSearch.currentMatch : null}
                searchQuery={globalSearch.activeQuery}
                onDownloadError={handleDownloadError}
              />
            ) : null}

            <CollapsibleSection
              label="Diagnostics"
              title="Issues and warnings"
              defaultOpen
              anchor="issues"
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
              <TagDictionary
                tags={displayedInspection.overview.tagDictionary}
                searchQuery={globalSearch.activeQuery}
                searchMatch={globalSearch.currentMatch?.section === 'tags' ? globalSearch.currentMatch : null}
              />
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

      {installModalOpen && displayedInspection ? (
        <InstallModal
          dbId={displayedInspection.overview.dbId}
          dbUrl={displayedInspection.source.requestedUrl}
          activeFilter={debouncedFilterInput}
          onClose={() => {
            setInstallModalOpen(false);
            if (window.location.hash === '#install') {
              history.replaceState(null, '', window.location.pathname + window.location.search);
            }
          }}
        />
      ) : null}

      {downloadErrorUrl ? (
        <DownloadErrorModal
          error={downloadErrorUrl}
          onClose={() => setDownloadErrorUrl(null)}
        />
      ) : null}

      <p className="app-footer"><a className="stealth-link" href="https://github.com/theypsilon" target="_blank" rel="noopener noreferrer">© 2026 José Barroso (theypsilon)</a><span className="stealth-link" role="button" tabIndex={0} onClick={() => { if (!globalSearch.open) globalSearch.openSearch(); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (!globalSearch.open) globalSearch.openSearch(); } }}>Press <kbd>{typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘F' : 'Ctrl+F'}</kbd> to search</span></p>
      {globalSearch.open ? (
        <FindBar
          query={globalSearch.query}
          onQueryChange={globalSearch.setQuery}
          focusToken={globalSearch.focusToken}
          currentIndex={globalSearch.currentMatchIndex}
          totalMatches={globalSearch.totalMatches}
          onNext={globalSearch.goToNextMatch}
          onPrev={globalSearch.goToPrevMatch}
          onJumpTo={globalSearch.jumpToMatch}
          onClose={globalSearch.closeSearch}
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
  const debouncedQuery = useDebouncedValue(query.trim().toLowerCase(), FILTER_INPUT_DEBOUNCE_MS);

  useEffect(() => {
    setSelectedKey(initialSelectedKey);
  }, [initialSelectedKey]);

  const filteredOptions = useMemo(() => {
    if (!debouncedQuery) {
      return options;
    }

    return options.filter((option) => {
      const haystack = `${option.dbId} ${option.title} ${option.dbUrl}`.toLowerCase();
      return haystack.includes(debouncedQuery);
    });
  }, [debouncedQuery, options]);

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
  const debounceddQuery = useDebouncedValue(query.trim().toLowerCase(), FILTER_INPUT_DEBOUNCE_MS);

  useEffect(() => {
    setSelectedKey(iniSource.entries[0]?.key ?? '');
  }, [iniSource]);

  const filteredEntries = useMemo(() => {
    if (!debounceddQuery) {
      return iniSource.entries;
    }

    return iniSource.entries.filter((entry) => {
      const haystack = `${entry.dbId} ${entry.dbUrl}`.toLowerCase();
      return haystack.includes(debounceddQuery);
    });
  }, [debounceddQuery, iniSource]);

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

function InstallModal({ dbId, dbUrl, activeFilter, onClose }) {
  const [includeFilter, setIncludeFilter] = useState(false);
  const trimmedFilter = String(activeFilter || '').trim();
  const hasFilter = trimmedFilter.length > 0;
  const iniFileName = `downloader_${dbId}.ini`;
  const installUrl = typeof window !== 'undefined'
    ? window.location.origin + window.location.pathname + window.location.search + '#install'
    : '';

  const handleDownload = () => {
    let content = `[${dbId}]\ndb_url=${dbUrl}\n`;
    if (includeFilter && hasFilter) {
      content += `filter=${trimmedFilter}\n`;
    }

    const zipped = zipSync({ [iniFileName]: strToU8(content) });
    const blob = new Blob([zipped], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    triggerBrowserDownload(url, `downloader_${dbId}.zip`);
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  return (
    <ModalFrame
      label="Install"
      title={`Install \u201C${dbId}\u201D on MiSTer`}
      onClose={onClose}
      headerActions={<CopyLinkButton url={installUrl} tooltip="Copy install link to clipboard" />}
    >
      <p className="helper-copy">
        To install this database on your MiSTer, download the ZIP below, extract{' '}
        <strong>{iniFileName}</strong>, and copy it to the root of your SD card. The next time MiSTer
        Downloader or Update All runs, it will pick up this database automatically.
      </p>
      {hasFilter ? (
        <label className="install-filter-option">
          <input
            type="checkbox"
            checked={includeFilter}
            onChange={(event) => setIncludeFilter(event.target.checked)}
          />
          <span>
            Include the current filter in the INI file: <code>{trimmedFilter}</code>
          </span>
        </label>
      ) : null}
      <div className="install-download-row">
        <button type="button" className="install-button" onClick={handleDownload}>
          Download {dbId} database
        </button>
      </div>
    </ModalFrame>
  );
}

function CopyLinkButton({ url, tooltip }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      });
    }
  };

  return (
    <button
      type="button"
      className={`copy-link-button-icon${copied ? ' copy-link-button-copied' : ''}`}
      onClick={handleCopy}
      aria-label={tooltip}
    >
      <span className="copy-link-button-svg" aria-hidden="true">
        {copied ? (
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3.5 8.5 6.5 11.5 12.5 4.5" />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
            <path d="M10.5 5.5V3.5a1.5 1.5 0 0 0-1.5-1.5H3.5A1.5 1.5 0 0 0 2 3.5V9a1.5 1.5 0 0 0 1.5 1.5h2" />
          </svg>
        )}
      </span>
      <span className="copy-link-button-tooltip">
        {copied ? 'Copied!' : tooltip}
      </span>
    </button>
  );
}

function describeDownloadError(error) {
  const reason = error?.reason;
  const status = error?.status;

  if (reason === 'http' && status === 401) {
    return { message: 'Authentication required. This file is not publicly accessible.', code: 401, copyable: true };
  }
  if (reason === 'http' && status === 403) {
    return { message: 'Access denied by the server. The file may require authentication.', code: 403, copyable: true };
  }
  if (reason === 'http' && status === 404) {
    return { message: 'File not found. It may have been moved or removed.', code: 404, copyable: false };
  }
  if (reason === 'http' && status === 408) {
    return { message: 'The request timed out. The server took too long to respond \u2014 try again later.', code: 408, copyable: false };
  }
  if (reason === 'http' && status === 410) {
    return { message: 'This file has been permanently removed.', code: 410, copyable: false };
  }
  if (reason === 'http' && status === 429) {
    return { message: 'Too many requests. Try again later.', code: 429, copyable: false };
  }
  if (reason === 'http' && status >= 500) {
    return { message: 'This is usually temporary \u2014 try again later.', code: status, copyable: false };
  }
  if (reason === 'http') {
    return { message: 'Unexpected server response.', code: status, copyable: false };
  }
  if (reason === 'html') {
    return { message: 'The server returned a web page instead of the file. The file may live inside a remote archive that does not support direct downloads.', code: null, copyable: true };
  }
  if (reason === 'network') {
    return { message: 'The request could not reach the server. The host may not allow browser downloads, or there may be a network issue.', code: null, copyable: true };
  }
  return { message: 'This file could not be downloaded directly in the browser.', code: null, copyable: true };
}

function DownloadErrorModal({ error, onClose }) {
  const [copied, setCopied] = useState(false);
  const url = error?.url || '';
  const fileName = error?.fileName || 'file';
  const { message, code, copyable } = describeDownloadError(error);

  const handleCopy = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      });
    }
  };

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
      <div className="download-error-card" role="alertdialog" aria-label="Download error">
        <p className="section-label download-error-label">Download failed</p>
        <strong className="download-error-title">{fileName}</strong>
        <div className="download-error-text">
          <span>{code ? <><code className="download-error-code">{code}</code> </> : null}{message}</span>
          {copyable ? <span>You can copy the URL and try it in another tab or tool.</span> : null}
        </div>
        <div className="download-error-footer">
          {copyable ? (
            <button type="button" className="copy-url-button" onClick={handleCopy}>
              {copied ? 'Copied' : 'Copy URL'}
            </button>
          ) : null}
          <button type="button" className="download-error-dismiss" onClick={onClose}>
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}

const FilesystemSection = memo(function FilesystemSection({ index, emptyMessage, detailed, onDetailedChange, anchorRowId, altAnchorRowId, onAnchorHandled, searchMatch, searchQuery, onDownloadError }) {
  return (
    <TreeSection
      label="Content"
      title="Files and folders"
      listClassName="tree-root"
      emptyMessage={emptyMessage}
      index={index}
      detailed={detailed}
      onDetailedChange={onDetailedChange}
      anchorRowId={anchorRowId}
      altAnchorRowId={altAnchorRowId}
      onAnchorHandled={onAnchorHandled}
      searchMatch={searchMatch}
      searchQuery={searchQuery}
      anchor="files"
      onDownloadError={onDownloadError}
    />
  );
});

const ArchiveSummariesSection = memo(function ArchiveSummariesSection({ index, emptyMessage, detailed, onDetailedChange, anchorRowId, altAnchorRowId, onAnchorHandled, searchMatch, searchQuery, onDownloadError }) {
  return (
    <TreeSection
      label="Content"
      title="Archives"
      listClassName="archive-list"
      emptyMessage={emptyMessage}
      index={index}
      detailed={detailed}
      onDetailedChange={onDetailedChange}
      anchorRowId={anchorRowId}
      altAnchorRowId={altAnchorRowId}
      onAnchorHandled={onAnchorHandled}
      searchMatch={searchMatch}
      searchQuery={searchQuery}
      anchor="archives"
      onDownloadError={onDownloadError}
    />
  );
});

const TreeSection = memo(function TreeSection({
  label,
  title,
  listClassName,
  emptyMessage,
  index,
  detailed,
  onDetailedChange,
  anchorRowId: anchorRowIdProp,
  altAnchorRowId,
  onAnchorHandled,
  searchMatch,
  searchQuery,
  anchor,
  onDownloadError,
}) {
  const [searchAnchorRowId, setSearchAnchorRowId] = useState(null);
  const searchMatchPartRef = useRef('name');
  const highlightClearTimerRef = useRef(0);
  const resolvedPropAnchor = anchorRowIdProp && index.rowsById.has(anchorRowIdProp)
    ? anchorRowIdProp
    : altAnchorRowId && index.rowsById.has(altAnchorRowId)
      ? altAnchorRowId
      : anchorRowIdProp;
  const anchorRowId = resolvedPropAnchor || searchAnchorRowId;
  const [collapsedIds, setCollapsedIds] = useState(() => new Set());
  const [detailOverrides, setDetailOverrides] = useState(() => new Map());
  const [highlightedRowId, setHighlightedRowId] = useState(null);
  const [ghostParentId, setGhostParentId] = useState(null);
  const [hoveredColumnDepth, setHoveredColumnDepth] = useState(-1);
  const [columnLineBottom, setColumnLineBottom] = useState(null);
  const lastCursorRef = useRef(null);
  const suppressAnchoringRef = useRef(false);
  const visibleRowIds = useMemo(
    () => collectVisibleRowIds(index.rootIds, index.rowsById, collapsedIds),
    [index, collapsedIds],
  );

  const applyHighlightToRow = useCallback((rowElement, row, matchPart, searchTerm) => {
    if (!CSS.highlights) return;
    CSS.highlights.delete('search-match');
    if (!row) return;

    let searchRoot;
    let term;

    if (searchTerm) {
      searchRoot = rowElement;
      term = searchTerm;
    } else if (matchPart === 'path') {
      searchRoot = rowElement.querySelector('.tree-identifier-inline code') || rowElement;
      term = row.type === 'archive' ? row.archive.id : row.node?.path || '';
    } else {
      searchRoot = rowElement.querySelector('h3') || rowElement;
      term = row.type === 'archive' ? row.archive.title : row.node?.name || '';
    }

    if (!term) return;
    const termLower = term.toLowerCase();
    const walker = document.createTreeWalker(searchRoot, NodeFilter.SHOW_TEXT);
    const ranges = [];
    let textNode = walker.nextNode();
    while (textNode) {
      const text = textNode.textContent.toLowerCase();
      let pos = 0;
      while (pos < text.length) {
        const idx = text.indexOf(termLower, pos);
        if (idx === -1) break;
        const range = new Range();
        range.setStart(textNode, idx);
        range.setEnd(textNode, idx + termLower.length);
        ranges.push(range);
        pos = idx + termLower.length;
      }
      textNode = walker.nextNode();
    }
    if (ranges.length) {
      CSS.highlights.set('search-match', new Highlight(...ranges));
    }
  }, []);

  const searchQueryRef = useRef('');
  useEffect(() => {
    if (!searchMatch) return;
    const section = document.getElementById(`section-${anchor}`);
    if (section && !section.open) section.open = true;
    searchMatchPartRef.current = searchMatch.matchPart || 'name';
    searchQueryRef.current = searchMatch.query || '';
    setSearchAnchorRowId(searchMatch.rowId);
  }, [searchMatch?.token, anchor]);

  useEffect(() => {
    if (!anchorRowId || !index.rowsById.has(anchorRowId)) {
      return;
    }

    const ancestorsToExpand = [];
    let parentId = index.rowsById.get(anchorRowId)?.parentId;
    while (parentId) {
      ancestorsToExpand.push(parentId);
      parentId = index.rowsById.get(parentId)?.parentId;
    }

    if (ancestorsToExpand.length) {
      setCollapsedIds((current) => {
        const next = new Set(current);
        for (const id of ancestorsToExpand) {
          next.delete(id);
        }
        return next;
      });
    }

    const isSearchMatch = !!searchAnchorRowId;
    if (searchAnchorRowId) {
      setSearchAnchorRowId(null);
    }
    onAnchorHandled?.();

    if (isSearchMatch) {
      setHighlightedRowId(anchorRowId);
    }

    const applyRowHighlight = (rowElement) => {
      if (!isSearchMatch) return;
      const row = index.rowsById.get(anchorRowId);
      const matchPart = searchMatchPartRef.current;
      applyHighlightToRow(rowElement, row, matchPart, searchQueryRef.current);
    };

    const scrollToAnchor = () => {
      const element = document.getElementById(`row-${anchorRowId}`);
      if (element) {
        const rect = element.getBoundingClientRect();
        const inViewport = rect.top >= 0 && rect.bottom <= window.innerHeight;
        if (inViewport) {
          applyRowHighlight(element);
          return;
        }
        suppressAnchoringRef.current = true;
        element.scrollIntoView({ block: 'start' });
        applyRowHighlight(element);
        window.setTimeout(() => {
          element.scrollIntoView({ block: 'start' });
          suppressAnchoringRef.current = false;
        }, 500);
        return;
      }

      if (__VIRTUALIZE__) {
        const readContainerTop = () =>
          containerRef?.current
            ? Math.round(containerRef.current.getBoundingClientRect().top + window.scrollY)
            : containerTop;
        const rowIndex = visibleRowIds.indexOf(anchorRowId);
        if (rowIndex >= 0 && virtualLayout) {
          const offset = virtualLayout.offsets[rowIndex];
          if (offset != null) {
            const viewportHalf = (typeof window !== 'undefined' ? window.innerHeight : 0) / 2;
            suppressAnchoringRef.current = true;
            window.scrollTo(0, readContainerTop() + offset - viewportHalf);

            const correctScroll = (attemptsLeft) => {
              const el = document.getElementById(`row-${anchorRowId}`);
              if (el) {
                el.scrollIntoView({ block: 'start' });
                applyRowHighlight(el);
                window.setTimeout(() => {
                  const target = document.getElementById(`row-${anchorRowId}`);
                  if (target) {
                    target.scrollIntoView({ block: 'start' });
                  }
                  suppressAnchoringRef.current = false;
                }, 300);
                return;
              }

              if (attemptsLeft > 0) {
                const freshLayout = virtualLayoutRef?.current ?? virtualLayout;
                const freshOffset = freshLayout.offsets[rowIndex];
                if (freshOffset != null) {
                  window.scrollTo(0, readContainerTop() + freshOffset - viewportHalf);
                }
                window.setTimeout(() => correctScroll(attemptsLeft - 1), 200);
                return;
              }

              suppressAnchoringRef.current = false;
            };

            window.setTimeout(() => correctScroll(3), 200);
          }
        }
      }
    };

    runAfterNextPaint(scrollToAnchor);

    if (!isSearchMatch) {
      return;
    }

    const clearHighlight = () => {
      setHighlightedRowId(null);
      CSS.highlights?.delete('search-match');
    };

    window.clearTimeout(highlightClearTimerRef.current);
    highlightClearTimerRef.current = window.setTimeout(clearHighlight, 3000);

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        clearHighlight();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(highlightClearTimerRef.current);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [anchorRowId, index]);

  // --- virtualization-only state and machinery ---
  if (__VIRTUALIZE__) {
    /* eslint-disable react-hooks/rules-of-hooks -- __VIRTUALIZE__ is a build-time constant */
    var containerRef = useRef(null);
    var pendingMeasuredHeightsRef = useRef(new Map());
    var measuredHeightsRef = useRef(new Map());
    var heightFlushFrameRef = useRef(0);
    var scrollIdleTimeoutRef = useRef(0);
    var scrollingRef = useRef(false);
    var [measuredHeights, setMeasuredHeights] = useState(() => new Map());
    var [containerTop, setContainerTop] = useState(0);
    var viewport = useWindowViewport();
    var virtualLayout = useMemo(
      () =>
        buildVirtualRowLayout({
          rowIds: visibleRowIds,
          rowsById: index.rowsById,
          collapsedIds,
          detailOverrides,
          defaultDetailed: detailed,
          measuredHeights,
        }),
      [visibleRowIds, index.rowsById, collapsedIds, detailOverrides, detailed, measuredHeights],
    );
    var virtualLayoutRef = useRef(virtualLayout);
    virtualLayoutRef.current = virtualLayout;
    var virtualRows = useMemo(
      () =>
        buildVirtualRows({
          layout: virtualLayout,
          rowsById: index.rowsById,
          containerTop,
          scrollY: viewport.scrollY,
          viewportHeight: viewport.height,
        }),
      [virtualLayout, index.rowsById, containerTop, viewport.scrollY, viewport.height],
    );
    var resetMeasuredHeights = useCallback(() => {
      pendingMeasuredHeightsRef.current.clear();
      measuredHeightsRef.current = new Map();
      if (heightFlushFrameRef.current && typeof window !== 'undefined') {
        window.cancelAnimationFrame(heightFlushFrameRef.current);
        heightFlushFrameRef.current = 0;
      }
      setMeasuredHeights(new Map());
    }, []);
    /* eslint-enable react-hooks/rules-of-hooks */
  }
  // --- end virtualization-only ---

  const handleExpandAll = useCallback(() => {
    startTransition(() => {
      setCollapsedIds(new Set());
    });
  }, []);

  const handleCollapseAll = useCallback(() => {
    startTransition(() => {
      setCollapsedIds(new Set(
        index.collapsibleIds.filter((id) => {
          const row = index.rowsById.get(id);
          return row && row.type === 'node' ? row.node.kind !== 'file' : row?.childIds?.length > 0;
        }),
      ));
    });
  }, [index]);

  const handleToggleCollapsed = useCallback((rowId) => {
    flushSync(() => {
      setCollapsedIds((current) => toggleSetMembership(current, rowId));
    });
  }, []);

  const handleToggleDetails = useCallback(
    (rowId) => {
      flushSync(() => {
        setDetailOverrides((current) => toggleDetailOverride(current, rowId, detailed));
      });
    },
    [detailed],
  );

  const handleSetRowState = useCallback(
    (rowId, { collapsed, detailsVisible }) => {
      flushSync(() => {
        if (typeof collapsed === 'boolean') {
          setCollapsedIds((current) => setSetMembership(current, rowId, collapsed));
        }

        if (typeof detailsVisible === 'boolean') {
          setDetailOverrides((current) =>
            setDetailVisibilityOverride(current, rowId, detailsVisible, detailed),
          );
        }
      });
    },
    [detailed],
  );

  if (__VIRTUALIZE__) {
    /* eslint-disable react-hooks/rules-of-hooks -- __VIRTUALIZE__ is a build-time constant */
    var flushMeasuredHeights = useCallback(() => {
      heightFlushFrameRef.current = 0;
      const pendingEntries = Array.from(pendingMeasuredHeightsRef.current.entries());
      pendingMeasuredHeightsRef.current.clear();
      if (!pendingEntries.length) {
        return;
      }

      let changed = false;
      const currentMeasuredHeights = measuredHeightsRef.current;
      const nextMeasuredHeights = new Map(currentMeasuredHeights);
      for (const [rowId, height] of pendingEntries) {
        if (nextMeasuredHeights.get(rowId) === height) {
          continue;
        }

        nextMeasuredHeights.set(rowId, height);
        changed = true;
      }

      if (!changed) {
        return;
      }

      let scrollAnchorDelta = 0;
      if (typeof window !== 'undefined' && visibleRowIds.length) {
        const currentLayout = buildVirtualRowLayout({
          rowIds: visibleRowIds,
          rowsById: index.rowsById,
          collapsedIds,
          detailOverrides,
          defaultDetailed: detailed,
          measuredHeights: currentMeasuredHeights,
        });
        const nextLayout = buildVirtualRowLayout({
          rowIds: visibleRowIds,
          rowsById: index.rowsById,
          collapsedIds,
          detailOverrides,
          defaultDetailed: detailed,
          measuredHeights: nextMeasuredHeights,
        });
        scrollAnchorDelta = getViewportAnchorOffsetDelta({
          currentLayout,
          nextLayout,
          viewportTop: Math.max(0, viewport.scrollY - containerTop),
        });
      }

      measuredHeightsRef.current = nextMeasuredHeights;
      flushSync(() => {
        setMeasuredHeights(nextMeasuredHeights);
      });

      if (typeof window !== 'undefined' && !isTouchDevice && Math.abs(scrollAnchorDelta) > 2 && !suppressAnchoringRef.current) {
        window.scrollBy(0, scrollAnchorDelta);
      }
    }, [
      collapsedIds,
      containerTop,
      detailOverrides,
      detailed,
      index.rowsById,
      viewport.scrollY,
      visibleRowIds,
    ]);

    var handleRowHeightChange = useCallback((rowId, height, { immediate = false } = {}) => {
      const hadMeasuredHeight = measuredHeightsRef.current.has(rowId);
      pendingMeasuredHeightsRef.current.set(rowId, height);

      if (typeof window === 'undefined') {
        flushMeasuredHeights();
        return;
      }

      if (immediate) {
        if (heightFlushFrameRef.current) {
          window.cancelAnimationFrame(heightFlushFrameRef.current);
          heightFlushFrameRef.current = 0;
        }
        queueMicrotask(flushMeasuredHeights);
        return;
      }

      if (scrollingRef.current && hadMeasuredHeight) {
        return;
      }

      if (!heightFlushFrameRef.current) {
        heightFlushFrameRef.current = window.requestAnimationFrame(() => {
          flushMeasuredHeights();
        });
      }
    }, [flushMeasuredHeights]);

    useEffect(() => {
      resetMeasuredHeights();
    }, [index, resetMeasuredHeights]);

    useEffect(() => {
      if (typeof window === 'undefined') {
        return undefined;
      }

      scrollingRef.current = true;
      if (scrollIdleTimeoutRef.current) {
        window.clearTimeout(scrollIdleTimeoutRef.current);
      }

      scrollIdleTimeoutRef.current = window.setTimeout(() => {
        scrollIdleTimeoutRef.current = 0;
        scrollingRef.current = false;
        flushMeasuredHeights();
      }, 120);

      return undefined;
    }, [viewport.scrollY, flushMeasuredHeights]);

    useEffect(
      () => () => {
        if (heightFlushFrameRef.current && typeof window !== 'undefined') {
          window.cancelAnimationFrame(heightFlushFrameRef.current);
        }
        if (scrollIdleTimeoutRef.current && typeof window !== 'undefined') {
          window.clearTimeout(scrollIdleTimeoutRef.current);
        }
      },
      [],
    );

    useLayoutEffect(() => {
      const element = containerRef.current;
      if (!element || typeof window === 'undefined') {
        setContainerTop(0);
        return;
      }

      const nextTop = Math.round(element.getBoundingClientRect().top + window.scrollY);
      setContainerTop((current) => (current === nextTop ? current : nextTop));
    }, [index, viewport.layoutVersion]);

    var searchHighlightName = `search-match-all-${anchor}`;
    useEffect(() => {
      if (!searchQuery || !containerRef.current) {
        CSS.highlights?.delete(searchHighlightName);
        return;
      }
      const queryLower = searchQuery.toLowerCase();
      const currentRowId = searchMatch?.rowId ?? null;
      const ranges = [];
      const rowElements = containerRef.current.querySelectorAll('[id^="row-"]');
      for (const rowEl of rowElements) {
        if (currentRowId && rowEl.id === `row-${currentRowId}`) continue;
        const walker = document.createTreeWalker(rowEl, NodeFilter.SHOW_TEXT);
        let textNode = walker.nextNode();
        while (textNode) {
          const text = textNode.textContent.toLowerCase();
          let pos = 0;
          while (pos < text.length) {
            const idx = text.indexOf(queryLower, pos);
            if (idx === -1) break;
            const range = new Range();
            range.setStart(textNode, idx);
            range.setEnd(textNode, idx + queryLower.length);
            ranges.push(range);
            pos = idx + queryLower.length;
          }
          textNode = walker.nextNode();
        }
      }
      if (ranges.length && CSS.highlights) {
        CSS.highlights.set(searchHighlightName, new Highlight(...ranges));
      } else {
        CSS.highlights?.delete(searchHighlightName);
      }
    }, [searchHighlightName, searchQuery, searchMatch, virtualRows]);
    /* eslint-enable react-hooks/rules-of-hooks */
  }

  const resolveGhostFromCursor = useCallback((clientX, clientY) => {
    if (!__VIRTUALIZE__ || !containerRef?.current) {
      setGhostParentId(null);
      return;
    }

    const containerRect = containerRef.current.getBoundingClientRect();
    const mouseX = clientX - containerRect.left;
    const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const indentStepPx = 1.55 * rootFontSize;
    const hoveredDepth = Math.floor(mouseX / indentStepPx);

    if (mouseX < 0 || mouseX > (hoveredDepth + 1) * indentStepPx + 2.25 * rootFontSize) {
      setGhostParentId(null);
      setHoveredColumnDepth(-1);
      setColumnLineBottom(null);
      return;
    }

    let targetRow = null;
    let bestDistance = Infinity;
    for (const item of virtualRows.items) {
      const el = document.getElementById(`row-${item.rowId}`);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (rect.bottom < 0) continue;
      const distance = clientY < rect.top ? rect.top - clientY : clientY > rect.bottom ? clientY - rect.bottom : 0;
      if (distance < bestDistance) {
        bestDistance = distance;
        targetRow = index.rowsById.get(item.rowId);
        if (distance === 0) break;
      }
    }

    if (!targetRow || targetRow.depth < hoveredDepth) {
      setGhostParentId(null);
      setHoveredColumnDepth(-1);
      setColumnLineBottom(null);
      return;
    }

    let ancestor = targetRow;
    while (ancestor && ancestor.depth > hoveredDepth) {
      ancestor = index.rowsById.get(ancestor.parentId);
    }

    if (!ancestor || ancestor.depth !== hoveredDepth) {
      setGhostParentId(null);
      return;
    }

    const ancestorEl = document.getElementById(`row-${ancestor.id}`);
    const ancestorTop = ancestorEl?.getBoundingClientRect().top ?? -100;
    if (ancestorTop < -120) {
      setGhostParentId(ancestor.id);
      const isInnermostGhost = targetRow.depth <= hoveredDepth + 1;
      setHoveredColumnDepth(isInnermostGhost ? -1 : hoveredDepth);

      if (__VIRTUALIZE__ && virtualLayout) {
        const ancestorIndex = visibleRowIds.indexOf(ancestor.id);
        if (ancestorIndex >= 0) {
          let lastDescendantIndex = ancestorIndex;
          for (let i = ancestorIndex + 1; i < visibleRowIds.length; i++) {
            const r = index.rowsById.get(visibleRowIds[i]);
            if (!r || r.depth <= ancestor.depth) break;
            lastDescendantIndex = i;
          }
          setColumnLineBottom(virtualLayout.bottoms[lastDescendantIndex]);
        }
      }
    } else {
      setGhostParentId(null);
      setHoveredColumnDepth(-1);
      setColumnLineBottom(null);
    }
  }, [virtualRows, index.rowsById]);

  const handleTreeMouseMove = useCallback((event) => {
    lastCursorRef.current = { x: event.clientX, y: event.clientY };
    resolveGhostFromCursor(event.clientX, event.clientY);
  }, [resolveGhostFromCursor]);

  const handleTreeMouseLeave = useCallback(() => {
    if (!ghostParentId) {
      lastCursorRef.current = null;
      setHoveredColumnDepth(-1);
    }
  }, [ghostParentId]);

  useEffect(() => {
    if (!ghostParentId || typeof document === 'undefined') {
      return undefined;
    }

    const onDocMouseMove = (event) => {
      lastCursorRef.current = { x: event.clientX, y: event.clientY };
      resolveGhostFromCursor(event.clientX, event.clientY);
    };

    document.addEventListener('mousemove', onDocMouseMove, { passive: true });
    return () => {
      document.removeEventListener('mousemove', onDocMouseMove);
    };
  }, [ghostParentId, resolveGhostFromCursor]);

  useEffect(() => {
    const cursor = lastCursorRef.current;
    if (cursor) {
      resolveGhostFromCursor(cursor.x, cursor.y);
    }
  }, [__VIRTUALIZE__ ? viewport?.scrollY : null, resolveGhostFromCursor]);

  const scrollToRow = useCallback((rowId, { smooth = false } = {}) => {
    const el = document.getElementById(`row-${rowId}`);
    if (el) {
      el.scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'instant' });
    }
  }, []);

  const handleAnchorRow = useCallback((rowId) => {
    const hash = buildNodeAnchorHash(index.rowsById.get(rowId));
    if (hash) {
      history.replaceState(null, '', hash);
    }

    setHighlightedRowId(rowId);
    scrollToRow(rowId, { smooth: true });
    window.setTimeout(() => setHighlightedRowId(null), 3000);
  }, [index.rowsById, scrollToRow]);

  return (
    <CollapsibleSection
      label={label}
      title={title}
      defaultOpen
      anchor={anchor}
      actions={
        <SectionControls
          onExpandAll={handleExpandAll}
          onCollapseAll={handleCollapseAll}
        />
      }
    >
      {ghostParentId && typeof document !== 'undefined'
        ? createPortal(
            <GhostParentRow
              row={index.rowsById.get(ghostParentId)}
              containerLeft={__VIRTUALIZE__ && containerRef?.current ? containerRef.current.getBoundingClientRect().left : 0}
              onNavigate={() => {
                const targetId = ghostParentId;
                setGhostParentId(null);
                setHoveredColumnDepth(-1);
                setColumnLineBottom(null);
                lastCursorRef.current = null;
                scrollToRow(targetId);
              }}
            />,
            document.body,
          )
        : null}
      {visibleRowIds.length ? (
        __VIRTUALIZE__ ? (
          <div
            className={`${listClassName}${hoveredColumnDepth >= 0 ? ' tree-column-hovered' : ''}`}
            ref={containerRef}
            style={{ height: `${virtualRows.totalHeight}px`, '--hovered-column-x': `calc(${hoveredColumnDepth} * var(--tree-indent-step, 1.55rem) + var(--tree-control-center, 1.125rem))`, '--hovered-column-bottom': columnLineBottom != null ? `${virtualRows.totalHeight - columnLineBottom}px` : '0px' }}
            onMouseMove={handleTreeMouseMove}
            onMouseLeave={handleTreeMouseLeave}
          >
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
                  highlighted={row.id === highlightedRowId}
                  onToggleCollapsed={handleToggleCollapsed}
                  onToggleDetails={handleToggleDetails}
                  onSetRowState={handleSetRowState}
                  onAnchorRow={handleAnchorRow}
                  onDownloadError={onDownloadError}

                  onHeightChange={handleRowHeightChange}
                  virtualTop={top}
                  trimTopGuide={trimTopGuide}
                  trimBottomGuide={trimBottomGuide}
                />
              );
            })}
          </div>
        ) : (
          <div className={listClassName}>
            {visibleRowIds.map((rowId) => {
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
                  highlighted={row.id === highlightedRowId}
                  onToggleCollapsed={handleToggleCollapsed}
                  onToggleDetails={handleToggleDetails}
                  onSetRowState={handleSetRowState}
                  onAnchorRow={handleAnchorRow}
                  onDownloadError={onDownloadError}

                />
              );
            })}
          </div>
        )
      ) : (
        <EmptyState message={emptyMessage} />
      )}
      {visibleRowIds.length > 0 ? <ScrollToSectionTopButton anchor={anchor} /> : null}
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

function triggerBrowserDownload(href, fileName) {
  if (typeof document === 'undefined') {
    return;
  }

  const link = document.createElement('a');
  link.href = href;
  link.download = resolveDownloadFileName(fileName, href);
  link.rel = 'noreferrer';
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
}

async function triggerFileDownload(url, fileName) {
  if (!url || typeof window === 'undefined') {
    return;
  }

  let response;
  try {
    response = await fetch(url, { redirect: 'follow' });
  } catch {
    throw { reason: 'network', url, fileName };
  }

  if (!response.ok) {
    throw { reason: 'http', status: response.status, url, fileName };
  }

  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('text/html')) {
    throw { reason: 'html', url, fileName };
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  triggerBrowserDownload(objectUrl, fileName);
  window.setTimeout(() => {
    URL.revokeObjectURL(objectUrl);
  }, 60_000);
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

function parseNodeAnchor() {
  if (typeof window === 'undefined') {
    return null;
  }

  const hash = decodeURIComponent(window.location.hash.slice(1));
  if (!hash || hash === 'install') {
    return null;
  }

  const filesMatch = hash.match(/^files:(.+)/);
  if (filesMatch) {
    return { section: 'filesystem', rowId: `database:file:${filesMatch[1]}` };
  }

  const foldersMatch = hash.match(/^folders:(.+)/);
  if (foldersMatch) {
    return { section: 'filesystem', rowId: `database:folder:${foldersMatch[1]}`, altRowId: `database:missingfolder:${foldersMatch[1]}` };
  }

  const archiveFileMatch = hash.match(/^archives:([^:]+):files:(.+)/);
  if (archiveFileMatch) {
    return { section: 'archives', rowId: `archive:${archiveFileMatch[1]}:file:${archiveFileMatch[2]}` };
  }

  const archiveFolderMatch = hash.match(/^archives:([^:]+):folders:(.+)/);
  if (archiveFolderMatch) {
    return { section: 'archives', rowId: `archive:${archiveFolderMatch[1]}:folder:${archiveFolderMatch[2]}`, altRowId: `archive:${archiveFolderMatch[1]}:missingfolder:${archiveFolderMatch[2]}` };
  }

  const archiveMatch = hash.match(/^archives:(.+)/);
  if (archiveMatch) {
    return { section: 'archives', rowId: `archive:${archiveMatch[1]}` };
  }

  return null;
}

function buildNodeAnchorHash(row) {
  const id = row.id;
  if (row.type === 'archive') {
    const archiveId = id.replace(/^archive:/, '');
    return `#archives:${encodeURIComponent(archiveId)}`;
  }

  const archiveFileMatch = id.match(/^archive:([^:]+):file:(.+)/);
  if (archiveFileMatch) {
    return `#archives:${encodeURIComponent(archiveFileMatch[1])}:files:${encodeURIComponent(archiveFileMatch[2])}`;
  }

  const archiveFolderMatch = id.match(/^archive:([^:]+):(?:folder|missingfolder):(.+)/);
  if (archiveFolderMatch) {
    return `#archives:${encodeURIComponent(archiveFolderMatch[1])}:folders:${encodeURIComponent(archiveFolderMatch[2])}`;
  }

  const fileMatch = id.match(/^database:file:(.+)/);
  if (fileMatch) {
    return `#files:${encodeURIComponent(fileMatch[1])}`;
  }

  const folderMatch = id.match(/^database:(?:folder|missingfolder):(.+)/);
  if (folderMatch) {
    return `#folders:${encodeURIComponent(folderMatch[1])}`;
  }

  return null;
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

  return `Raw file sizes: ${formatBytes(storageSummary.rawBytes)}\n${storageSummary.rawBytes.toLocaleString()} bytes${suffix}`;
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

function ModalFrame({ label, title, onClose, footer, headerActions, children }) {
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
            <div className="modal-title-row">
              <h2>{title}</h2>
              {headerActions ?? null}
            </div>
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
  highlighted,
  onToggleCollapsed,
  onToggleDetails,
  onSetRowState,
  onAnchorRow,
  onDownloadError,
  onHeightChange,
  virtualTop,
  trimTopGuide,
  trimBottomGuide,
}) {
  if (__VIRTUALIZE__) {
    /* eslint-disable react-hooks/rules-of-hooks -- __VIRTUALIZE__ is a build-time constant */
    var rowRef = useRef(null);
    var previousMeasurementSignatureRef = useRef(null);
    var virtualStyle = useMemo(
      () =>
        buildVirtualRowStyle(virtualTop, {
          trimTopGuide,
          trimBottomGuide,
        }),
      [trimBottomGuide, trimTopGuide, virtualTop],
    );
    /* eslint-enable react-hooks/rules-of-hooks */
  }
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
  const titleTooltip = showIdentifier ? `${title}\n${identifierLabel}: ${identifier}` : title;
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
    highlighted ? 'tree-entry-highlighted' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const Container = isArchive ? 'article' : 'div';

  if (__VIRTUALIZE__) {
    /* eslint-disable react-hooks/rules-of-hooks -- __VIRTUALIZE__ is a build-time constant */
    useLayoutEffect(() => {
      const element = rowRef.current;
      if (!element) {
        return undefined;
      }

      const measurementSignature = `${collapsed ? '1' : '0'}:${detailsVisible ? '1' : '0'}`;
      const measurementKey = getRowMeasurementKey(row.id, { collapsed, detailsVisible });
      const previousMeasurementSignature = previousMeasurementSignatureRef.current;
      const shouldFlushImmediately =
        previousMeasurementSignature !== null && previousMeasurementSignature !== measurementSignature;
      previousMeasurementSignatureRef.current = measurementSignature;

      const reportHeight = (immediate = false) => {
        onHeightChange(measurementKey, Math.ceil(element.getBoundingClientRect().height), { immediate });
      };

      reportHeight(shouldFlushImmediately);

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
    /* eslint-enable react-hooks/rules-of-hooks */
  }

  const handleToggleRowDetails = () => {
    if (isFile && collapsed && !detailsVisible) {
      onSetRowState(row.id, {
        collapsed: false,
        detailsVisible: true,
      });
      return;
    }

    onToggleDetails(row.id);
  };

  const handleToggleRowCollapsed = () => {
    if (isFile && !collapsed && detailsVisible) {
      onSetRowState(row.id, {
        collapsed: true,
        detailsVisible: false,
      });
      return;
    }

    onToggleCollapsed(row.id);
  };

  const handleDownload = () => {
    triggerFileDownload(downloadUrl, row.node.name).catch((error) => {
      onDownloadError?.({ url: downloadUrl, ...(error && typeof error === 'object' ? error : {}) });
    });
  };

  return (
    <Container
      id={`row-${row.id}`}
      ref={__VIRTUALIZE__ ? rowRef : undefined}
      className={containerClassName}
      style={__VIRTUALIZE__ ? { ...buildTreeDepthStyle(row.depth), ...virtualStyle } : buildTreeDepthStyle(row.depth)}
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
              <button
                type="button"
                className="copy-link-button"
                onClick={() => onAnchorRow(row.id)}
              >
                <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="m7.775 3.275 1.25-1.25a3.5 3.5 0 1 1 4.95 4.95l-2.5 2.5a3.5 3.5 0 0 1-4.95 0 .751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018 1.998 1.998 0 0 0 2.83 0l2.5-2.5a2.002 2.002 0 0 0-2.83-2.83l-1.25 1.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042Zm-4.69 9.64a1.998 1.998 0 0 0 2.83 0l1.25-1.25a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042l-1.25 1.25a3.5 3.5 0 1 1-4.95-4.95l2.5-2.5a3.5 3.5 0 0 1 4.95 0 .751.751 0 0 1-.018 1.042.751.751 0 0 1-1.042.018 1.998 1.998 0 0 0-2.83 0l-2.5 2.5a1.998 1.998 0 0 0 0 2.83Z"/></svg>
              </button>
              <h3 onMouseEnter={(e) => {
                const h3 = e.currentTarget;
                const heading = h3.closest('.tree-heading');
                const row = h3.closest('.tree-title-row');
                const nameTruncated = h3.scrollWidth > h3.clientWidth;
                const idCode = row.querySelector('.tree-identifier-inline code');
                const pathTruncated = idCode ? idCode.scrollWidth > idCode.clientWidth : false;
                heading.classList.toggle('tooltip-hidden', !nameTruncated && !pathTruncated);
                heading.classList.toggle('tooltip-name-hidden', !nameTruncated && pathTruncated);
                if (nameTruncated || pathTruncated) {
                  const rect = heading.getBoundingClientRect();
                  heading.style.setProperty('--tooltip-x', `${e.clientX - rect.left}px`);
                  heading.classList.toggle('tooltip-below', rect.top < 80);
                }
              }}>{title}</h3>
              {showIdentifier ? (
                <span className="tree-identifier-inline">
                  <span className="tree-identifier-label">{identifierLabel}</span>
                  <code>{identifier}</code>
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
            <span className="tree-title-tooltip">
              <span>{title}</span>
              {showIdentifier ? (
                <span className="tree-title-tooltip-path">
                  <span className="tree-identifier-label">{identifierLabel}</span>
                  {' '}
                  <code>{identifier}</code>
                </span>
              ) : null}
            </span>
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

function GhostParentRow({ row, containerLeft, onNavigate }) {
  if (!row) return null;
  const isArchive = row.type === 'archive';
  const title = isArchive ? row.archive.title : row.node.name;
  const badge = isArchive ? 'ZIP' : row.node.badge;
  const badgeClassName = isArchive
    ? 'node-badge archive-badge'
    : `node-badge ${row.node.kind === 'file' ? 'file-badge' : 'folder-badge'}`;

  const rootFontSize = typeof document !== 'undefined'
    ? parseFloat(getComputedStyle(document.documentElement).fontSize)
    : 16;
  const indentPx = row.depth * 1.55 * rootFontSize;
  const controlCenterPx = (2.25 / 2) * rootFontSize;
  const linePx = (containerLeft || 0) + indentPx + controlCenterPx;

  return (
    <div
      className="ghost-parent-row"
      style={{ '--ghost-line-x': `${linePx}px` }}
      onClick={onNavigate}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onNavigate();
      }}
    >
      <div className="ghost-badge-stack">
        <span className={badgeClassName}>{badge}</span>
        <span className="ghost-nav-arrow" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
            <path d="M3.22 9.78a.749.749 0 0 1 0-1.06l4.25-4.25a.749.749 0 0 1 1.06 0l4.25 4.25a.749.749 0 1 1-1.06 1.06L8 6.06 4.28 9.78a.749.749 0 0 1-1.06 0Z" />
          </svg>
        </span>
      </div>
      <span className="ghost-parent-name">{title}</span>
    </div>
  );
}

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

function setSetMembership(currentSet, value, shouldHave) {
  const hasValue = currentSet.has(value);
  if (hasValue === shouldHave) {
    return currentSet;
  }

  const next = new Set(currentSet);
  if (shouldHave) {
    next.add(value);
  } else {
    next.delete(value);
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

function setDetailVisibilityOverride(currentMap, rowId, nextVisible, defaultDetailed) {
  const currentVisible = currentMap.get(rowId) ?? defaultDetailed;
  if (currentVisible === nextVisible) {
    return currentMap;
  }

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

function getRowMeasurementKey(rowId, { collapsed, detailsVisible }) {
  return `${rowId}:${collapsed ? '1' : '0'}:${detailsVisible ? '1' : '0'}`;
}

function useGlobalSearch({ filesystemIndex, archivesIndex, tagDictionary, hasEssentialHint, hasInspection }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const [token, setToken] = useState(0);

  const matches = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return [];
    const result = [];

    const searchIndex = (index, section) => {
      if (!index) return;
      for (const [id, row] of index.rowsById) {
        const name = (row.type === 'archive' ? row.archive.title : row.node.name) || '';
        const path = row.type !== 'archive' ? row.node.path || '' : '';
        if (name.toLowerCase().includes(trimmed)) {
          result.push({ rowId: id, section, matchPart: 'name' });
        } else if (path && path !== name && path.toLowerCase().includes(trimmed)) {
          result.push({ rowId: id, section, matchPart: 'path' });
        } else {
          const fields = row.type === 'archive' ? row.archive.primaryFields : row.node.primaryFields;
          const hasTagMatch = fields?.some(
            (f) => f.kind === 'tags' && Array.isArray(f.value) && f.value.some((t) => t.label.toLowerCase().includes(trimmed)),
          );
          if (hasTagMatch) {
            result.push({ rowId: id, section, matchPart: 'tags' });
          }
        }
      }
    };

    if (hasEssentialHint && 'essential'.includes(trimmed)) {
      result.push({ rowId: 'filter-essential-hint', section: 'filter', matchPart: 'name' });
    }

    searchIndex(filesystemIndex, 'filesystem');
    searchIndex(archivesIndex, 'archives');

    if (tagDictionary.length) {
      for (const tag of tagDictionary) {
        if (tag.name.toLowerCase().includes(trimmed)) {
          result.push({ rowId: `tagdict-${tag.name}-${tag.index}`, section: 'tags', matchPart: 'name' });
        }
      }
    }

    return result;
  }, [query, filesystemIndex, archivesIndex, tagDictionary, hasEssentialHint]);

  const clampedIndex = matches.length ? currentMatchIndex % matches.length : 0;
  const trimmedQuery = query.trim();
  const currentMatch = useMemo(
    () =>
      matches.length
        ? { rowId: matches[clampedIndex].rowId, section: matches[clampedIndex].section, matchPart: matches[clampedIndex].matchPart, query: trimmedQuery, token }
        : null,
    [matches, clampedIndex, trimmedQuery, token],
  );

  useEffect(() => {
    setCurrentMatchIndex(0);
    setToken((t) => t + 1);
  }, [matches]);

  const [focusToken, setFocusToken] = useState(0);
  const openSearch = useCallback(() => {
    const saved = sessionStorage.getItem('findBarQuery') || '';
    if (saved) setQuery(saved);
    setOpen(true);
    setFocusToken((t) => t + 1);
  }, []);
  const closeSearch = useCallback(() => {
    const trimmed = query.trim();
    if (trimmed) {
      sessionStorage.setItem('findBarQuery', trimmed);
    }
    setOpen(false);
    setQuery('');
    CSS.highlights?.delete('search-match');
    CSS.highlights?.delete('search-match-all-filter');
    CSS.highlights?.delete('search-match-all-files');
    CSS.highlights?.delete('search-match-all-archives');
    CSS.highlights?.delete('search-match-all-tags');
  }, [query]);

  const goToNextMatch = useCallback(() => {
    if (!matches.length) return;
    setToken((t) => t + 1);
    setCurrentMatchIndex((i) => (i + 1) % matches.length);
  }, [matches.length]);

  const goToPrevMatch = useCallback(() => {
    if (!matches.length) return;
    setToken((t) => t + 1);
    setCurrentMatchIndex((i) => (i - 1 + matches.length) % matches.length);
  }, [matches.length]);

  const jumpToMatch = useCallback((oneBasedIndex) => {
    if (!matches.length) return;
    const clamped = Math.max(0, Math.min(matches.length - 1, oneBasedIndex - 1));
    setToken((t) => t + 1);
    setCurrentMatchIndex(clamped);
  }, [matches.length]);

  const openRef = useRef(open);
  openRef.current = open;
  const closeSearchRef = useRef(closeSearch);
  closeSearchRef.current = closeSearch;
  const openSearchRef = useRef(openSearch);
  openSearchRef.current = openSearch;

  useEffect(() => {
    if (!hasInspection) return undefined;

    const onKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'f') {
        event.preventDefault();
        if (!openRef.current) {
          openSearchRef.current();
        } else {
          setFocusToken((t) => t + 1);
        }
      }
      if (event.key === 'Escape' && openRef.current) {
        closeSearchRef.current();
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [hasInspection]);

  return {
    open,
    query,
    setQuery,
    focusToken,
    currentMatchIndex: clampedIndex,
    totalMatches: matches.length,
    currentMatch,
    activeQuery: open ? trimmedQuery : '',
    openSearch,
    closeSearch,
    goToNextMatch,
    goToPrevMatch,
    jumpToMatch,
  };
}

const FindBar = memo(function FindBar({
  query,
  onQueryChange,
  focusToken,
  currentIndex,
  totalMatches,
  onNext,
  onPrev,
  onJumpTo,
  onClose,
}) {
  const inputRef = useRef(null);
  const [editingIndex, setEditingIndex] = useState(false);
  const [indexDraft, setIndexDraft] = useState('');
  const indexInputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusToken]);

  const handleKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (event.shiftKey) {
        onPrev();
      } else {
        onNext();
      }
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
    if (event.key === 'F3') {
      event.preventDefault();
      if (event.shiftKey) {
        onPrev();
      } else {
        onNext();
      }
    }
  };

  const commitIndexEdit = () => {
    const parsed = parseInt(indexDraft, 10);
    if (parsed >= 1 && parsed <= totalMatches) {
      onJumpTo(parsed);
    }
    setEditingIndex(false);
  };

  const handleIndexKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitIndexEdit();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setEditingIndex(false);
      inputRef.current?.focus();
    }
  };

  const startEditingIndex = () => {
    if (!totalMatches) return;
    setIndexDraft(String(currentIndex + 1));
    setEditingIndex(true);
    requestAnimationFrame(() => {
      indexInputRef.current?.focus();
      indexInputRef.current?.select();
    });
  };

  return createPortal(
    <div className="find-bar" role="search" aria-label="Find in tree">
      <input
        ref={inputRef}
        type="text"
        className="find-bar-input"
        placeholder="Find in tree..."
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={handleKeyDown}
        aria-label="Search text"
      />
      {editingIndex ? (
        <span className="find-bar-count">
          <input
            ref={indexInputRef}
            type="number"
            className="find-bar-index-input"
            min={1}
            max={totalMatches}
            value={indexDraft}
            onChange={(event) => setIndexDraft(event.target.value)}
            onKeyDown={handleIndexKeyDown}
            onBlur={commitIndexEdit}
            aria-label="Jump to match number"
          />
          {' of '}
          {totalMatches}
        </span>
      ) : (
        <span className="find-bar-count" aria-live="polite" onClick={startEditingIndex} role={totalMatches ? 'button' : undefined} tabIndex={totalMatches ? 0 : undefined}>
          {query.trim() ? `${totalMatches ? currentIndex + 1 : 0} of ${totalMatches}` : ''}
        </span>
      )}
      <button type="button" className="find-bar-button" onClick={onPrev} aria-label="Previous match" disabled={!totalMatches}>
        &#x25B2;
      </button>
      <button type="button" className="find-bar-button" onClick={onNext} aria-label="Next match" disabled={!totalMatches}>
        &#x25BC;
      </button>
      <button type="button" className="find-bar-button find-bar-close" onClick={onClose} aria-label="Close search">
        &#x2715;
      </button>
    </div>,
    document.body,
  );
});

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

function buildVirtualRowLayout({
  rowIds,
  rowsById,
  collapsedIds,
  detailOverrides,
  defaultDetailed,
  measuredHeights,
}) {
  if (!rowIds.length) {
    return {
      rowIds: [],
      rowIndexById: new Map(),
      offsets: [],
      bottoms: [],
      totalHeight: 0,
    };
  }

  const offsets = new Array(rowIds.length);
  const bottoms = new Array(rowIds.length);
  const rowIndexById = new Map();
  let totalHeight = 0;

  for (let index = 0; index < rowIds.length; index += 1) {
    const rowId = rowIds[index];
    const row = rowsById.get(rowId);
    rowIndexById.set(rowId, index);
    const collapsed = collapsedIds.has(rowId);
    const detailsVisible = detailOverrides.get(rowId) ?? defaultDetailed;
    const measuredHeight = measuredHeights.get(
      getRowMeasurementKey(rowId, { collapsed, detailsVisible }),
    );
    const rowHeight =
      measuredHeight ?? estimateRowHeight(row, { collapsed, detailsVisible });

    offsets[index] = totalHeight;
    bottoms[index] = totalHeight + rowHeight;
    totalHeight += rowHeight;

    if (index < rowIds.length - 1) {
      totalHeight += TREE_LIST_GAP_PX;
    }
  }

  return {
    rowIds,
    rowIndexById,
    offsets,
    bottoms,
    totalHeight,
  };
}

function buildVirtualRows({
  layout,
  rowsById,
  containerTop,
  scrollY,
  viewportHeight,
}) {
  if (!layout.rowIds.length) {
    return {
      totalHeight: 0,
      items: [],
    };
  }

  const { rowIds, rowIndexById, offsets, bottoms, totalHeight } = layout;
  const viewportTop = scrollY - containerTop - TREE_OVERSCAN_PX;
  const viewportBottom = scrollY + viewportHeight - containerTop + TREE_OVERSCAN_PX;
  const startIndex = lowerBound(bottoms, viewportTop);
  const endIndex = Math.min(rowIds.length, upperBound(offsets, viewportBottom));

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

function getViewportAnchorOffsetDelta({ currentLayout, nextLayout, viewportTop }) {
  if (!currentLayout.rowIds.length || !nextLayout.rowIds.length) {
    return 0;
  }

  const anchorIndex = Math.min(
    currentLayout.rowIds.length - 1,
    lowerBound(currentLayout.bottoms, viewportTop),
  );
  const anchorRowId = currentLayout.rowIds[anchorIndex];
  const nextAnchorIndex = nextLayout.rowIndexById.get(anchorRowId);

  if (nextAnchorIndex == null) {
    return 0;
  }

  return nextLayout.offsets[nextAnchorIndex] - currentLayout.offsets[anchorIndex];
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

function extractGitHubRepo(source) {
  const url = source.requestedUrl || source.sourceLabel;
  if (!url) return null;
  let match = url.match(/raw\.githubusercontent\.com\/([^/]+\/[^/]+)/);
  if (match) return match[1];
  match = url.match(/github\.com\/([^/]+\/[^/]+)/);
  if (match) return match[1].replace(/\.git$/, '');
  return null;
}

function GitHubRepoLink({ source, dbId }) {
  const repo = extractGitHubRepo(source);
  if (!repo) return null;

  const label = repo === dbId ? 'Source repository' : repo;

  return (
    <a
      className="github-repo-link"
      href={`https://github.com/${repo}`}
      target="_blank"
      rel="noreferrer"
      title={repo}
    >
      <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
      </svg>
      {label}
    </a>
  );
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


function TagDictionary({ tags, searchQuery, searchMatch }) {
  const [open, setOpen] = useState(true);
  const cloudRef = useRef(null);

  useEffect(() => {
    if (!searchQuery || !cloudRef.current) {
      CSS.highlights?.delete('search-match-all-tags');
      return;
    }
    const queryLower = searchQuery.toLowerCase();
    const currentPillId = searchMatch?.rowId ?? null;
    const ranges = [];
    const pills = cloudRef.current.querySelectorAll('.dictionary-pill');
    for (const pill of pills) {
      if (currentPillId && pill.id === currentPillId) continue;
      const walker = document.createTreeWalker(pill, NodeFilter.SHOW_TEXT);
      let textNode = walker.nextNode();
      while (textNode) {
        const text = textNode.textContent.toLowerCase();
        let pos = 0;
        while (pos < text.length) {
          const idx = text.indexOf(queryLower, pos);
          if (idx === -1) break;
          const range = new Range();
          range.setStart(textNode, idx);
          range.setEnd(textNode, idx + queryLower.length);
          ranges.push(range);
          pos = idx + queryLower.length;
        }
        textNode = walker.nextNode();
      }
    }
    if (ranges.length && CSS.highlights) {
      CSS.highlights.set('search-match-all-tags', new Highlight(...ranges));
    } else {
      CSS.highlights?.delete('search-match-all-tags');
    }
  }, [searchQuery, searchMatch, tags]);

  const navigateToTagPill = useCallback((match) => {
    requestAnimationFrame(() => {
      const pill = document.getElementById(match.rowId);
      if (!pill) return;
      const rect = pill.getBoundingClientRect();
      const inViewport = rect.top >= 0 && rect.bottom <= window.innerHeight;
      if (!inViewport) {
        pill.scrollIntoView({ block: 'center' });
      }
      if (!CSS.highlights) return;
      CSS.highlights.delete('search-match');
      const queryLower = (match.query || '').toLowerCase();
      if (!queryLower) return;
      const ranges = [];
      const walker = document.createTreeWalker(pill, NodeFilter.SHOW_TEXT);
      let textNode = walker.nextNode();
      while (textNode) {
        const text = textNode.textContent.toLowerCase();
        let pos = 0;
        while (pos < text.length) {
          const idx = text.indexOf(queryLower, pos);
          if (idx === -1) break;
          const range = new Range();
          range.setStart(textNode, idx);
          range.setEnd(textNode, idx + queryLower.length);
          ranges.push(range);
          pos = idx + queryLower.length;
        }
        textNode = walker.nextNode();
      }
      if (ranges.length) {
        CSS.highlights.set('search-match', new Highlight(...ranges));
      }
    });
  }, []);

  const pendingSearchMatchRef = useRef(null);

  useEffect(() => {
    if (!searchMatch) return;
    if (!open) {
      pendingSearchMatchRef.current = searchMatch;
      setOpen(true);
      return;
    }
    navigateToTagPill(searchMatch);
  }, [searchMatch?.token]);

  useEffect(() => {
    if (!open || !pendingSearchMatchRef.current) return;
    const pending = pendingSearchMatchRef.current;
    pendingSearchMatchRef.current = null;
    requestAnimationFrame(() => navigateToTagPill(pending));
  }, [open]);

  return (
    <CollapsibleSection
      label="Tags"
      title="Filter terms"
      className="tag-dictionary"
      open={open}
      onToggle={setOpen}
      anchor="tags"
    >
      <p className="dictionary-meta">{tags.length} entries</p>
      {tags.length ? (
        <div className="tag-cloud" ref={cloudRef}>
          {tags.map((tag) => (
            <span key={`${tag.name}:${tag.index}`} id={`tagdict-${tag.name}-${tag.index}`} className="dictionary-pill">
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

function ScrollToSectionTopButton({ anchor }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const update = () => {
      const section = document.getElementById(`section-${anchor}`);
      if (!section) { setVisible(false); return; }
      const rect = section.getBoundingClientRect();
      setVisible(rect.top < -120 && rect.height > window.innerHeight);
    };

    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update, { passive: true });
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [anchor]);

  if (!visible) return null;

  return (
    <div className="scroll-to-section-top-track">
      <button
        type="button"
        className="scroll-to-section-top"
        aria-label="Scroll to top of section"
        onClick={() => {
          document.getElementById(`section-${anchor}`)?.scrollIntoView({ block: 'start' });
        }}
      >
        <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor">
          <path d="M3.22 9.78a.749.749 0 0 1 0-1.06l4.25-4.25a.749.749 0 0 1 1.06 0l4.25 4.25a.749.749 0 1 1-1.06 1.06L8 6.06 4.28 9.78a.749.749 0 0 1-1.06 0Z" />
        </svg>
      </button>
    </div>
  );
}

function SectionAnchor({ anchor }) {
  return (
    <button
      type="button"
      className="section-anchor-button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        history.replaceState(null, '', `#${anchor}`);
        const section = event.currentTarget.closest('.panel, .overview-panel');
        if (section) {
          if (section.tagName === 'DETAILS' && !section.open) {
            section.open = true;
          }
          section.scrollIntoView({ block: 'start', behavior: 'smooth' });
        }
      }}
    >
      <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="m7.775 3.275 1.25-1.25a3.5 3.5 0 1 1 4.95 4.95l-2.5 2.5a3.5 3.5 0 0 1-4.95 0 .751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018 1.998 1.998 0 0 0 2.83 0l2.5-2.5a2.002 2.002 0 0 0-2.83-2.83l-1.25 1.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042Zm-4.69 9.64a1.998 1.998 0 0 0 2.83 0l1.25-1.25a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042l-1.25 1.25a3.5 3.5 0 1 1-4.95-4.95l2.5-2.5a3.5 3.5 0 0 1 4.95 0 .751.751 0 0 1-.018 1.042.751.751 0 0 1-1.042.018 1.998 1.998 0 0 0-2.83 0l-2.5 2.5a1.998 1.998 0 0 0 0 2.83Z"/></svg>
    </button>
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
  anchor,
}) {
  return (
    <details
      id={anchor ? `section-${anchor}` : undefined}
      className={className ? `panel collapsible-panel ${className}` : 'panel collapsible-panel'}
      open={open ?? defaultOpen}
      onToggle={(event) => onToggle?.(event.currentTarget.open)}
    >
      <summary className="section-summary">
        <div>
          <p className="section-label">{label}</p>
          <h2>
            {anchor ? (
              <SectionAnchor anchor={anchor} />
            ) : null}
            {title}
          </h2>
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
      className={tag.rawLabel ? 'tag-chip has-tooltip' : 'tag-chip'}
      onMouseEnter={tag.rawLabel ? (e) => {
        e.currentTarget.classList.toggle('tooltip-below', e.currentTarget.getBoundingClientRect().top < 80);
      } : undefined}
    >
      {tag.label}
      {tag.rawLabel ? <span className="chip-tooltip">Tag {tag.rawLabel}</span> : null}
    </span>
  );
}

function EmptyState({ message }) {
  return <p className="empty-state">{message}</p>;
}

function SectionControls({
  onExpandAll,
  onCollapseAll,
}) {
  return (
    <div className="section-controls">
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
