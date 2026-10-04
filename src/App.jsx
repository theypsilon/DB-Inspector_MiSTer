import { startTransition, useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { parseNodeAnchor, writeDetailedSearchParam, readDetailedSearchParam } from './lib/urlState.js';
import { DEFAULT_CLUSTER_SIZE_BYTES, buildCombinedFilterSummaryCopy, collectTextMatchRanges, runAfterNextPaint } from './lib/utils.js';
import { createAppModel } from './model/appModel.js';
import {
  selectCatalogOptions,
  selectCatalogStatus,
  selectChoice,
  selectEffectiveDefaultFilter,
  selectInspection,
  selectInspectionKeyBase,
  selectIsCombined,
} from './model/selectors.js';
import {
  buildArchivesIndex,
  buildCollisionsIndex,
  buildCombinedView,
  buildDisplayedInspection,
  buildFilesystemIndex,
  buildStorageSummary,
  buildTagGroups,
  canResetFilter,
  hasEssentialTag,
  hasUntaggedRows,
  selectInspectionKey,
  selectTagDictionary,
} from './model/views.js';
import useFileDropzone from './hooks/useFileDropzone.js';
import useGlobalSearch from './hooks/useGlobalSearch.js';
import CatalogPickerModal from './components/modals/CatalogPickerModal.jsx';
import SourcePickerModal from './components/modals/SourcePickerModal.jsx';
import ReplaceLoadedModal from './components/modals/ReplaceLoadedModal.jsx';
import FilterOverrideModal from './components/modals/FilterOverrideModal.jsx';
import InstallModal from './components/modals/InstallModal.jsx';
import DownloadErrorModal from './components/modals/DownloadErrorModal.jsx';
import FilesystemSection from './components/tree/FilesystemSection.jsx';
import ArchiveSummariesSection from './components/tree/ArchiveSummariesSection.jsx';
import TagDictionary from './components/TagDictionary.jsx';
import FindBar from './components/FindBar.jsx';
import SourceLoaders from './components/SourceLoaders.jsx';
import ChoicePanel from './components/ChoicePanel.jsx';
import ErrorPanel from './components/ErrorPanel.jsx';
import DatabaseOverview from './components/DatabaseOverview.jsx';
import FilterPanel from './components/FilterPanel.jsx';
import IssuesSection from './components/IssuesSection.jsx';
import CombinedOverview from './components/CombinedOverview.jsx';
import CombinedFilterPanel from './components/CombinedFilterPanel.jsx';
import CollisionsSection from './components/tree/CollisionsSection.jsx';
import LoadModeModal from './components/modals/LoadModeModal.jsx';

const FIND_SHORTCUT_LABEL =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘F' : 'Ctrl+F';

// The page. Its state and what changes it live in the app model (src/model/appModel.js); this
// renders that state, forwards user actions to it, and keeps what only the page needs: the
// detailed toggle, tooltips, find-in-page, anchors, scrolling, and the install and download dialogs.
export default function App() {
  const fileInputRef = useRef(null);
  const [model] = useState(createAppModel);
  // The model's changes render as state updates of the page, batched with its own, and each render
  // the page commits is reported back to the model (see createAppModel).
  const [state, setModelState] = useState(model.getState);
  useLayoutEffect(() => {
    const unsubscribe = model.subscribe(() => setModelState(model.getState()));
    setModelState(model.getState());
    return unsubscribe;
  }, [model]);
  useLayoutEffect(() => {
    model.commit(state);
  });
  const {
    databaseUrl,
    loadingMessage,
    addingMessage,
    errorMessage,
    databases,
    filterInput,
    debouncedFilterInput,
    combinedFilters,
    debouncedCombinedFilters,
    choicePickerOpen,
    catalogModalOpen,
    runtimeCatalog,
    prompt,
  } = state;
  const inspection = selectInspection(state);
  const isCombined = selectIsCombined(state);
  const choice = selectChoice(state);
  const inspectionKeyBase = selectInspectionKeyBase(state);
  const inspectionKey = selectInspectionKey(state);
  const effectiveDefaultFilter = selectEffectiveDefaultFilter(state);
  const catalogOptions = selectCatalogOptions(state);
  const catalogReady = catalogOptions.length > 0;
  const catalogDisplayStatus = selectCatalogStatus(state);
  const [clusterSizeBytes, setClusterSizeBytes] = useState(DEFAULT_CLUSTER_SIZE_BYTES);
  const [databaseDetailed, setDatabaseDetailed] = useState(readDetailedSearchParam);
  const [installModalOpen, setInstallModalOpen] = useState(false);
  const [downloadError, setDownloadError] = useState(null);
  const [installDbId, setInstallDbId] = useState(null);
  const [nodeAnchor, setNodeAnchor] = useState(null);
  const dropzone = useFileDropzone(model.openDrop);
  const handleDatabaseDetailedChange = useCallback((next) => {
    startTransition(() => {
      setDatabaseDetailed(next);
    });
    writeDetailedSearchParam(next);
  }, []);
  const handleDownloadError = useCallback((error) => {
    setDownloadError(error);
  }, []);
  const displayedInspection = useMemo(
    () => buildDisplayedInspection(inspection, debouncedFilterInput),
    [inspection, debouncedFilterInput],
  );
  const combinedView = useMemo(
    () => buildCombinedView(databases, debouncedCombinedFilters),
    [databases, debouncedCombinedFilters],
  );
  const activeView = combinedView ?? displayedInspection;
  const isFiltering = combinedView ? combinedView.isFiltering : Boolean(displayedInspection?.activeFilter.isFiltering);
  const filesystemIndex = useMemo(() => buildFilesystemIndex(activeView), [activeView]);
  const archivesIndex = useMemo(() => buildArchivesIndex(activeView), [activeView]);
  const collisionsIndex = useMemo(() => buildCollisionsIndex(combinedView), [combinedView]);
  const storageSummary = useMemo(
    () => buildStorageSummary({ combinedView, displayedInspection, clusterSizeBytes }),
    [clusterSizeBytes, combinedView, displayedInspection],
  );
  const filterPending = filterInput !== debouncedFilterInput;
  const tagDictionary = selectTagDictionary(displayedInspection);
  const tagGroups = useMemo(() => buildTagGroups(combinedView, tagDictionary), [combinedView, tagDictionary]);
  const hasEssentialHint = hasEssentialTag(tagGroups);
  const hasUntaggedItems = useMemo(() => hasUntaggedRows(filesystemIndex), [filesystemIndex]);
  const globalSearch = useGlobalSearch({
    filesystemIndex,
    archivesIndex,
    collisionsIndex,
    tagGroups,
    hasEssentialHint,
    hasInspection: !!activeView,
  });

  // Effect Events run only when the dependencies listed on their effects change, and read
  // everything else as of that render.
  const highlightFilterMatch = useEffectEvent(() => {
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
    const ranges = collectTextMatchRanges(el, query, { firstMatchPerNode: true });
    if (ranges.length) CSS.highlights.set('search-match', new Highlight(...ranges));
  });

  useEffect(() => {
    highlightFilterMatch();
  }, [globalSearch.currentMatch?.token]);

  useEffect(() => {
    if (!CSS.highlights) return;
    const query = globalSearch.activeQuery.toLowerCase();
    const el = document.getElementById('filter-essential-hint');
    if (!query || !el || globalSearch.currentMatch?.rowId === 'filter-essential-hint') {
      CSS.highlights.delete('search-match-all-filter');
      return;
    }
    const ranges = collectTextMatchRanges(el, query, { firstMatchPerNode: true });
    if (ranges.length) CSS.highlights.set('search-match-all-filter', new Highlight(...ranges));
    else CSS.highlights.delete('search-match-all-filter');
  }, [globalSearch.activeQuery, globalSearch.currentMatch]);

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

  const openLocationHash = useEffectEvent(() => {
    if (!inspection && !isCombined) {
      return;
    }

    if (
      inspection?.source.sourceKind === 'url' &&
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
          const target = /** @type {(HTMLElement & { open?: boolean }) | null} */ (document.getElementById(`section-${sectionHash}`));
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
  });

  useEffect(() => {
    openLocationHash();
  }, [inspectionKeyBase]);

  // The model's reactions run with the page's effects, after the anchor above, as the effects they
  // replaced did.
  useEffect(() => {
    model.runReactions(state);
  });

  useEffect(() => model.connect(), [model]);

  const modalOpen = catalogModalOpen || choicePickerOpen || Boolean(prompt);
  useEffect(() => {
    if (!modalOpen) {
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
        model.escape();
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
  }, [model, modalOpen, catalogModalOpen, choicePickerOpen, prompt]);

  function loadUrl(event) {
    event.preventDefault();
    /** @type {HTMLElement | null} */ (document.activeElement)?.blur?.();
    model.loadUrl();
  }

  const installDatabase = installDbId
    ? combinedView?.databases.find(({ dbId }) => dbId === installDbId) ?? null
    : null;

  function openInstallModal() {
    setInstallModalOpen(true);
    history.replaceState(null, '', '#install');
  }

  function searchForEssential() {
    globalSearch.setQuery('essential');
    globalSearch.openSearch();
  }

  function openGlobalSearch() {
    if (!globalSearch.open) globalSearch.openSearch();
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

      <SourceLoaders
        dropzone={dropzone}
        fileInputRef={fileInputRef}
        onFilesChosen={model.openChosenFiles}
        databaseUrl={databaseUrl}
        onDatabaseUrlChange={model.setDatabaseUrl}
        onFetchSubmit={loadUrl}
        catalogReady={catalogReady}
        catalogCount={catalogOptions.length}
        catalogStatus={catalogDisplayStatus}
        catalogError={runtimeCatalog.error}
        onBrowseCatalog={model.openCatalog}
      />

      <div className="results-stack">
        {errorMessage ? <ErrorPanel message={errorMessage} /> : null}

        {addingMessage ? (
          <section className="panel status-panel">
            <p className="status loading">{addingMessage}</p>
          </section>
        ) : null}

        {choice ? <ChoicePanel choice={choice} onBrowseEntries={model.openChoicePicker} /> : null}

        {combinedView ? (
          <>
            <CombinedOverview
              databases={databases}
              detailed={databaseDetailed}
              onDetailedChange={handleDatabaseDetailedChange}
              onInstall={setInstallDbId}
            />

            <CombinedFilterPanel
              databases={combinedView.databases}
              sharedFilter={combinedFilters.shared}
              overrides={combinedFilters.overrides}
              onSharedFilterChange={model.setSharedFilter}
              onSharedFilterReset={model.resetSharedFilter}
              onOverrideChange={model.setOwnFilter}
              onOverrideAdd={model.addOwnFilter}
              onOverrideRemove={model.removeOwnFilter}
              hasEssentialHint={hasEssentialHint}
              hasUntaggedItems={hasUntaggedItems}
              onSearchEssential={searchForEssential}
              filterPending={combinedFilters !== debouncedCombinedFilters}
              summary={buildCombinedFilterSummaryCopy(combinedView)}
              storageSummary={storageSummary}
              clusterSizeBytes={clusterSizeBytes}
              onClusterSizeChange={setClusterSizeBytes}
            />
          </>
        ) : null}

        {displayedInspection ? (
          <>
            <DatabaseOverview
              inspection={displayedInspection}
              detailed={databaseDetailed}
              onDetailedChange={handleDatabaseDetailedChange}
              onInstall={openInstallModal}
            />

            <FilterPanel
              filterInput={filterInput}
              onFilterInputChange={model.setFilterInput}
              canReset={canResetFilter(filterInput, effectiveDefaultFilter)}
              onReset={model.resetFilter}
              hasEssentialHint={hasEssentialHint}
              hasUntaggedItems={hasUntaggedItems}
              onSearchEssential={searchForEssential}
              defaultFilter={displayedInspection.overview.defaultFilter}
              filterPending={filterPending}
              activeFilter={displayedInspection.activeFilter}
              storageSummary={storageSummary}
              clusterSizeBytes={clusterSizeBytes}
              onClusterSizeChange={setClusterSizeBytes}
            />
          </>
        ) : null}

        {activeView ? (
          <>
            <FilesystemSection
              key={`filesystem:${inspectionKey}`}
              index={filesystemIndex}
              emptyMessage={
                isFiltering
                  ? 'No files or folders match the current filter.'
                  : 'No top-level files or folders were found.'
              }
              detailed={databaseDetailed}
              anchorRowId={nodeAnchor?.section === 'filesystem' ? nodeAnchor.rowId : null}
              altAnchorRowId={nodeAnchor?.section === 'filesystem' ? nodeAnchor.altRowId : null}
              onAnchorHandled={() => setNodeAnchor(null)}
              searchMatch={globalSearch.currentMatch?.section === 'filesystem' ? globalSearch.currentMatch : null}
              searchQuery={globalSearch.activeQuery}
              onDownloadError={handleDownloadError}
            />

            {activeView.archiveViews.length ? (
              <ArchiveSummariesSection
                key={`archives:${inspectionKey}`}
                index={archivesIndex}
                emptyMessage={
                  isFiltering
                    ? 'No archive summary entries match the current filter.'
                    : 'This database does not define any archives.'
                }
                detailed={databaseDetailed}
                anchorRowId={nodeAnchor?.section === 'archives' ? nodeAnchor.rowId : null}
                altAnchorRowId={nodeAnchor?.section === 'archives' ? nodeAnchor.altRowId : null}
                onAnchorHandled={() => setNodeAnchor(null)}
                searchMatch={globalSearch.currentMatch?.section === 'archives' ? globalSearch.currentMatch : null}
                searchQuery={globalSearch.activeQuery}
                onDownloadError={handleDownloadError}
              />
            ) : null}

            {collisionsIndex ? (
              <CollisionsSection
                key={`collisions:${inspectionKey}`}
                index={collisionsIndex}
                emptyMessage="No path is claimed by more than one database."
                detailed={databaseDetailed}
                anchorRowId={nodeAnchor?.section === 'collisions' ? nodeAnchor.rowId : null}
                altAnchorRowId={null}
                onAnchorHandled={() => setNodeAnchor(null)}
                searchMatch={globalSearch.currentMatch?.section === 'collisions' ? globalSearch.currentMatch : null}
                searchQuery={globalSearch.activeQuery}
                onDownloadError={handleDownloadError}
              />
            ) : null}

            <IssuesSection issues={activeView.issues} />

            {combinedView ? (
              tagGroups.some(({ tags }) => tags.length) ? (
                <TagDictionary
                  groups={tagGroups}
                  searchQuery={globalSearch.activeQuery}
                  searchMatch={globalSearch.currentMatch?.section === 'tags' ? globalSearch.currentMatch : null}
                />
              ) : null
            ) : displayedInspection.overview.tagDictionary.length ? (
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
        ) : !choice ? (
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
          error={runtimeCatalog.error}
          loadedDatabases={databases}
          onClose={model.closeCatalog}
          onOpenDatabases={model.openCatalogSelection}
        />
      ) : null}

      {choicePickerOpen && choice ? (
        <SourcePickerModal
          choice={choice}
          loadedDatabases={databases}
          onClose={model.closeChoicePicker}
          onOpenDatabases={model.openChoiceSelection}
        />
      ) : null}

      {prompt?.kind === 'loadMode' ? (
        <LoadModeModal
          key={prompt.id}
          loadedDbIds={databases.map(({ inspection: database }) => database.overview.dbId)}
          incomingCount={prompt.incomingCount}
          onLoadAlone={() => model.answerPrompt('replace')}
          onCombine={() => model.answerPrompt('add')}
          onCancel={() => model.answerPrompt(null)}
        />
      ) : null}

      {prompt?.kind === 'replaceLoaded' ? (
        <ReplaceLoadedModal key={prompt.id} conflicts={prompt.conflicts} onAnswer={model.answerPrompt} />
      ) : null}

      {prompt?.kind === 'filterOverride' ? (
        <FilterOverrideModal
          key={prompt.id}
          currentFilter={prompt.currentFilter}
          nextFilter={prompt.nextFilter}
          onAccept={() => model.answerPrompt(true)}
          onDecline={() => model.answerPrompt(false)}
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

      {installDatabase ? (
        <InstallModal
          dbId={installDatabase.dbId}
          dbUrl={installDatabase.view.source.requestedUrl}
          activeFilter={installDatabase.effectiveFilter}
          showInstallLink={false}
          onClose={() => setInstallDbId(null)}
        />
      ) : null}

      {downloadError ? (
        <DownloadErrorModal
          error={downloadError}
          onClose={() => setDownloadError(null)}
        />
      ) : null}

      <p className="app-footer">
        <a className="stealth-link" href="https://github.com/theypsilon" target="_blank" rel="noopener noreferrer">
          © 2026 José Barroso (theypsilon)
        </a>
        <span
          className="stealth-link"
          role="button"
          tabIndex={0}
          onClick={openGlobalSearch}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              openGlobalSearch();
            }
          }}
        >
          Press <kbd>{FIND_SHORTCUT_LABEL}</kbd> to search
        </span>
      </p>
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
