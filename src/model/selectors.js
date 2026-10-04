import { mergeCatalogEntries } from '../lib/catalog.js';
import { buildIniListFilterDefaults, NO_FILTER_DEFAULTS, resolveEffectiveDefaultFilter } from '../lib/filterDefaults.js';
import { buildListChoice } from '../lib/selection.js';

// Values derived from the app model's state, shared by the React view and the reactions of the
// model. Values whose identity matters (a list's choice, the catalog) are cached per input.

export function selectInspection(state) {
  return state.databases.length === 1 ? state.databases[0].inspection : null;
}

export function selectIsCombined(state) {
  return state.databases.length > 1;
}

// Names what is loaded: a new value means a new source, which resets FILTER.
export function selectInspectionKeyBase(state) {
  const inspection = selectInspection(state);
  if (selectIsCombined(state)) {
    return `combined:${state.databases
      .map(({ inspection: { source, overview } }) => `${source.sourceLabel}:${overview.dbId}:${overview.timestamp}`)
      .join('|')}`;
  }

  return inspection ? `${inspection.source.sourceLabel}:${inspection.overview.dbId}:${inspection.overview.timestamp}` : 'empty';
}

const listChoices = new WeakMap();

export function selectListChoice(state) {
  const { iniSource } = state;
  if (!iniSource) {
    return null;
  }

  if (!listChoices.has(iniSource)) {
    listChoices.set(iniSource, buildListChoice(iniSource));
  }
  return listChoices.get(iniSource);
}

// A database list, or uploaded files, whose databases are being chosen.
export function selectChoice(state) {
  return state.uploadChoice ?? selectListChoice(state);
}

// Default filters contributed by the loaded source: the database's INI entry, or a database list's
// [mister] section while one of its entries is being chosen.
export function selectSourceFilterDefaults(state) {
  if (state.databases.length) {
    return state.databases[0].filterDefaults;
  }

  return state.iniSource ? buildIniListFilterDefaults(state.iniSource) : NO_FILTER_DEFAULTS;
}

export function selectEffectiveDefaultFilter(state) {
  return resolveEffectiveDefaultFilter({
    ...selectSourceFilterDefaults(state),
    databaseDefaultFilter: selectInspection(state)?.overview.defaultFilter || '',
  });
}

let catalogInputs = null;
let catalogOptions = [];

// The catalog: session entries merged over the runtime catalog.
export function selectCatalogOptions(state) {
  const { customCatalogOptions, runtimeCatalog } = state;
  if (catalogInputs?.custom !== customCatalogOptions || catalogInputs?.runtime !== runtimeCatalog.entries) {
    catalogInputs = { custom: customCatalogOptions, runtime: runtimeCatalog.entries };
    catalogOptions = mergeCatalogEntries(customCatalogOptions, runtimeCatalog.entries);
  }
  return catalogOptions;
}

export function selectCatalogStatus(state) {
  return selectCatalogOptions(state).length > 0 ? 'ready' : state.runtimeCatalog.status;
}
