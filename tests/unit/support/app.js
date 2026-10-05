import { strToU8, zipSync } from 'fflate';

import { createAppModel } from '../../../src/model/appModel.js';
import {
  selectCatalogOptions,
  selectCatalogStatus,
  selectChoice,
  selectEffectiveDefaultFilter,
  selectInspection,
} from '../../../src/model/selectors.js';
import {
  buildArchivesIndex,
  buildCollisionsIndex,
  buildCombinedView,
  buildDisplayedInspection,
  buildFilesystemIndex,
  buildTagGroups,
  canResetFilter,
  hasEssentialTag,
  hasUntaggedRows,
  selectTagDictionary,
} from '../../../src/model/views.js';
import { describeAppliedFilter } from '../../../src/lib/combinedFilters.js';
import { findLoadedKeys, findUpdateAllDefaultKeys, selectOnePerDbId } from '../../../src/lib/selection.js';
import {
  chosenMisterFilter,
  describePickerEntry,
  filterPickerEntries,
  firstMisterKey,
  openButtonLabel,
  pickerToggleAllLabel,
  reducePickerSelection,
  selectedPickerEntries,
  startPickerSelection,
} from '../../../src/lib/pickerSelection.js';
import { findSearchMatches } from '../../../src/lib/search.js';
import { FILTER_INPUT_DEBOUNCE_MS, buildCombinedFilterSummaryCopy, buildFilterSummaryCopy } from '../../../src/lib/utils.js';
import { installBrowser } from './browser.js';

const ORIGIN = 'http://localhost';

// A file to upload. Objects become JSON.
export function file(name, content) {
  const bytes = content instanceof Uint8Array ? content : strToU8(typeof content === 'string' ? content : JSON.stringify(content));
  return new File([bytes], name);
}

export function zipJson(value, name = 'db.json') {
  return zipSync({ [name]: strToU8(JSON.stringify(value)) });
}

// The folders and files of a drop, as browsers list them (FileSystemEntry), from { path: content }.
export function droppedEntries(files) {
  const root = { children: new Map() };
  for (const [path, content] of Object.entries(files)) {
    const parts = path.split('/');
    let folder = root;
    parts.slice(0, -1).forEach((part, index) => {
      if (!folder.children.has(part)) {
        folder.children.set(part, { name: part, fullPath: `/${parts.slice(0, index + 1).join('/')}`, children: new Map() });
      }
      folder = folder.children.get(part);
    });
    const name = parts.at(-1);
    folder.children.set(name, { name, fullPath: `/${path}`, content });
  }

  const toEntry = (node) =>
    node.children
      ? {
          isFile: false,
          isDirectory: true,
          name: node.name,
          fullPath: node.fullPath,
          createReader() {
            let read = false;
            return {
              readEntries(resolve) {
                resolve(read ? [] : [...node.children.values()].map(toEntry));
                read = true;
              },
            };
          },
        }
      : { isFile: true, isDirectory: false, name: node.name, fullPath: node.fullPath, file: (resolve) => resolve(file(node.name, node.content)) };
  return [...root.children.values()].map(toEntry);
}

// The app, opened at `path` in a fresh browser, driven the way the page drives it.
export async function openApp(path = '/', { routes = {} } = {}) {
  const browser = installBrowser(new URL(path, ORIGIN).href, { routes });
  const app = startApp(browser);
  await app.settle();
  return app;
}

// Renders the model as the page does: each change commits a render a moment later (a microtask,
// as a synchronous React update), whose reactions then run, and the model starts after the first
// render. Returns what unmounts it.
function mount(model) {
  let renderScheduled = false;
  const render = () => {
    renderScheduled = false;
    const snapshot = model.getState();
    model.commit(snapshot);
    model.runReactions(snapshot);
  };
  const unsubscribe = model.subscribe(() => {
    if (!renderScheduled) {
      renderScheduled = true;
      queueMicrotask(render);
    }
  });
  render();
  const disconnect = model.connect();
  return () => {
    unsubscribe();
    disconnect();
  };
}

