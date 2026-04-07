import {
  memo,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  applyInspectionFilter,
  formatBytes,
  loadDatabaseSourceFile,
  loadDatabaseSourceUrl,
  loadRuntimeDatabaseCatalog,
  summarizeInspectionStorage,
} from './lib/database.js';
import {
  DATABASE_URL_PARAM,
  FILTER_URL_PARAM,
  DETAILED_URL_PARAM,
  FILTER_INPUT_DEBOUNCE_MS,
  DEFAULT_CLUSTER_SIZE_BYTES,
  CLUSTER_SIZE_OPTIONS,
  normalizeFilterPromptValue,
  resolveEffectiveDefaultFilter,
  normalizeComparableUrl,
  buildFilterSummaryCopy,
  buildRawByteHoverCopy,
  getLoadedSourceUrl,
  createCatalogEntriesFromLoadedSource,
  mergeCustomCatalogEntries,
  mergeCatalogEntries,
  readDatabaseUrlSearchParam,
  readFilterSearchParam,
  writeDatabaseUrlSearchParam,
  writeFilterSearchParam,
  isFileDragEvent,
  runAfterNextPaint,
  parseNodeAnchor,
  resolveInheritedFilterValue,
  buildFlatNodeIndex,
  buildFlatArchiveIndex,
} from './lib/utils.js';
import useDebouncedValue from './hooks/useDebouncedValue.js';
import useGlobalSearch from './hooks/useGlobalSearch.js';
import CatalogPickerModal from './components/modals/CatalogPickerModal.jsx';
import IniPickerModal from './components/modals/IniPickerModal.jsx';
import FilterOverrideModal from './components/modals/FilterOverrideModal.jsx';
import InstallModal from './components/modals/InstallModal.jsx';
import DownloadErrorModal from './components/modals/DownloadErrorModal.jsx';
import FilesystemSection from './components/tree/FilesystemSection.jsx';
import ArchiveSummariesSection from './components/tree/ArchiveSummariesSection.jsx';
import TagDictionary from './components/TagDictionary.jsx';
import FindBar from './components/FindBar.jsx';
import CollapsibleSection from './components/ui/CollapsibleSection.jsx';
import MetadataCard from './components/ui/MetadataCard.jsx';
import HighlightCard from './components/ui/HighlightCard.jsx';
import DetailedToggle from './components/ui/DetailedToggle.jsx';
import SectionAnchor from './components/ui/SectionAnchor.jsx';
import GitHubRepoLink from './components/ui/GitHubRepoLink.jsx';
import EmptyState from './components/ui/EmptyState.jsx';

console.log('[DB Inspector] Tree virtualization:', __VIRTUALIZE__ ? 'enabled' : 'disabled');

const EMPTY_TAGS = [];

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
  const tagDictionary = displayedInspection?.overview.tagDictionary ?? EMPTY_TAGS;
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

    const scrollY = window.scrollY;
    const previousBodyStyle = {
      position: document.body.style.position,
      top: document.body.style.top,
      width: document.body.style.width,
      overflow: document.body.style.overflow,
    };

    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = '100%';
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
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.position = previousBodyStyle.position;
      document.body.style.top = previousBodyStyle.top;
      document.body.style.width = previousBodyStyle.width;
      document.body.style.overflow = previousBodyStyle.overflow;
      window.scrollTo(0, scrollY);
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
    document.activeElement?.blur?.();
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
          <button
            type="button"
            className="dropzone-surface"
            onClick={() => {
              document.activeElement?.blur?.();
              fileInputRef.current?.click();
            }}
          >
            <span className="dropzone-note">Drop database files here</span>
            <span className="dropzone-hint">or click to choose a file from disk</span>
            <span className="dropzone-action">Choose file</span>
          </button>
          <input
            id="database-file-input"
            ref={fileInputRef}
            style={{ display: 'none' }}
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
              onClick={() => {
                document.activeElement?.blur?.();
                setCatalogModalOpen(true);
              }}
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
