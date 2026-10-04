import {
  NO_FILTER_DEFAULTS,
  normalizeFilterPromptValue,
  resolveDownloaderFilter,
  resolveEffectiveDefaultFilter,
} from './filterDefaults.js';
import { isReloadOf } from './selection.js';

// The filters of combined databases, as in downloader.ini: a shared filter (the [mister] filter)
// and each database's own filter, by db_id. Filters are { isSet, value }; a set filter applies
// even when empty.

export const UNSET_FILTER = Object.freeze({ isSet: false, value: '' });

// How the filter applied to each combined database is shown: the filter (or Everything) and where
// it comes from (see resolveDownloaderFilterSource).
const FILTER_SOURCE_LABELS = {
  own: 'its own filter',
  default: 'database default',
  shared: 'shared filter',
  none: 'no filter',
};

export function describeAppliedFilter({ effectiveFilter, filterSource }) {
  return { filter: effectiveFilter || 'Everything', source: FILTER_SOURCE_LABELS[filterSource] };
}
export const NO_COMBINED_FILTERS = Object.freeze({ shared: UNSET_FILTER, overrides: Object.freeze({}) });

// The applied filters to list for combined databases ({ dbId, effectiveFilter, filterSource }):
// each one's, or, unless `listEach`, only those that have a filter of their own or a default of
// their own, with the rest grouped by the filter they get ({ filter, source, count }).
export function listAppliedFilters(databases, { listEach }) {
  if (listEach) {
    return { listed: databases, rest: [] };
  }

  const listed = databases.filter(({ filterSource }) => filterSource === 'own' || filterSource === 'default');
  const groups = new Map();
  for (const database of databases) {
    if (listed.includes(database)) {
      continue;
    }

    const { filter, source } = describeAppliedFilter(database);
    const key = `${source}\n${filter}`;
    const group = groups.get(key) ?? { filter, source, count: 0 };
    group.count += 1;
    groups.set(key, group);
  }

  return { listed, rest: [...groups.values()] };
}

// What decides the filter Downloader would give one of several databases.
export function downloaderFilterInputs(filters, inspection) {
  const dbId = inspection.overview.dbId;
  return {
    misterFilter: filters.shared,
    sectionFilter: Object.hasOwn(filters.overrides, dbId)
      ? { isSet: true, value: filters.overrides[dbId] }
      : UNSET_FILTER,
    databaseDefaultFilter: inspection.overview.defaultFilter,
  };
}

// The link of combined databases (see urlState.js): the URLs of those loaded from one, in order,
// the shared filter, and their own filters. Uploaded databases cannot be shared. A link with only
// one database shows it alone, so when only one can be shared, it keeps the filter it gets among the
// others as its own, unless it would get the same FILTER alone.
export function buildCombinedLink(databases, filters) {
  const shared = databases
    .map(({ inspection }) => inspection)
    .filter((inspection) => inspection.source.sourceKind === 'url');
  const overrides = Object.fromEntries(
    shared
      .filter((inspection) => Object.hasOwn(filters.overrides, inspection.overview.dbId))
      .map((inspection) => [inspection.overview.dbId, filters.overrides[inspection.overview.dbId]]),
  );

  if (shared.length === 1 && !Object.keys(overrides).length) {
    const [inspection] = shared;
    const filter = resolveDownloaderFilter(downloaderFilterInputs(filters, inspection));
    const filterAlone = filters.shared.isSet
      ? filters.shared.value
      : resolveEffectiveDefaultFilter({ ...NO_FILTER_DEFAULTS, databaseDefaultFilter: inspection.overview.defaultFilter || '' });
    if (filter !== filterAlone) {
      overrides[inspection.overview.dbId] = filter;
    }
  }

  return {
    databases: shared.map((inspection) => inspection.source.sourceLabel),
    filter: filters.shared,
    overrides,
  };
}

// When a second database joins a loaded one: the shared filter starts as the [mister] filter of
// the first database's list, if any, and the first database's FILTER stays as its own filter when
// it differs from what the database would get without one.
export function startCombinedFilters({ inspection, filterDefaults }, currentFilter) {
  const shared = filterDefaults.misterDefaultFilterPresent
    ? { isSet: true, value: filterDefaults.misterDefaultFilter }
    : UNSET_FILTER;
  const filters = { shared, overrides: {} };
  const withoutOwnFilter = resolveDownloaderFilter(downloaderFilterInputs(filters, inspection));
  if (normalizeFilterPromptValue(currentFilter) === normalizeFilterPromptValue(withoutOwnFilter)) {
    return filters;
  }

  return { shared, overrides: { [inspection.overview.dbId]: currentFilter } };
}