function startApp(browser) {
  let model = createAppModel();
  let unmount = mount(model);
  let picker = null;
  let closed = false;

  async function settle() {
    let quietRounds = 0;
    for (let round = 0; round < 5000; round += 1) {
      const before = model.getState();
      const ran = browser.clock.runDue();
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (!ran && model.getState() === before) {
        quietRounds += 1;
        if (quietRounds >= 12) {
          return;
        }
      } else {
        quietRounds = 0;
      }
    }
    throw new Error('The app kept changing');
  }

  // Answers the question about loaded db_ids with a button of its dialog, which differs for 'one'
  // database and 'several'.
  async function answerReplaceQuestion(about, answerFor) {
    const prompt = model.getState().prompt;
    const count = prompt?.kind === 'replaceLoaded' ? prompt.conflicts.length : 0;
    if (about === 'several' ? count < 2 : count !== 1) {
      throw new Error(`Expected a question about ${about} loaded database(s), got ${prompt?.kind ?? 'none'} about ${count}`);
    }
    // About one database, the question is whether to replace it, or to reload it when the new one
    // is the loaded one again.
    const reload = count === 1 && prompt.conflicts[0].reload;
    if ((about === 'replace one' && reload) || (about === 'reload one' && !reload)) {
      throw new Error(`Expected the question to ${about.split(' ')[0]} the loaded database, got the one to ${reload ? 'reload' : 'replace'} it`);
    }
    model.answerPrompt(answerFor(prompt.conflicts));
    await settle();
  }

  // Lets the debounced FILTERs catch up, as typing pauses do.
  async function pause() {
    await settle();
    browser.clock.advance(FILTER_INPUT_DEBOUNCE_MS);
    await settle();
  }

  // A database picker (the catalog, or a list's or an upload's) as DatabasePickerModal runs it.
  function createPicker(kind) {
    const state = model.getState();
    const choice = kind === 'catalog' ? null : selectChoice(state);
    const entries = kind === 'catalog' ? selectCatalogOptions(state) : choice.entries;
    const preferredKeys = kind === 'catalog' ? findUpdateAllDefaultKeys(entries) : [];
    let selection = startPickerSelection(kind === 'catalog' ? [] : selectOnePerDbId(entries));
    let misterKey = choice ? firstMisterKey(choice) : null;
    // The entries the search shows.
    let shown = entries;
    const dispatch = (action) => {
      selection = reducePickerSelection(selection, action, { entries, preferredKeys });
    };
    const entryNamed = (name) => {
      const entry = entries.find((candidate) => describePickerEntry(candidate) === name);
      if (!entry) {
        throw new Error(`No picker entry named ${name}: ${entries.map(describePickerEntry).join(', ')}`);
      }
      return entry;
    };

    return {
      kind,
      choice,
      entries,
      get names() {
        return entries.map(describePickerEntry);
      },
      get selected() {
        return selectedPickerEntries(entries, selection).map(describePickerEntry);
      },
      get selectedDbIds() {
        return selectedPickerEntries(entries, selection).map((entry) => entry.dbId);
      },
      get loaded() {
        const loadedKeys = findLoadedKeys(entries, model.getState().databases);
        return entries.filter((entry) => loadedKeys.has(entry.key)).map(describePickerEntry);
      },
      get conflict() {
        return selection.conflict;
      },
      get toggleAllLabel() {
        return pickerToggleAllLabel(entries, shown, selection);
      },
      get openLabel() {
        return openButtonLabel(selectedPickerEntries(entries, selection).length);
      },
      get misterOptions() {
        return choice?.misterOptions ?? [];
      },
      get misterKey() {
        return misterKey;
      },
      // Types the search, and returns the entries it shows.
      search(query) {
        shown = filterPickerEntries(entries, query.trim().toLowerCase());
        return shown.map(describePickerEntry);
      },
      click(name) {
        dispatch({ type: 'toggle', entry: entryNamed(name) });
      },
      check(name) {
        const entry = entryNamed(name);
        if (!selection.selectedKeys.has(entry.key)) {
          dispatch({ type: 'toggle', entry });
        }
      },
      uncheck(name) {
        const entry = entryNamed(name);
        if (selection.selectedKeys.has(entry.key)) {
          dispatch({ type: 'toggle', entry });
        }
      },
      toggleAll() {
        dispatch({ type: 'toggleAll', shown });
      },
      selectUpdateAllDefaults() {
        dispatch({ type: 'preset', keys: preferredKeys });
      },
      replaceConflict() {
        dispatch({ type: 'replaceConflict' });
      },
      cancelConflict() {
        dispatch({ type: 'cancelConflict' });
      },
      setMister(key) {
        misterKey = key;
      },
      // Closes the picker, then opens the selection after the next paint, as the Open button does.
      async open() {
        const chosen = selectedPickerEntries(entries, selection);
        model[kind === 'catalog' ? 'closeCatalog' : 'closeChoicePicker']();
        picker = null;
        await settle();
        if (kind === 'catalog') {
          model.openCatalogSelection(chosen);
        } else {
          model.openChoiceSelection(chosen, { misterFilter: chosenMisterFilter(choice, misterKey) });
        }
        await settle();
      },
      async close() {
        if (kind === 'catalog') {
          model.closeCatalog();
        } else {
          model.closeChoicePicker();
        }
        picker = null;
        await settle();
      },
    };
  }

  const app = {
    browser,
    get model() {
      return model;
    },
    get state() {
      return model.getState();
    },
    settle,
    pause,
    // The page's link, after the #, as written.
    get hash() {
      return browser.window.location.hash;
    },
    get url() {
      return browser.window.location.href;
    },
    get historyLength() {
      return browser.window.history.length;
    },
    get prompt() {
      return model.getState().prompt;
    },
    get errorMessage() {
      return model.getState().errorMessage;
    },
    get filter() {
      return model.getState().filterInput;
    },
    get databaseUrl() {
      return model.getState().databaseUrl;
    },
    get catalog() {
      const state = model.getState();
      return { options: selectCatalogOptions(state), status: selectCatalogStatus(state) };
    },
    get canResetFilter() {
      const state = model.getState();
      return canResetFilter(state.filterInput, selectEffectiveDefaultFilter(state));
    },
    // What the page shows below the loaders.
    get view() {
      const state = model.getState();
      const inspection = selectInspection(state);
      const displayed = buildDisplayedInspection(inspection, state.debouncedFilterInput);
      const combined = buildCombinedView(state.databases, state.debouncedCombinedFilters);
      const active = combined ?? displayed;
      // A row's heading, and the database chip next to it in combined views.
      const rows = (index) =>
        index
          ? [...index.rowsById.values()].map((row) =>
              row.type === 'archive'
                ? { name: row.archive.title, dbId: row.archive.dbId ?? null }
                : { name: row.node.name, dbId: row.node.dbId ?? null },
            )
          : [];
      const filesystemIndex = buildFilesystemIndex(active);
      const archivesIndex = buildArchivesIndex(active);
      const collisionsIndex = buildCollisionsIndex(combined);
      const tagGroups = buildTagGroups(combined, selectTagDictionary(displayed));
      return {
        inspection: displayed,
        combined,
        heading: combined ? `${state.databases.length} combined databases` : inspection?.overview.dbId ?? null,
        cards: combined ? state.databases.map(({ inspection: database }) => database.overview.dbId) : [],
        files: rows(filesystemIndex).map(({ name }) => name),
        archives: rows(archivesIndex).map(({ name }) => name),
        collisions: rows(collisionsIndex).map(({ name }) => name),
        fileRows: rows(filesystemIndex),
        archiveRows: rows(archivesIndex),
        collisionRows: rows(collisionsIndex),
        filesystemIndex,
        archivesIndex,
        collisionsIndex,
        tagGroups,
        hasEssentialHint: hasEssentialTag(tagGroups),
        hasUntaggedItems: hasUntaggedRows(filesystemIndex),
        summary: combined ? buildCombinedFilterSummaryCopy(combined) : displayed ? buildFilterSummaryCopy(displayed.activeFilter) : null,
        issues: active?.issues.map((issue) => issue.message) ?? [],
        appliedFilters: combined?.databases.map((database) => {
          const applied = describeAppliedFilter(database);
          return `${database.dbId}${applied.filter}${applied.source}`;
        }),
        choice: selectChoice(state),
      };
    },
    get picker() {
      return picker;
    },
    // The FILTER boxes of combined databases: the shared one, and each database's own.
    get sharedFilter() {
      return model.getState().combinedFilters.shared.value;
    },
    ownFilter(dbId) {
      return model.getState().combinedFilters.overrides[dbId];
    },
    // The find bar's matches for a query, in the order Enter goes through them.
    find(query) {
      const { filesystemIndex, archivesIndex, collisionsIndex, hasEssentialHint } = app.view;
      return findSearchMatches({ query, filesystemIndex, archivesIndex, collisionsIndex, hasEssentialHint });
    },

    // Chosen files: one opens as it is; several offer their databases to choose from.
    async upload(...files) {
      model.openChosenFiles(files);
      await settle();
    },
    async drop(entries) {
      await model.openDrop({ entries, files: [] });
      await settle();
    },
    // Types the URL, then presses Fetch.
    async fetch(url) {
      model.setDatabaseUrl(url);
      await settle();
      model.loadUrl();
      await settle();
    },
    // Types in FILTER, then waits as long as a typing pause; `{ pause: false }` goes on at once,
    // before the debounced FILTER catches up.
    async typeFilter(value, { pause: waits = true } = {}) {
      model.setFilterInput(value);
      await (waits ? pause() : settle());
    },
    async clearFilter() {
      model.resetFilter();
      await pause();
    },
    async typeSharedFilter(value, { pause: waits = true } = {}) {
      model.setSharedFilter(value);
      await (waits ? pause() : settle());
    },
    async giveOwnFilter(dbId) {
      model.addOwnFilter(dbId);
      await pause();
    },
    async typeOwnFilter(dbId, value) {
      model.setOwnFilter(dbId, value);
      await pause();
    },
    // Answers the question on screen, checking it is the expected one.
    async answer(kind, value) {
      const prompt = model.getState().prompt;
      if (prompt?.kind !== kind) {
        throw new Error(`Expected a ${kind} question, got ${prompt?.kind ?? 'none'}`);
      }
      model.answerPrompt(value);
      await settle();
    },
    loadAlone() {
      return app.answer('loadMode', 'replace');
    },
    combine() {
      return app.answer('loadMode', 'add');
    },
    cancelLoad() {
      return app.answer('loadMode', null);
    },
    // The answers of the question about loaded db_ids (ReplaceLoadedModal). About one database it
    // offers "Keep the loaded one" and "Replace it", or "Reload it" when the new database is the
    // loaded one again; about several, a checkbox each (all checked at first), Cancel and Continue.
    keepLoaded() {
      return answerReplaceQuestion('one', () => new Set());
    },
    replaceIt() {
      return answerReplaceQuestion('replace one', ([{ dbId }]) => new Set([dbId]));
    },
    reloadIt() {
      return answerReplaceQuestion('reload one', ([{ dbId }]) => new Set([dbId]));
    },
    continueReplacing(...checkedDbIds) {
      return answerReplaceQuestion('several', () => new Set(checkedDbIds));
    },
    cancelReplace() {
      return answerReplaceQuestion('several', () => null);
    },
    async escape() {
      model.escape();
      await settle();
    },
    openCatalog() {
      model.openCatalog();
      picker = createPicker('catalog');
      return picker;
    },
    // The list or upload picker that is open.
    openChoice() {
      if (!model.getState().choicePickerOpen) {
        model.openChoicePicker();
      }
      picker = createPicker('choice');
      return picker;
    },
    // Types a link to another # of this page in the address bar.
    async openLink(hash) {
      browser.window.navigate(hash);
      await settle();
    },
    async back() {
      browser.window.history.back();
      await settle();
    },
    async forward() {
      browser.window.history.forward();
      await settle();
    },
    // A new page at the same address, as a reload.
    async reload() {
      unmount();
      model = createAppModel();
      unmount = mount(model);
      picker = null;
      await settle();
    },
    close() {
      if (!closed) {
        closed = true;
        unmount();
        browser.restore();
      }
    },
  };
  return app;
}
