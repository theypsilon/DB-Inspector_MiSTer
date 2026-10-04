import {
  loadDatabaseSourceBytes,
  loadDatabaseSourceUrl,
  loadRuntimeDatabaseCatalog,
  normalizeComparableUrl,
} from '../lib/database.js';
import { createCatalogEntriesFromLoadedSource, getLoadedSourceUrl, mergeCatalogEntries, mergeCustomCatalogEntries } from '../lib/catalog.js';
import {
  NO_FILTER_DEFAULTS,
  buildListEntryFilterDefaults,
  listMisterFilter,
  resolveDownloaderFilter,
  shouldConfirmFilterOverride,
} from '../lib/filterDefaults.js';
import { INITIAL_FILTER_SYNC, reduceFilterSync } from '../lib/filterSync.js';
import {
  NO_COMBINED_FILTERS,
  UNSET_FILTER,
  addDatabasesToSession,
  buildCombinedUrlState,
  downloaderFilterInputs,
  findLoadedDbIdConflicts,
  startSession,
} from '../lib/combinedFilters.js';
import {
  buildUploadChoice,
  collectSelectedDatabases,
  findLoadedKeys,
  isLoadedUrl,
  isReloadOf,
  selectionIncludesLoadedDatabases,
} from '../lib/selection.js';
import {
  hashContent,
  isSingleFileDrop,
  listChosenFiles,
  listDroppedFiles,
  readSingleDroppedFile,
  scanUploads,
} from '../lib/uploads.js';
import {
  parseCombinedSearch,
  readDatabaseUrlSearchParam,
  readFilterSearchParam,
  writeCombinedSearch,
  writeDatabaseUrlSearchParam,
  writeFilterSearchParam,
} from '../lib/urlState.js';
import { FILTER_INPUT_DEBOUNCE_MS, settleWithConcurrency } from '../lib/utils.js';
import {
  selectChoice,
  selectEffectiveDefaultFilter,
  selectInspection,
  selectInspectionKeyBase,
  selectIsCombined,
} from './selectors.js';

// How many databases chosen together are fetched at the same time.
const SELECTION_FETCH_CONCURRENCY = 6;

// The URLs a loaded source was reached through, to detect lists that link back to themselves.
function addVisitedUrls(visitedUrls, requestedUrl, loadedSource) {
  return new Set(
    [
      ...visitedUrls,
      normalizeComparableUrl(requestedUrl),
      normalizeComparableUrl(getLoadedSourceUrl(loadedSource)),
    ].filter(Boolean),
  );
}

// What a question to the user answers when it is dismissed (Escape, or a click outside it).
function dismissAnswer(prompt) {
  switch (prompt.kind) {
    case 'filterOverride':
      // Keeping the current filter still opens the database.
      return false;
    case 'replaceLoaded':
      // One conflict keeps the loaded database; several cancel the whole load.
      return prompt.conflicts.length === 1 ? new Set() : null;
    default:
      return null;
  }
}

function initialState() {
  return {
    // The URL box of the Fetch card.
    databaseUrl: readDatabaseUrlSearchParam(),
    loadingMessage: '',
    addingMessage: '',
    errorMessage: '',
    // The loaded databases, each with the default filters its source contributed (its list entry
    // and the list's [mister] section).
    databases: [],
    filterInput: '',
    debouncedFilterInput: '',
    // While several databases are combined: their shared ([mister]) filter and their own filters.
    combinedFilters: NO_COMBINED_FILTERS,
    debouncedCombinedFilters: NO_COMBINED_FILTERS,
    // A database list, or uploaded files, whose databases are being chosen.
    iniSource: null,
    uploadChoice: null,
    choicePickerOpen: false,
    catalogModalOpen: false,
    customCatalogOptions: [],
    runtimeCatalog: { entries: [], status: 'loading', error: '' },
    // The question waiting for an answer: { kind: 'loadMode' | 'filterOverride' | 'replaceLoaded', ... }.
    prompt: null,
  };
}

