import { normalizeComparableUrl } from './database.js';

// Session catalog entries: custom databases loaded by URL or upload, merged over the runtime
// catalog. Custom entries replace runtime ones by exact URL match first, and by db_id only when
// that db_id is unique, so forks sharing a db_id stay visible.

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
        dbIdApproximate: false,
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
  const mergedRuntimeEntries = [...runtimeEntries];
  const unmatchedCustomEntries = [];

  for (const customEntry of customEntries) {
    const matchingIndex = findCatalogOverrideIndex(customEntry, mergedRuntimeEntries);
    if (matchingIndex === -1) {
      unmatchedCustomEntries.push(customEntry);
      continue;
    }

    mergedRuntimeEntries[matchingIndex] = mergeCatalogEntry(
      customEntry,
      mergedRuntimeEntries[matchingIndex],
      { preferExistingTitle: true },
    );
  }

  return [...unmatchedCustomEntries, ...mergedRuntimeEntries];
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

// The URL of the first catalog entry with `dbId`, ignoring letter case, or '': what a link that
// names a database by its db_id opens.
export function findCatalogDatabaseUrl(entries, dbId) {
  const wanted = normalizeCatalogDbId(dbId);
  return (wanted && entries.find((entry) => normalizeCatalogDbId(entry.dbId) === wanted)?.dbUrl) || '';
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
