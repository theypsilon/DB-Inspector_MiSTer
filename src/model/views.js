import { applyInspectionFilter, summarizeInspectionStorage } from '../lib/database.js';
import { buildCollisionTree, combineDatabaseViews } from '../lib/combine.js';
import { downloaderFilterInputs } from '../lib/combinedFilters.js';
import { normalizeFilterPromptValue, resolveDownloaderFilter, resolveDownloaderFilterSource } from '../lib/filterDefaults.js';
import { buildFlatArchiveIndex, buildFlatNodeIndex } from '../lib/treeIndex.js';
import { selectInspectionKeyBase, selectIsCombined } from './selectors.js';

// What the page shows for the app model's state: the filtered views, their row indexes, and the
// values the panels derive from them. The view memoizes these; tests call them directly.

const EMPTY_TAGS = [];

export function buildDisplayedInspection(inspection, filter) {
  return inspection ? applyInspectionFilter(inspection, filter) : null;
}

// Combined databases: each one filtered as Downloader would filter it, then put together.
export function buildCombinedView(databases, filters) {
  if (databases.length < 2) {
    return null;
  }

  return combineDatabaseViews(
    databases.map(({ inspection }) => {
      const filterInputs = downloaderFilterInputs(filters, inspection);
      const effectiveFilter = resolveDownloaderFilter(filterInputs);
      return {
        dbId: inspection.overview.dbId,
        view: applyInspectionFilter(inspection, effectiveFilter),
        effectiveFilter,
        filterSource: resolveDownloaderFilterSource(filterInputs),
      };
    }),
  );
}

// How many files the loaded databases list before any filter, counted as their views count them:
// archive entries included, and a path several combined databases install once.
export function countLoadedFiles(databases) {
  const unfiltered = databases.map(({ inspection }) => ({ dbId: inspection.overview.dbId, view: applyInspectionFilter(inspection, '') }));
  if (unfiltered.length > 1) {
    return combineDatabaseViews(unfiltered).resultCounts.files;
  }
  return unfiltered.length ? unfiltered[0].view.activeFilter.resultCounts.files : 0;
}

export function buildFilesystemIndex(activeView) {
  return activeView ? buildFlatNodeIndex(activeView.filesystemTree.children) : null;
}

export function buildArchivesIndex(activeView) {
  return activeView?.archiveViews.length ? buildFlatArchiveIndex(activeView.archiveViews) : null;
}

export function buildCollisionsIndex(combinedView) {
  return combinedView?.collisions.length ? buildFlatNodeIndex(buildCollisionTree(combinedView.collisions).children) : null;
}

export function buildStorageSummary({ combinedView, displayedInspection, clusterSizeBytes }) {
  if (combinedView) {
    return summarizeInspectionStorage(combinedView.storageView, clusterSizeBytes);
  }

  return displayedInspection ? summarizeInspectionStorage(displayedInspection, clusterSizeBytes) : null;
}

export function selectTagDictionary(displayedInspection) {
  return displayedInspection?.overview.tagDictionary ?? EMPTY_TAGS;
}

// The tag dictionaries shown: one per combined database, or a single one with a null dbId.
export function buildTagGroups(combinedView, tagDictionary) {
  if (combinedView) {
    return combinedView.databases.map(({ dbId, view }) => ({ dbId, tags: view.overview.tagDictionary }));
  }

  return [{ dbId: null, tags: tagDictionary }];
}

export function hasEssentialTag(tagGroups) {
  return tagGroups.some(({ tags }) => tags.some((tag) => tag.name === 'essential'));
}

export function hasUntaggedRows(filesystemIndex) {
  if (!filesystemIndex) {
    return false;
  }

  for (const [, row] of filesystemIndex.rowsById) {
    const tags = row.node?.primaryFields?.find((field) => field.kind === 'tags');
    if (!tags || !Array.isArray(tags.value) || tags.value.length === 0) {
      return true;
    }
  }
  return false;
}

// Names what the tree sections show: a new key gives them fresh rows.
export function selectInspectionKey(state) {
  const base = selectInspectionKeyBase(state);
  return selectIsCombined(state)
    ? `${base}:${JSON.stringify(state.debouncedCombinedFilters)}`
    : `${base}:${String(state.debouncedFilterInput).trim().toLowerCase()}`;
}

// Whether Clear would change FILTER: it returns FILTER to the effective default.
export function canResetFilter(filterInput, effectiveDefaultFilter) {
  return normalizeFilterPromptValue(filterInput) !== normalizeFilterPromptValue(effectiveDefaultFilter);
}