// A database that joins from a database list keeps the filter that list gives it, as its own
// filter when the combined filters would give it a different one.
export function addIncomingDatabaseFilters(filters, inspection, filterDefaults) {
  if (!filterDefaults.misterDefaultFilterPresent && !filterDefaults.sourceDefaultFilterPresent) {
    return filters;
  }

  const fromList = resolveEffectiveDefaultFilter({
    ...filterDefaults,
    databaseDefaultFilter: inspection.overview.defaultFilter || '',
  });
  const withoutOwnFilter = resolveDownloaderFilter(downloaderFilterInputs(filters, inspection));
  if (normalizeFilterPromptValue(fromList) === normalizeFilterPromptValue(withoutOwnFilter)) {
    return filters;
  }

  return { ...filters, overrides: { ...filters.overrides, [inspection.overview.dbId]: fromList } };
}

// A new session of several databases ({ inspection, filterDefaults, ownFilter }), leaving out (in
// `rejected`) any whose db_id an earlier one has. A database's `ownFilter`, such as the filter of its
// downloader.ini section, is kept as written, so [mister] in it still means the shared filter.
export function startSession(items, sharedFilter) {
  const databases = [];
  const rejected = [];
  const overrides = {};
  for (const { inspection, filterDefaults, ownFilter = null } of items) {
    const dbId = inspection.overview.dbId;
    if (databases.some((database) => database.inspection.overview.dbId === dbId)) {
      rejected.push({ inspection, filterDefaults });
      continue;
    }

    databases.push({ inspection, filterDefaults });
    if (ownFilter !== null) {
      overrides[dbId] = ownFilter;
    }
  }

  return { databases, filters: { shared: sharedFilter, overrides }, rejected };
}

// The loaded databases that some of `items` share a db_id with: for each such db_id, the loaded
// database and the first item that would replace it, and whether that item is the loaded database
// again (from the same URL), which replacing would reload.
export function findLoadedDbIdConflicts(databases, items) {
  const conflicts = [];
  for (const item of items) {
    const dbId = item.inspection.overview.dbId;
    const loaded = databases.find(({ inspection }) => inspection.overview.dbId === dbId);
    if (loaded && !conflicts.some((conflict) => conflict.dbId === dbId)) {
      conflicts.push({ dbId, loaded, incoming: item, reload: isReloadOf(loaded.inspection, item.inspection) });
    }
  }

  return conflicts;
}

// Adds databases ({ inspection, filterDefaults }) to the loaded ones. One whose db_id is loaded
// takes the loaded one's place when its db_id is in `replaceDbIds`, and is otherwise left out (in
// `rejected`), as is any whose db_id an earlier item has. `currentFilter` is the FILTER of a single
// loaded database.
export function addDatabasesToSession({ databases, filters }, items, currentFilter, replaceDbIds = new Set()) {
  let nextDatabases = databases;
  let nextFilters = filters;
  const rejected = [];
  const placedDbIds = new Set();
  for (const item of items) {
    const dbId = item.inspection.overview.dbId;
    const index = nextDatabases.findIndex(({ inspection }) => inspection.overview.dbId === dbId);
    if (index !== -1) {
      if (placedDbIds.has(dbId) || !replaceDbIds.has(dbId)) {
        rejected.push(item);
        continue;
      }

      nextDatabases = nextDatabases.map((database, position) => (position === index ? item : database));
      if (nextDatabases.length > 1) {
        nextFilters = addIncomingDatabaseFilters(nextFilters, item.inspection, item.filterDefaults);
      }
      placedDbIds.add(dbId);
      continue;
    }

    if (nextDatabases.length === 1) {
      nextFilters = startCombinedFilters(nextDatabases[0], currentFilter);
    }

    if (nextDatabases.length) {
      nextFilters = addIncomingDatabaseFilters(nextFilters, item.inspection, item.filterDefaults);
    }

    nextDatabases = [...nextDatabases, item];
    placedDbIds.add(dbId);
  }

  return { databases: nextDatabases, filters: nextFilters, rejected };
}
