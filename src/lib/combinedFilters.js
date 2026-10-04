import { normalizeFilterPromptValue, resolveDownloaderFilter, resolveEffectiveDefaultFilter } from './filterDefaults.js';

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

export function buildCombinedUrlState(databases, filters) {
  return {
    databases: databases.map(({ inspection }) => ({
      dbId: inspection.overview.dbId,
      url: inspection.source.sourceKind === 'url' ? inspection.source.sourceLabel : null,
    })),
    sharedFilter: filters.shared,
    overrides: filters.overrides,
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
// database and the first item that would replace it.
export function findLoadedDbIdConflicts(databases, items) {
  const conflicts = [];
  for (const item of items) {
    const dbId = item.inspection.overview.dbId;
    const loaded = databases.find(({ inspection }) => inspection.overview.dbId === dbId);
    if (loaded && !conflicts.some((conflict) => conflict.dbId === dbId)) {
      conflicts.push({ dbId, loaded, incoming: item });
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