// The app's state and everything that changes it: loading sources, combining databases, FILTER and
// its URL, and the questions asked along the way. The React view renders the state and forwards
// user actions; tests drive the same actions without a browser.
//
// The view follows the state through `subscribe` and reports each render it commits: `commit(state)`
// when the render lands (a layout effect) and `runReactions(state)` with its effects (a passive
// effect). Reactions run there, as the view's effects did, so their changes render together with
// the view's own.
//
// A user action starts from the last committed render, its `ctx` ({ databases, filterInput,
// combinedFilters, runtimeEntries, databaseUrl }), as the view's handlers read the render that
// created them; back/forward navigation and shared links start from the first one, INITIAL_CTX (an
// empty FILTER and catalog). What an action reads after it waited (the databases it combines with,
// FILTER) comes from `refs`, which follow the renders with the effects and which showing databases
// updates at once.
export function createAppModel() {
  let state = initialState();
  let committed = state;
  const INITIAL_CTX = Object.freeze({
    databases: state.databases,
    filterInput: state.filterInput,
    combinedFilters: state.combinedFilters,
    runtimeEntries: state.runtimeCatalog.entries,
    databaseUrl: state.databaseUrl,
  });
  const listeners = new Set();
  const refs = {
    inspection: null,
    databases: state.databases,
    filterInput: state.filterInput,
    combinedFilters: state.combinedFilters,
    iniSource: state.iniSource,
  };
  let filterSync = INITIAL_FILTER_SYNC;
  // Uploaded database files by the object URL that names them in the catalog: { file, label }.
  const uploadedFiles = new Map();
  let pendingPrompt = null;
  let promptCount = 0;
  let started = false;
  let connected = false;

  function getState() {
    return state;
  }

  /**
   * @param {() => void} listener
   * @returns {() => void} what unsubscribes it
   */
  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function setState(update) {
    const changes = typeof update === 'function' ? update(state) : update;
    if (Object.keys(changes).every((key) => Object.is(state[key], changes[key]))) {
      return;
    }

    state = { ...state, ...changes };
    for (const listener of listeners) {
      listener();
    }
  }

  // The render the view committed last: what user actions start from.
  function commit(snapshot) {
    committed = snapshot;
  }

  function makeCtx() {
    return {
      databases: committed.databases,
      filterInput: committed.filterInput,
      combinedFilters: committed.combinedFilters,
      runtimeEntries: committed.runtimeCatalog.entries,
      databaseUrl: committed.databaseUrl,
    };
  }

  function updateFilterSync(event) {
    const result = reduceFilterSync(filterSync, event);
    filterSync = result.state;
    return result.filterToApply;
  }

  // Reactions run after each committed render, as the view's effects did: in order, each only when
  // its dependencies changed, reading that render's state. Their changes render next. `refs` follow
  // the renders; FILTER reacts to a new source and settles after a pause; and the address follows
  // FILTER and the combined databases.
  const reactions = [
    { deps: (s) => [selectInspection(s)], run: (s) => void (refs.inspection = selectInspection(s)) },
    { deps: (s) => [s.databases], run: (s) => void (refs.databases = s.databases) },
    { deps: (s) => [s.filterInput], run: (s) => void (refs.filterInput = s.filterInput) },
    { deps: (s) => [s.combinedFilters], run: (s) => void (refs.combinedFilters = s.combinedFilters) },
    {
      // A new source (or a new default filter) resets FILTER.
      deps: (s) => [selectEffectiveDefaultFilter(s), selectInspectionKeyBase(s)],
      run: (s) => {
        const filterToApply = updateFilterSync({
          type: 'sourceChanged',
          hasInspection: Boolean(selectInspection(s)),
          sharedFilter: readFilterSearchParam(),
          effectiveDefaultFilter: selectEffectiveDefaultFilter(s),
        });
        if (filterToApply !== null) {
          setState({ filterInput: filterToApply, debouncedFilterInput: filterToApply });
        }
      },
    },
    {
      deps: (s) => [s.debouncedFilterInput, s.filterInput],
      run: (s) => {
        if (s.filterInput === s.debouncedFilterInput) {
          return undefined;
        }

        const timeoutId = window.setTimeout(() => {
          setState({ debouncedFilterInput: s.filterInput });
        }, FILTER_INPUT_DEBOUNCE_MS);
        return () => window.clearTimeout(timeoutId);
      },
    },
    {
      deps: (s) => [selectInspection(s), selectInspectionKeyBase(s), s.debouncedFilterInput],
      run: (s) => {
        updateFilterSync({
          type: 'filterSettled',
          hasInspection: Boolean(selectInspection(s)),
          debouncedFilter: s.debouncedFilterInput,
        });
      },
    },
    { deps: (s) => [s.iniSource], run: (s) => void (refs.iniSource = s.iniSource) },
    {
      deps: (s) => [selectEffectiveDefaultFilter(s), selectInspection(s), s.debouncedFilterInput],
      run: (s) => {
        const inspection = selectInspection(s);
        if (!inspection || !filterSync.urlWritesEnabled) {
          return;
        }

        if (inspection.source.sourceKind !== 'url' || s.debouncedFilterInput === selectEffectiveDefaultFilter(s)) {
          writeFilterSearchParam('', { isPresent: false });
          return;
        }

        writeFilterSearchParam(s.debouncedFilterInput, { isPresent: true });
      },
    },
    {
      deps: (s) => [s.combinedFilters, s.debouncedCombinedFilters],
      run: (s) => {
        if (s.combinedFilters === s.debouncedCombinedFilters) {
          return undefined;
        }

        const timeoutId = window.setTimeout(() => {
          setState({ debouncedCombinedFilters: s.combinedFilters });
        }, FILTER_INPUT_DEBOUNCE_MS);
        return () => window.clearTimeout(timeoutId);
      },
    },
    {
      deps: (s) => [selectIsCombined(s), s.databases, s.debouncedCombinedFilters],
      run: (s) => {
        if (selectIsCombined(s)) {
          writeCombinedSearch(buildCombinedUrlState(s.databases, s.debouncedCombinedFilters));
        }
      },
    },
    {
      // A new list or upload opens its picker.
      deps: (s) => [selectChoice(s)],
      run: (s) => {
        setState({ choicePickerOpen: Boolean(selectChoice(s)?.entries.length) });
      },
    },
  ];
  const reactionDeps = reactions.map(() => null);
  const reactionCleanups = reactions.map(() => null);

  // Runs the reactions for a committed render: the cleanups of those whose dependencies changed,
  // then their bodies.
  function runReactions(snapshot) {
    const changed = [];
    reactions.forEach((reaction, index) => {
      const deps = reaction.deps(snapshot);
      const previous = reactionDeps[index];
      if (!previous || deps.some((dep, depIndex) => !Object.is(dep, previous[depIndex]))) {
        reactionDeps[index] = deps;
        changed.push(index);
      }
    });
    for (const index of changed) {
      reactionCleanups[index]?.();
      reactionCleanups[index] = null;
    }
    for (const index of changed) {
      reactionCleanups[index] = reactions[index].run(snapshot) ?? null;
    }
  }

  // Questions to the user. One waits at a time; a new one replaces it, and the replaced one never
  // gets an answer. `onAnswer` runs as the question closes, within the same user action, so what it
  // starts renders together with the closing.
  function ask(question, onAnswer) {
    promptCount += 1;
    const prompt = { ...question, id: promptCount };
    pendingPrompt = { prompt, onAnswer };
    setState({ prompt });
  }

  function answerPrompt(answer) {
    const pending = pendingPrompt;
    if (!pending) {
      return;
    }

    pendingPrompt = null;
    setState({ prompt: null });
    pending.onAnswer(answer);
  }

  function dismissPrompt() {
    if (pendingPrompt) {
      answerPrompt(dismissAnswer(pendingPrompt.prompt));
    }
  }

  // Escape closes the pickers and dismisses the question.
  function escape() {
    setState({ catalogModalOpen: false, choicePickerOpen: false });
    dismissPrompt();
  }

  function clearLoadedSource() {
    setState({
      databases: [],
      iniSource: null,
      uploadChoice: null,
      combinedFilters: NO_COMBINED_FILTERS,
      debouncedCombinedFilters: NO_COMBINED_FILTERS,
    });
  }

  // A database list, or uploaded files, whose databases are to be chosen. One waits at a time.
  function showListChoice(list) {
    setState({ uploadChoice: null, iniSource: list });
  }

  function showUploadChoice(nextChoice) {
    setState({ iniSource: null, uploadChoice: nextChoice });
  }

  function clearChoice() {
    setState({ iniSource: null, uploadChoice: null });
  }

  // FILTER as the user sees it: the FILTER of a database, or the shared filter of combined ones.
  function currentFilterValue(ctx) {
    if (ctx.databases.length > 1) {
      return ctx.combinedFilters.shared.isSet ? ctx.combinedFilters.shared.value : '';
    }

    return ctx.filterInput;
  }

  function queueCurrentFilterForPreservedLoad(ctx, preserveCurrentFilter) {
    // Combined databases hand their shared filter over to a database loaded alone.
    const currentFilter = currentFilterValue(ctx);
    updateFilterSync({
      type: 'preserveFilter',
      filter: preserveCurrentFilter && String(currentFilter).trim() ? currentFilter : null,
    });
  }

  // Loads started by the user: when databases are already loaded, first ask whether to combine.
  function requestLoad(ctx, start, incomingCount = 1) {
    if (!ctx.databases.length) {
      start('replace');
      return;
    }

    ask({ kind: 'loadMode', incomingCount }, (mode) => {
      if (mode) {
        start(mode);
      }
    });
  }

  // Asks which databases being combined should replace the loaded ones with their db_id (see
  // findLoadedDbIdConflicts). Resolves to the db_ids to replace, or null when cancelled.
  function askToReplaceLoaded(conflicts) {
    return new Promise((resolve) => ask({ kind: 'replaceLoaded', conflicts }, resolve));
  }

  // Asks before an entry's own filter replaces a FILTER with terms. Returns whether it asked; the
  // answer then opens the entry with its filter (onAccept) or keeping FILTER (onDecline).
  function maybeConfirmFilterOverride(ctx, { nextFilter, nextFilterPresent, onAccept, onDecline }) {
    const currentFilter = String(currentFilterValue(ctx));
    if (!shouldConfirmFilterOverride({ currentFilter, nextFilter, nextFilterPresent })) {
      return false;
    }

    ask({ kind: 'filterOverride', currentFilter, nextFilter }, (accept) => {
      if (accept) {
        onAccept();
      } else {
        onDecline();
      }
    });
    return true;
  }

  function registerSourceInCatalog(ctx, loadedSource) {
    setState((current) => ({
      customCatalogOptions: mergeCustomCatalogEntries(
        createCatalogEntriesFromLoadedSource(
          loadedSource,
          mergeCatalogEntries(current.customCatalogOptions, ctx.runtimeEntries),
        ),
        current.customCatalogOptions,
      ),
    }));
  }

  function openFile(ctx, file) {
    if (!file) {
      return;
    }

    if (!ctx.databases.length) {
      void loadFile(ctx, file);
      return;
    }

    void readSourceThenAsk(ctx, `Loading ${file.name}...`, () => readUploadedFile(file), (loadedSource, mode) =>
      openUploadedSource(ctx, loadedSource, mode),
    );
  }

  // A single file opens as before; several files, or folders, offer their databases to choose from.
  async function openDrop(ctx, drop) {
    if (!drop.files.length && !drop.entries?.length) {
      return;
    }

    if (isSingleFileDrop(drop)) {
      openFile(ctx, await readSingleDroppedFile(drop).catch(() => null));
      return;
    }

    await openUploads(ctx, (onProgress) => listDroppedFiles(drop, onProgress));
  }

  // Chosen files: one opens as before; several offer their databases to choose from.
  function openChosenFiles(ctx, files) {
    if (files.length === 1) {
      openFile(ctx, files[0]);
      return;
    }

    if (files.length) {
      void openUploads(ctx, async () => listChosenFiles(files));
    }
  }

  // Finds the databases in uploaded files and offers them in a picker. Loaded databases stay while
  // the new ones are chosen.
  async function openUploads(ctx, listFiles) {
    const keepLoaded = ctx.databases.length > 0;
    const showProgress = (message) => setState(keepLoaded ? { addingMessage: message } : { loadingMessage: message });
    setState({ errorMessage: '' });
    if (!keepLoaded) {
      clearLoadedSource();
    }

    showProgress('Looking for databases in your files...');
    try {
      const files = await listFiles((visited) =>
        showProgress(`Looking for databases in your files... ${visited} files checked.`),
      );
      const scan = await scanUploads(files, {
        onProgress: (read, total) => showProgress(`Reading ${total} files... ${read} of ${total} done.`),
      });
      if (!scan.entries.length) {
        setState({ errorMessage: 'No databases or database lists were found in your files.' });
        return;
      }

      for (const list of scan.lists) {
        registerSourceInCatalog(ctx, list);
      }
      showUploadChoice(buildUploadChoice(scan));
      if (!keepLoaded) {
        // Uploads cannot be shared, so the address no longer names a database.
        setState({ databaseUrl: '' });
        writeDatabaseUrlSearchParam('', { pushHistory: true });
      }
    } catch (error) {
      setState({ errorMessage: error.message });
    } finally {
      showProgress('');
    }
  }

  // With databases loaded, a new source is read before anything is asked: a list with several
  // entries opens its picker, and anything else asks whether to combine before `open` runs. The only
  // loaded database, read again from its URL, cannot be combined with itself: it opens to be
  // combined, which asks whether to reload it.
  async function readSourceThenAsk(ctx, message, read, open) {
    setState({ addingMessage: message, errorMessage: '' });
    let loadedSource;
    try {
      loadedSource = await read();
    } catch (error) {
      setState({ errorMessage: error.message });
      return;
    } finally {
      setState({ addingMessage: '' });
    }

    if (loadedSource.kind !== 'database' && loadedSource.entries.length > 1) {
      registerSourceInCatalog(ctx, loadedSource);
      showListChoice(loadedSource);
      return;
    }

    if (
      loadedSource.kind === 'database' &&
      ctx.databases.length === 1 &&
      isReloadOf(ctx.databases[0].inspection, loadedSource.inspection)
    ) {
      void open(loadedSource, 'add');
      return;
    }

    requestLoad(ctx, (mode) => void open(loadedSource, mode));
  }

  // Adds a database to the loaded ones. When one with its db_id is loaded, the user chooses which
  // of the two stays.
  async function addDatabase(inspection, filterDefaults) {
    const item = { inspection, filterDefaults };
    const conflicts = findLoadedDbIdConflicts(refs.databases, [item]);
    const replaceDbIds = conflicts.length ? await askToReplaceLoaded(conflicts) : new Set();
    if (conflicts.length && !replaceDbIds?.size) {
      return;
    }

    showAddedSession(
      addDatabasesToSession(
        { databases: refs.databases, filters: refs.combinedFilters },
        [item],
        refs.filterInput,
        replaceDbIds,
      ),
    );
  }

  // Shows the loaded databases after some were added or replaced: alone when only one is loaded.
  function showAddedSession(session) {
    if (session.databases.length > 1) {
      showCombinedSession(session, { pushHistory: true });
      return;
    }

    const filter = String(refs.filterInput).trim() ? refs.filterInput : null;
    showSingleDatabase(session.databases[0], { filter, preserveFilter: true });
  }

  // Shows one database, with `filter` as its FILTER (or its default filter when null).
  function showSingleDatabase(database, { filter, preserveFilter }) {
    const { source } = database.inspection;
    const sharedUrl = source.sourceKind === 'url' ? source.sourceLabel : '';
    updateFilterSync({ type: 'preserveFilter', filter });
    refs.databases = [database];
    refs.combinedFilters = NO_COMBINED_FILTERS;
    setState({
      databases: [database],
      combinedFilters: NO_COMBINED_FILTERS,
      debouncedCombinedFilters: NO_COMBINED_FILTERS,
      databaseUrl: sharedUrl,
    });
    writeDatabaseUrlSearchParam(sharedUrl, { pushHistory: true, preserveFilter });
  }

  // Shows several databases together, with their filters, and puts them in the address bar.
  function showCombinedSession({ databases, filters }, { pushHistory = false } = {}) {
    refs.databases = databases;
    refs.combinedFilters = filters;
    setState({ databases, combinedFilters: filters, debouncedCombinedFilters: filters });
    writeCombinedSearch(buildCombinedUrlState(databases, filters), { pushHistory });
  }

  // Opens a combined session from the address bar (a shared link, or back/forward navigation).
  async function loadCombinedSession(ctx, { databases: requested, sharedFilter, overrides }) {
    setState({ loadingMessage: `Fetching ${requested.length} databases...`, errorMessage: '' });
    clearLoadedSource();

    const results = await Promise.allSettled(requested.map(({ url }) => loadDatabaseSourceUrl(url)));
    const loaded = [];
    const errors = [];
    results.forEach((result, index) => {
      const { key, url } = requested[index];
      if (result.status === 'rejected') {
        errors.push(result.reason?.message || `Could not load ${url}.`);
      } else if (result.value.kind !== 'database') {
        errors.push(`${url} is a database list. Open it alone to choose one of its databases.`);
      } else if (loaded.some(({ inspection }) => inspection.overview.dbId === result.value.inspection.overview.dbId)) {
        errors.push(
          `A database with db_id ${result.value.inspection.overview.dbId} is already loaded, so ${url} was not combined.`,
        );
      } else {
        loaded.push({ key, loadedSource: result.value, inspection: result.value.inspection });
      }
    });

    setState({ loadingMessage: '', errorMessage: errors.join(' ') });
    for (const { loadedSource } of loaded) {
      registerSourceInCatalog(ctx, loadedSource);
    }

    if (!loaded.length) {
      return;
    }

    const filters = {
      shared: sharedFilter,
      overrides: Object.fromEntries(
        loaded
          .filter(({ key }) => Object.hasOwn(overrides, key))
          .map(({ key, inspection }) => [inspection.overview.dbId, overrides[key]]),
      ),
    };
    const next = loaded.map(({ inspection }) => ({ inspection, filterDefaults: NO_FILTER_DEFAULTS }));
    if (next.length === 1) {
      // Only one of them loaded: show it alone, with the filter it had among the others.
      const [{ inspection }] = next;
      updateFilterSync({
        type: 'preserveFilter',
        filter: resolveDownloaderFilter(downloaderFilterInputs(filters, inspection)),
      });
      setState({ databases: next, databaseUrl: inspection.source.sourceLabel });
      writeDatabaseUrlSearchParam(inspection.source.sourceLabel, { preserveFilter: false });
      return;
    }

    showCombinedSession({ databases: next, filters });
  }

  // Opens databases chosen together in a picker: alone, replacing the loaded ones, or combined with
  // them. Databases opened alone share the chosen [mister] filter, or else the current FILTER, and
  // keep their list section's filter as their own.
  async function loadDatabaseSelection(ctx, entries, mode, { misterFilter = null } = {}) {
    const adding = mode === 'add';
    const filterValue = currentFilterValue(ctx);
    const currentFilter = String(filterValue).trim() ? filterValue : null;
    const loadedKeys = findLoadedKeys(entries, ctx.databases);
    // Combining leaves out the selected databases that are already loaded.
    const pending = adding ? entries.filter((entry) => !loadedKeys.has(entry.key)) : entries;
    const showProgress = (message) => setState(adding ? { addingMessage: message } : { loadingMessage: message });
    setState({ errorMessage: '' });
    if (adding) {
      clearChoice();
    } else {
      clearLoadedSource();
    }

    if (!pending.length) {
      return;
    }

    const fetching = `Fetching ${pending.length === 1 ? '1 database' : `${pending.length} databases`}...`;
    showProgress(fetching);
    const results = await settleWithConcurrency(pending, SELECTION_FETCH_CONCURRENCY, readSelectedEntry, (settled) =>
      showProgress(`${fetching} ${settled} of ${pending.length} done.`),
    );

    const { loaded, errors } = collectSelectedDatabases(pending, results);
    const items = [];
    for (const { entry, loadedSource } of loaded) {
      if (entry.dbIdApproximate || loadedSource.inspection.source.sourceKind === 'upload') {
        registerSourceInCatalog(ctx, loadedSource);
      }

      items.push({
        inspection: loadedSource.inspection,
        filterDefaults: buildListEntryFilterDefaults(entry, misterFilter),
        ownFilter: entry.sectionFilter ?? null,
      });
    }

    const duplicateError = ({ inspection: { overview, source } }) =>
      `Another selected database has the db_id ${overview.dbId}, so ${source.sourceLabel} was not opened.`;
    if (!adding) {
      showProgress('');
      const sharedFilter = misterFilter ?? currentFilter;
      const session = startSession(items, sharedFilter !== null ? { isSet: true, value: sharedFilter } : UNSET_FILTER);
      setState({ errorMessage: [...errors, ...session.rejected.map(duplicateError)].join(' ') });
      if (session.databases.length === 1) {
        showSingleDatabase(session.databases[0], {
          filter: misterFilter === null ? currentFilter : null,
          preserveFilter: misterFilter === null,
        });
      } else if (session.databases.length) {
        showCombinedSession(session, { pushHistory: true });
      }
      return;
    }

    // Loaded databases with the db_id of a new one stay unless the user replaces them.
    const conflicts = findLoadedDbIdConflicts(refs.databases, items);
    const replaceDbIds = conflicts.length ? await askToReplaceLoaded(conflicts) : new Set();
    showProgress('');
    if (replaceDbIds === null) {
      return;
    }

    const current = refs.databases;
    const session = addDatabasesToSession(
      { databases: current, filters: refs.combinedFilters },
      items,
      refs.filterInput,
      replaceDbIds,
    );
    // A loaded database the user chose to keep is no error.
    const conflictItems = new Set(conflicts.map(({ incoming }) => incoming));
    setState({
      errorMessage: [...errors, ...session.rejected.filter((item) => !conflictItems.has(item)).map(duplicateError)].join(' '),
    });
    if (session.databases.length !== current.length || session.databases.some((database, index) => database !== current[index])) {
      showAddedSession(session);
    }
  }

  // Loads a database chosen in a picker: from its uploaded file, or from its URL.
  function readSelectedEntry(entry) {
    const upload = entry.file ? { file: entry.file, label: entry.origin } : uploadedFiles.get(entry.dbUrl);
    return upload ? readUploadedFile(upload.file, upload.label) : loadDatabaseSourceUrl(entry.dbUrl);
  }

  function startRemoteDatabaseLoad(
    ctx,
    url,
    { registerInCatalog = false, filterDefaults = NO_FILTER_DEFAULTS, preserveCurrentFilter = false, mode = 'replace' } = {},
  ) {
    const requestedUrl = String(url).trim();
    if (!requestedUrl) {
      return;
    }

    if (mode === 'add') {
      setState({ databaseUrl: requestedUrl });
      void loadRemoteSource(ctx, requestedUrl, { registerInCatalog, filterDefaults, mode });
      return;
    }

    queueCurrentFilterForPreservedLoad(ctx, preserveCurrentFilter);
    setState({ databaseUrl: requestedUrl, loadingMessage: `Fetching ${requestedUrl}...`, errorMessage: '' });
    clearLoadedSource();

    window.setTimeout(() => {
      void loadRemoteSource(ctx, requestedUrl, {
        skipPrepare: true,
        registerInCatalog,
        filterDefaults,
        preserveCurrentFilter,
      });
    }, 0);
  }

  /**
   * @param {any} ctx
   * @param {any} loadedSource
   * @param {{ origin?: string, requestedUrl?: string, syncSearchParam?: boolean, visitedUrls?: Set<string>, registerInCatalog?: boolean, filterDefaults?: import('../lib/filterDefaults.js').FilterDefaults, preserveCurrentFilter?: boolean, mode?: string }} [options]
   */
  async function handleLoadedSource(
    ctx,
    loadedSource,
    {
      origin,
      requestedUrl = '',
      syncSearchParam = true,
      visitedUrls = new Set(),
      registerInCatalog = true,
      filterDefaults = NO_FILTER_DEFAULTS,
      preserveCurrentFilter = false,
      mode = 'replace',
    } = {},
  ) {
    if (registerInCatalog) {
      registerSourceInCatalog(ctx, loadedSource);
    }

    if (loadedSource.kind === 'database' && mode === 'add') {
      void addDatabase(loadedSource.inspection, filterDefaults);
      clearChoice();
      setState({ choicePickerOpen: false, catalogModalOpen: false });
      return;
    }

    if (loadedSource.kind === 'database') {
      setState({ databases: [{ inspection: loadedSource.inspection, filterDefaults }] });
      clearChoice();
      setState({ choicePickerOpen: false, catalogModalOpen: false });

      if (origin === 'upload') {
        setState({ databaseUrl: '' });
        writeDatabaseUrlSearchParam('', { pushHistory: true, preserveFilter: preserveCurrentFilter });
      } else {
        const sharedUrl = loadedSource.inspection.source.sourceLabel;
        setState({ databaseUrl: sharedUrl });
        if (syncSearchParam) {
          writeDatabaseUrlSearchParam(sharedUrl, { pushHistory: true, preserveFilter: preserveCurrentFilter });
        }
      }

      return;
    }

    if (loadedSource.entries.length === 1 && mode === 'add') {
      // Combining: the entry gets the filter its list gives it, so there is nothing to confirm.
      const [entry] = loadedSource.entries;
      clearChoice();
      setState({ choicePickerOpen: false });
      await loadRemoteSource(ctx, entry.dbUrl, {
        visitedUrls,
        registerInCatalog: false,
        filterDefaults: buildListEntryFilterDefaults(entry, listMisterFilter(loadedSource)),
        mode,
      });
      return;
    }

    if (loadedSource.entries.length === 1) {
      const [entry] = loadedSource.entries;
      const shouldPreserveCurrentFilter = preserveCurrentFilter && !entry.defaultFilterExplicit;
      const loadEntry = (preserveEntryFilter) =>
        loadRemoteSource(ctx, entry.dbUrl, {
          syncSearchParam: origin === 'url' ? syncSearchParam : true,
          visitedUrls,
          registerInCatalog: false,
          filterDefaults: buildListEntryFilterDefaults(entry, listMisterFilter(loadedSource)),
          preserveCurrentFilter: preserveEntryFilter,
        });
      const loadSelectedEntry = (preserveSelectedFilter) => {
        queueCurrentFilterForPreservedLoad(ctx, preserveSelectedFilter);
        void loadEntry(preserveSelectedFilter);
      };

      if (
        maybeConfirmFilterOverride(ctx, {
          nextFilter: entry.defaultFilter || '',
          nextFilterPresent: entry.defaultFilterExplicit,
          onAccept: () => loadSelectedEntry(false),
          onDecline: () => loadSelectedEntry(true),
        })
      ) {
        return;
      }

      clearChoice();
      setState({ choicePickerOpen: false, databaseUrl: entry.dbUrl });
      queueCurrentFilterForPreservedLoad(ctx, shouldPreserveCurrentFilter);
      await loadEntry(shouldPreserveCurrentFilter);
      return;
    }

    if (mode === 'add') {
      // The loaded databases stay while the list's databases to open are chosen.
      showListChoice(loadedSource);
      return;
    }

    setState({ databases: [] });
    showListChoice(loadedSource);

    if (origin === 'upload') {
      setState({ databaseUrl: '' });
      writeDatabaseUrlSearchParam('', { pushHistory: true, preserveFilter: preserveCurrentFilter });
      return;
    }

    setState({ databaseUrl: requestedUrl });
    if (syncSearchParam) {
      writeDatabaseUrlSearchParam(requestedUrl, { pushHistory: true, preserveFilter: preserveCurrentFilter });
    }
  }

  // Reads an uploaded file. A database gets an object URL, which names it in the catalog so it can be
  // opened again, and the digest of its content, which recognizes the same file later.
  async function readUploadedFile(file, label = file.name) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const loadedSource = await loadDatabaseSourceBytes(bytes, file.name, label);
    if (loadedSource.kind === 'database') {
      loadedSource.inspection.source.sourceUrl = uploadObjectUrl(file, label);
      loadedSource.inspection.source.contentHash = await hashContent(bytes);
    }

    return loadedSource;
  }

  function uploadObjectUrl(file, label) {
    for (const [url, upload] of uploadedFiles) {
      if (upload.file === file) {
        return url;
      }
    }

    const url = URL.createObjectURL(file);
    uploadedFiles.set(url, { file, label });
    return url;
  }

  // Opens one uploaded database file, alone or combined with the loaded databases.
  async function openLocalDatabase(ctx, { file, origin }, mode, misterFilter = null) {
    const adding = mode === 'add';
    const showProgress = (message) => setState(adding ? { addingMessage: message } : { loadingMessage: message });
    if (!adding) {
      queueCurrentFilterForPreservedLoad(ctx, true);
      clearLoadedSource();
    }

    setState({ errorMessage: '' });
    showProgress(`Loading ${origin}...`);
    try {
      await handleLoadedSource(ctx, await readUploadedFile(file, origin), {
        origin: 'upload',
        registerInCatalog: true,
        filterDefaults: buildListEntryFilterDefaults({}, misterFilter),
        preserveCurrentFilter: true,
        mode,
      });
    } catch (error) {
      setState({ errorMessage: error.message });
    } finally {
      showProgress('');
    }
  }

  async function loadFile(ctx, file) {
    queueCurrentFilterForPreservedLoad(ctx, true);
    setState({ loadingMessage: `Loading ${file.name}...`, errorMessage: '' });
    clearLoadedSource();

    try {
      await handleLoadedSource(ctx, await readUploadedFile(file), {
        origin: 'upload',
        registerInCatalog: true,
        preserveCurrentFilter: true,
      });
    } catch (error) {
      setState({ choicePickerOpen: false, errorMessage: error.message });
    } finally {
      setState({ loadingMessage: '' });
    }
  }

  // Opens an upload that was read while databases were loaded, alone or combined with them.
  async function openUploadedSource(ctx, loadedSource, mode) {
    if (mode === 'replace') {
      queueCurrentFilterForPreservedLoad(ctx, true);
      clearLoadedSource();
    }

    try {
      await handleLoadedSource(ctx, loadedSource, {
        origin: 'upload',
        registerInCatalog: true,
        preserveCurrentFilter: true,
        mode,
      });
    } catch (error) {
      setState({ errorMessage: error.message });
    }
  }

  async function loadRemoteSource(
    ctx,
    input,
    {
      syncSearchParam = true,
      visitedUrls = new Set(),
      skipPrepare = false,
      registerInCatalog = true,
      filterDefaults = NO_FILTER_DEFAULTS,
      preserveCurrentFilter = false,
      mode = 'replace',
    } = {},
  ) {
    const adding = mode === 'add';
    const requestedUrl = String(input).trim();
    if (!requestedUrl) {
      if (skipPrepare) {
        setState({ loadingMessage: '' });
      }
      setState({ errorMessage: 'Enter a URL first.' });
      return;
    }

    const normalizedRequestedUrl = normalizeComparableUrl(requestedUrl);
    if (normalizedRequestedUrl && visitedUrls.has(normalizedRequestedUrl)) {
      if (skipPrepare) {
        setState({ loadingMessage: '' });
      }
      setState({ errorMessage: `Detected a loop while following linked databases from ${requestedUrl}.` });
      return;
    }

    if (adding) {
      setState({ addingMessage: `Fetching ${requestedUrl}...`, errorMessage: '' });
    } else if (!skipPrepare) {
      setState({ loadingMessage: `Fetching ${requestedUrl}...`, errorMessage: '' });
      clearLoadedSource();
    }

    try {
      const loadedSource = await loadDatabaseSourceUrl(requestedUrl);
      await handleLoadedSource(ctx, loadedSource, {
        origin: 'url',
        requestedUrl,
        syncSearchParam,
        visitedUrls: addVisitedUrls(visitedUrls, requestedUrl, loadedSource),
        registerInCatalog,
        filterDefaults,
        preserveCurrentFilter,
        mode,
      });
    } catch (error) {
      setState({ errorMessage: error.message });
    } finally {
      setState(adding ? { addingMessage: '' } : { loadingMessage: '' });
    }
  }

  // Opens a remote source that was fetched while databases were loaded, alone or combined with them.
  async function openFetchedSource(ctx, requestedUrl, loadedSource, mode) {
    if (mode === 'replace') {
      queueCurrentFilterForPreservedLoad(ctx, true);
      clearLoadedSource();
    }

    try {
      await handleLoadedSource(ctx, loadedSource, {
        origin: 'url',
        requestedUrl,
        visitedUrls: addVisitedUrls(new Set(), requestedUrl, loadedSource),
        registerInCatalog: true,
        preserveCurrentFilter: mode === 'replace',
        mode,
      });
    } catch (error) {
      setState({ errorMessage: error.message });
    }
  }

  // The Fetch card: opens the URL in its box.
  function loadUrl(ctx) {
    if (!ctx.databases.length) {
      queueCurrentFilterForPreservedLoad(ctx, true);
      void loadRemoteSource(ctx, ctx.databaseUrl, { preserveCurrentFilter: true });
      return;
    }

    const requestedUrl = String(ctx.databaseUrl).trim();
    if (!requestedUrl) {
      setState({ errorMessage: 'Enter a URL first.' });
      return;
    }

    // A loaded URL fetched again is a reload, so the browser's cached copy will not do.
    const reload = isLoadedUrl(ctx.databases, requestedUrl);
    void readSourceThenAsk(
      ctx,
      `Fetching ${requestedUrl}...`,
      () => loadDatabaseSourceUrl(requestedUrl, { reload }),
      (loadedSource, mode) => openFetchedSource(ctx, requestedUrl, loadedSource, mode),
    );
  }

  // Opens one entry of a database list, under the chosen [mister] filter (or none).
  function loadIniEntry(ctx, entry, { misterFilter = null, mode = 'replace' } = {}) {
    if (!entry?.dbUrl) {
      return;
    }

    const filterDefaults = buildListEntryFilterDefaults(entry, misterFilter);
    if (mode === 'add') {
      clearChoice();
      void loadRemoteSource(ctx, entry.dbUrl, { registerInCatalog: false, filterDefaults, mode });
      return;
    }

    const loadEntry = (preserveCurrentFilter) =>
      startRemoteDatabaseLoad(ctx, entry.dbUrl, { registerInCatalog: false, filterDefaults, preserveCurrentFilter });

    if (
      maybeConfirmFilterOverride(ctx, {
        nextFilter: filterDefaults.sourceDefaultFilter,
        nextFilterPresent: entry.defaultFilterExplicit,
        onAccept: () => loadEntry(false),
        onDecline: () => loadEntry(true),
      })
    ) {
      return;
    }

    loadEntry(!entry.defaultFilterExplicit);
  }

  // Opens databases chosen in a picker. It asks whether to combine only when a loaded database is
  // not part of the selection, since opening the selection alone would close that database.
  function requestSelectionLoad(ctx, entries, start) {
    if (selectionIncludesLoadedDatabases(entries, ctx.databases)) {
      start('replace');
      return;
    }

    requestLoad(ctx, start, entries.length);
  }

  function openCatalogSelection(ctx, entries) {
    requestSelectionLoad(ctx, entries, (mode) => {
      if (entries.length === 1) {
        const [entry] = entries;
        // An uploaded database is opened again from its file.
        const upload = uploadedFiles.get(entry.dbUrl);
        if (upload) {
          void openLocalDatabase(ctx, { file: upload.file, origin: upload.label }, mode);
          return;
        }

        startRemoteDatabaseLoad(ctx, entry.dbUrl, {
          registerInCatalog: Boolean(entry.dbIdApproximate),
          preserveCurrentFilter: true,
          mode,
        });
        return;
      }

      void loadDatabaseSelection(ctx, entries, mode);
    });
  }

  // Opens databases chosen from a database list or from uploaded files.
  function openChoiceSelection(ctx, entries, { misterFilter }) {
    requestSelectionLoad(ctx, entries, (mode) => {
      if (entries.length === 1) {
        const [entry] = entries;
        if (entry.file) {
          void openLocalDatabase(ctx, entry, mode, misterFilter);
        } else {
          loadIniEntry(ctx, entry, { misterFilter, mode });
        }
        return;
      }

      void loadDatabaseSelection(ctx, entries, mode, { misterFilter });
    });
  }

  // Back/forward navigation: opens what the address names, as when the page was first opened.
  function handlePopState() {
    const combinedSession = parseCombinedSearch(window.location.search);
    if (combinedSession) {
      void loadCombinedSession(INITIAL_CTX, combinedSession);
      return;
    }

    const sharedDatabaseUrl = readDatabaseUrlSearchParam();
    const sharedFilter = readFilterSearchParam();
    setState({
      databaseUrl: sharedDatabaseUrl,
      filterInput: sharedFilter.isPresent ? sharedFilter.value : '',
      debouncedFilterInput: sharedFilter.isPresent ? sharedFilter.value : '',
      errorMessage: '',
    });

    if (sharedDatabaseUrl) {
      void loadRemoteSource(INITIAL_CTX, sharedDatabaseUrl, { syncSearchParam: false });
      return;
    }

    if (refs.iniSource?.source?.sourceKind === 'url') {
      setState({ iniSource: null });
    }

    if (refs.databases.length > 1 || refs.inspection?.source?.sourceKind === 'url') {
      setState({
        databases: [],
        combinedFilters: NO_COMBINED_FILTERS,
        debouncedCombinedFilters: NO_COMBINED_FILTERS,
      });
    }
  }

  // Opens what a shared link names, once.
  function loadSharedDatabase() {
    const combinedSession = parseCombinedSearch(window.location.search);
    if (combinedSession) {
      void loadCombinedSession(INITIAL_CTX, combinedSession);
      return;
    }

    const sharedDatabaseUrl = readDatabaseUrlSearchParam();
    if (sharedDatabaseUrl) {
      void loadRemoteSource(INITIAL_CTX, sharedDatabaseUrl, { syncSearchParam: false });
    }
  }

  // Known databases fetched at runtime from the Update_All and MultiDatabases sources.
  async function loadRuntimeCatalog() {
    try {
      const entries = await loadRuntimeDatabaseCatalog();
      setState({ runtimeCatalog: { entries, status: 'ready', error: '' } });
    } catch (loadError) {
      setState({ runtimeCatalog: { entries: [], status: 'error', error: loadError.message } });
    }
  }

  // Starts the model on the page, after the reactions of the first render: a shared link opens, and
  // the catalog loads (after the link, so its request starts first). Returns what stops it: back
  // and forward navigation are no longer followed, and uploads' object URLs are released.
  function connect() {
    if (!started) {
      started = true;
      loadSharedDatabase();
      void loadRuntimeCatalog();
    }

    if (!connected) {
      connected = true;
      window.addEventListener('popstate', handlePopState);
    }

    return () => {
      connected = false;
      window.removeEventListener('popstate', handlePopState);
      for (const url of uploadedFiles.keys()) {
        URL.revokeObjectURL(url);
      }
      uploadedFiles.clear();
    };
  }

  // A database's own filter starts as the filter it gets now.
  function addOwnFilter(dbId) {
    const database = selectIsCombined(committed)
      ? committed.databases.find(({ inspection }) => inspection.overview.dbId === dbId)
      : null;
    const effectiveFilter = database
      ? resolveDownloaderFilter(downloaderFilterInputs(committed.debouncedCombinedFilters, database.inspection))
      : '';
    setState((current) => ({
      combinedFilters: { ...current.combinedFilters, overrides: { ...current.combinedFilters.overrides, [dbId]: effectiveFilter } },
    }));
  }

  function removeOwnFilter(dbId) {
    setState((current) => {
      const { [dbId]: removed, ...overrides } = current.combinedFilters.overrides;
      return { combinedFilters: { ...current.combinedFilters, overrides } };
    });
  }

  return {
    getState,
    subscribe,
    commit,
    runReactions,
    connect,
    answerPrompt,
    escape,
    setDatabaseUrl: (databaseUrl) => setState({ databaseUrl }),
    loadUrl: () => loadUrl(makeCtx()),
    openDrop: (drop) => openDrop(makeCtx(), drop),
    openChosenFiles: (files) => openChosenFiles(makeCtx(), files),
    openCatalog: () => setState({ catalogModalOpen: true }),
    closeCatalog: () => setState({ catalogModalOpen: false }),
    openCatalogSelection: (entries) => openCatalogSelection(makeCtx(), entries),
    openChoicePicker: () => setState({ choicePickerOpen: true }),
    closeChoicePicker: () => setState({ choicePickerOpen: false }),
    openChoiceSelection: (entries, options) => openChoiceSelection(makeCtx(), entries, options),
    setFilterInput: (filterInput) => setState({ filterInput }),
    resetFilter: () => setState({ filterInput: selectEffectiveDefaultFilter(committed) }),
    setSharedFilter: (value) =>
      setState((current) => ({ combinedFilters: { ...current.combinedFilters, shared: { isSet: true, value } } })),
    resetSharedFilter: () => setState((current) => ({ combinedFilters: { ...current.combinedFilters, shared: UNSET_FILTER } })),
    setOwnFilter: (dbId, value) =>
      setState((current) => ({
        combinedFilters: { ...current.combinedFilters, overrides: { ...current.combinedFilters.overrides, [dbId]: value } },
      })),
    addOwnFilter,
    removeOwnFilter,
  };
}
