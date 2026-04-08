import { formatBytes } from './database.js';

export const DATABASE_URL_PARAM = 'database-url';
export const FILTER_URL_PARAM = 'filter';
export const DETAILED_URL_PARAM = 'detailed';
export const FILTER_INPUT_DEBOUNCE_MS = 600;
export const TREE_LIST_GAP_PX = 13;
export const TREE_OVERSCAN_PX = 900;
export const DEFAULT_CLUSTER_SIZE_BYTES = 128 * 1024;
export const CLUSTER_SIZE_OPTIONS = [4096, 8192, 16384, 32768, 65536, 131072, 262144, 524288, 1048576];
export const isTouchDevice = typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 0);

export const OPENABLE_TEXT_FILE_EXTENSIONS = new Set(['txt', 'ini', 'md']);
export const OPENABLE_IMAGE_FILE_EXTENSIONS = new Set([
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

export function isBrowserOpenableFile(path) {
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

export function resolveDownloadFileName(fileName, url) {
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

export function triggerBrowserDownload(href, fileName) {
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

export async function triggerFileDownload(url, fileName) {
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

export function normalizeFilterPromptValue(value) {
  return String(value).trim().replace(/\s+/g, ' ');
}

export function formatFilterPromptValue(value) {
  const normalizedValue = normalizeFilterPromptValue(value);
  return normalizedValue || 'Empty filter';
}

export function resolveEffectiveDefaultFilter({
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

export function resolveInheritedFilterValue(filterValue, inheritedFilterValue) {
  return String(filterValue || '')
    .replaceAll(/\[\s*mister\s*\]/gi, inheritedFilterValue)
    .trim();
}

export function parseNodeAnchor() {
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

export function buildNodeAnchorHash(row) {
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

export function readDatabaseUrlSearchParam() {
  if (typeof window === 'undefined') {
    return '';
  }

  const searchParams = new URLSearchParams(window.location.search);
  return searchParams.get(DATABASE_URL_PARAM) ?? '';
}

export function readFilterSearchParam() {
  if (typeof window === 'undefined') {
    return { isPresent: false, value: '' };
  }

  const searchParams = new URLSearchParams(window.location.search);
  return {
    isPresent: searchParams.has(FILTER_URL_PARAM),
    value: searchParams.get(FILTER_URL_PARAM) ?? '',
  };
}

export function writeDatabaseUrlSearchParam(value, { pushHistory = false, preserveFilter = true } = {}) {
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

export function writeFilterSearchParam(value, { pushHistory = false, isPresent = true } = {}) {
  if (typeof window === 'undefined') {
    return;
  }

  const currentUrl = new URL(window.location.href);
  if (isPresent) {
    currentUrl.searchParams.set(FILTER_URL_PARAM, value);
  } else {
    currentUrl.searchParams.delete(FILTER_URL_PARAM);
  }

  // URLSearchParams uses application/x-www-form-urlencoded encoding which differs from
  // encodeURIComponent: spaces become '+' instead of '%20', and some chars like '!' become
  // '%21' instead of remaining literal. Normalize to match encodeURIComponent output.
  const urlString = currentUrl.toString().replace(/\+/g, '%20').replace(/%21/gi, '!');

  if (urlString === window.location.href) {
    return;
  }

  if (pushHistory) {
    window.history.pushState({}, '', urlString);
  } else {
    window.history.replaceState({}, '', urlString);
  }
}

export function normalizeComparableUrl(value) {
  try {
    return new URL(String(value).trim()).toString().toLowerCase();
  } catch {
    return '';
  }
}

export function buildFilterSummaryCopy(activeFilter) {
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

export function buildRawByteHoverCopy(storageSummary) {
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

export function getLoadedSourceUrl(loadedSource) {
  if (loadedSource.kind === 'database') {
    return loadedSource.inspection.source.sourceUrl || loadedSource.inspection.source.sourceLabel;
  }

  return loadedSource.source.sourceUrl || loadedSource.source.sourceLabel;
}

export function createCatalogEntriesFromLoadedSource(loadedSource, existingEntries = []) {
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

export function mergeCustomCatalogEntries(nextEntries, currentEntries) {
  return mergeCatalogEntryList(nextEntries, currentEntries);
}

export function mergeCatalogEntries(customEntries, runtimeEntries) {
  return mergeCatalogEntryList(customEntries, runtimeEntries, { preferExistingTitle: true });
}

export function findPreservedCatalogTitle(existingEntries, dbId, matchDbUrls) {
  const existingEntry = findCatalogOverrideEntry({ dbId, matchDbUrls }, existingEntries);
  return existingEntry?.title || '';
}

export function buildLoadedDatabaseCatalogTitle(inspection) {
  if (inspection.source.sourceKind === 'upload') {
    return `Uploaded: ${inspection.source.sourceLabel}`;
  }

  return buildCatalogTitleFromLocation(
    inspection.source.sourceLabel || inspection.source.sourceUrl,
    inspection.overview.dbId,
  );
}

export function buildCatalogTitleFromLocation(location, dbId = '') {
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

export function buildCustomCatalogEntryKey(dbId, dbUrl) {
  return `custom:${normalizeCatalogDbId(dbId)}:${normalizeComparableUrl(dbUrl) || String(dbUrl).trim()}`;
}

export function getCatalogEntryUrl(loadedSource) {
  if (loadedSource.kind !== 'database') {
    return '';
  }

  const source = loadedSource.inspection.source;
  if (source.sourceKind === 'upload') {
    return source.sourceUrl || '';
  }

  return source.sourceLabel || source.sourceUrl || '';
}

export function getCatalogMatchUrls(loadedSource) {
  if (loadedSource.kind !== 'database') {
    return [];
  }

  const source = loadedSource.inspection.source;
  return [...new Set([source.sourceLabel, source.sourceUrl, source.requestedUrl, source.resolvedUrl])]
    .map((value) => normalizeComparableUrl(value))
    .filter(Boolean);
}

export function mergeCatalogEntryList(incomingEntries, existingEntries, { preferExistingTitle = false } = {}) {
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

export function findCatalogOverrideEntry(entry, entries) {
  const matchingIndex = findCatalogOverrideIndex(entry, entries);
  return matchingIndex === -1 ? null : entries[matchingIndex];
}

export function findCatalogOverrideIndex(entry, entries) {
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

export function normalizeCatalogDbId(dbId) {
  return String(dbId || '').trim().toLowerCase();
}

export function mergeCatalogEntry(incomingEntry, existingEntry, { preferExistingTitle = false } = {}) {
  return {
    ...incomingEntry,
    matchDbUrls: [...new Set([...getCatalogComparableUrls(incomingEntry), ...getCatalogComparableUrls(existingEntry)])],
    title:
      (preferExistingTitle ? existingEntry?.title || incomingEntry.title : incomingEntry.title || existingEntry?.title) ||
      '',
  };
}

export function getCatalogComparableUrls(entry) {
  const matchDbUrls = Array.isArray(entry?.matchDbUrls) ? entry.matchDbUrls : [];
  const normalizedUrls = [
    ...matchDbUrls,
    normalizeComparableUrl(entry?.dbUrl),
  ].filter(Boolean);

  return [...new Set(normalizedUrls)];
}

export function isFileDragEvent(event) {
  const types = Array.from(event.dataTransfer?.types ?? []);
  return types.includes('Files');
}

export function runAfterNextPaint(callback) {
  window.requestAnimationFrame(() => {
    window.setTimeout(() => {
      callback();
    }, 0);
  });
}

export function extractGitHubRepo(source) {
  const url = source.requestedUrl || source.sourceLabel;
  if (!url) return null;
  let match = url.match(/raw\.githubusercontent\.com\/([^/]+\/[^/]+)/);
  if (match) return match[1];
  match = url.match(/github\.com\/([^/]+\/[^/]+)/);
  if (match) return match[1].replace(/\.git$/, '');
  return null;
}

export function buildFlatNodeIndex(nodes) {
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

export function buildFlatArchiveIndex(archiveViews) {
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

export function collectVisibleRowIds(rootIds, rowsById, collapsedIds) {
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

export function toggleSetMembership(currentSet, value) {
  const next = new Set(currentSet);
  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }

  return next;
}

export function setSetMembership(currentSet, value, shouldHave) {
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

export function toggleDetailOverride(currentMap, rowId, defaultDetailed) {
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

export function setDetailVisibilityOverride(currentMap, rowId, nextVisible, defaultDetailed) {
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

export function buildTreeDepthStyle(depth) {
  return { '--tree-depth': depth };
}

export function buildTreeGuideStyle(depth) {
  return { '--tree-guide-depth': depth };
}

export function buildVirtualRowStyle(top, { trimTopGuide = false, trimBottomGuide = false } = {}) {
  return {
    position: 'absolute',
    top: `${top}px`,
    left: 0,
    right: 0,
    '--tree-guide-top-overlap': trimTopGuide ? '0px' : 'var(--tree-guide-overlap)',
    '--tree-guide-bottom-overlap': trimBottomGuide ? '0px' : 'var(--tree-guide-overlap)',
  };
}

export function getRowMeasurementKey(rowId, { collapsed, detailsVisible }) {
  return `${rowId}:${collapsed ? '1' : '0'}:${detailsVisible ? '1' : '0'}`;
}

export function buildVirtualRowLayout({
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

export function buildVirtualRows({
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

  // Always render rows that would be visible if the section were at the top of the
  // viewport. This keeps content in the DOM for sections below the initial scroll
  // position, avoiding empty sections when the page first loads or a filter changes.
  const sectionBaselineEnd = Math.min(rowIds.length, upperBound(offsets, viewportHeight));
  for (let i = 0; i < sectionBaselineEnd; i += 1) {
    renderedIndexes.add(i);
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

export function getViewportAnchorOffsetDelta({ currentLayout, nextLayout, viewportTop }) {
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

export function estimateRowHeight(row, { collapsed, detailsVisible }) {
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

export function lowerBound(values, target) {
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

export function upperBound(values, target) {
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
