import { getCatalogComparableUrls } from './catalog.js';
import { normalizeComparableUrl } from './database.js';

// Choosing several databases at once, in the catalog or a database list. A selection holds at most
// one database per db_id, since databases that share a db_id cannot be combined.

// The databases Update All installs by default.
export const UPDATE_ALL_DEFAULT_DATABASES = Object.freeze([
  {
    dbId: 'distribution_mister',
    dbUrl: 'https://raw.githubusercontent.com/theypsilon/MultiDatabases_MiSTer/db/distribution-mister-pinned-linux/db.json.zip',
  },
  {
    dbId: 'update_all_mister',
    dbUrl: 'https://raw.githubusercontent.com/theypsilon/Update_All_MiSTer/db/update_all_db.json',
  },
  {
    dbId: 'jtcores',
    dbUrl: 'https://raw.githubusercontent.com/jotego/jtcores_mister/main/jtbindb.json.zip',
  },
  {
    dbId: 'Coin-OpCollection/Distribution-MiSTerFPGA',
    dbUrl: 'https://raw.githubusercontent.com/Coin-OpCollection/Distribution-MiSTerFPGA/db/db.json.zip',
  },
]);

const LIST_SEARCH = { id: 'ini-modal-search', label: 'Search list', placeholder: 'Search by ID or URL' };
const UPLOAD_SEARCH = { id: 'upload-modal-search', label: 'Search your files', placeholder: 'Search by ID, URL, or file' };

function countOf(count, noun) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

// What the picker of a database list shows: its entries and its [mister] filter.
export function buildListChoice(list) {
  return {
    kind: 'list',
    label: 'List',
    panelLabel: 'Database List',
    title: 'Choose databases from this list',
    description: `${list.source.sourceLabel} contains ${list.entries.length} ${list.entries.length === 1 ? 'entry' : 'entries'}.`,
    entries: list.entries,
    misterOptions: list.defaultFilterPresent
      ? [{ key: 'mister', label: list.source.sourceLabel, filter: list.defaultFilter }]
      : [],
    search: LIST_SEARCH,
    listLabel: 'Database list entries',
  };
}

// What the picker of uploaded files shows: the databases scanUploads found, with where each came
// from, and the [mister] filters of the lists among them.
export function buildUploadChoice({ entries, misterOptions, fileCount }) {
  return {
    kind: 'upload',
    label: 'Upload',
    panelLabel: 'Upload',
    title: 'Choose databases from your files',
    description: `Found ${countOf(entries.length, 'database')} in ${countOf(fileCount, 'file')}.`,
    entries,
    misterOptions,
    search: UPLOAD_SEARCH,
    listLabel: 'Databases in your files',
  };
}

// The keys of the entries that are Update All defaults: matched by URL, else the first entry with
// the default's db_id.
export function findUpdateAllDefaultKeys(entries) {
  return UPDATE_ALL_DEFAULT_DATABASES.map(({ dbId, dbUrl }) => {
    const url = normalizeComparableUrl(dbUrl);
    const match =
      entries.find((entry) => normalizeComparableUrl(entry.dbUrl) === url) ??
      entries.find((entry) => entry.dbId === dbId);
    return match?.key;
  }).filter(Boolean);
}

// The keys of one entry per db_id, in list order: for each db_id, the entry that comes first in
// `preferredKeys`, else the first entry.
export function selectOnePerDbId(entries, preferredKeys = []) {
  const rank = new Map(preferredKeys.map((key, index) => [key, index]).reverse());
  const rankOf = (entry) => rank.get(entry.key) ?? Infinity;
  const chosenByDbId = new Map();
  for (const entry of entries) {
    const chosen = chosenByDbId.get(entry.dbId);
    if (!chosen || rankOf(entry) < rankOf(chosen)) {
      chosenByDbId.set(entry.dbId, entry);
    }
  }

  const chosenKeys = new Set([...chosenByDbId.values()].map((entry) => entry.key));
  return entries.filter((entry) => chosenKeys.has(entry.key)).map((entry) => entry.key);
}

// The keys a preset selects: its entries, one per db_id (the one that comes first in `keys`).
export function selectPreset(entries, keys) {
  const presetKeys = new Set(keys);
  return selectOnePerDbId(
    entries.filter((entry) => presetKeys.has(entry.key)),
    keys,
  );
}

// The selected entry that shares `entry`'s db_id, if any.
export function findDbIdConflict(entries, selectedKeys, entry) {
  return (
    entries.find((other) => other.key !== entry.key && selectedKeys.has(other.key) && other.dbId === entry.dbId) ??
    null
  );
}

// What identifies where a loaded database came from: the URLs it was opened from and, for an
// upload, the content of its file.
function loadedSourceKeys({ source }) {
  return [
    ...[source.sourceLabel, source.sourceUrl, source.requestedUrl, source.resolvedUrl].map((url) =>
      normalizeComparableUrl(url),
    ),
    source.contentHash,
  ].filter(Boolean);
}

function entryKeys(entry) {
  return [...getCatalogComparableUrls(entry), entry.hash].filter(Boolean);
}

// The keys of the entries that would open a loaded database ({ inspection }) again: the same URL,
// the same uploaded file, or a file with the same content.
export function findLoadedKeys(entries, databases) {
  const loadedKeys = new Set(databases.flatMap(({ inspection }) => loadedSourceKeys(inspection)));
  return new Set(
    entries.filter((entry) => entryKeys(entry).some((key) => loadedKeys.has(key))).map((entry) => entry.key),
  );
}

// Whether `url` is where a loaded database ({ inspection }) came from.
export function isLoadedUrl(databases, url) {
  const key = normalizeComparableUrl(url);
  return Boolean(key) && databases.some(({ inspection }) => loadedSourceKeys(inspection).includes(key));
}

// Whether the inspection `incoming` is the loaded `loaded` again: the same db_id from the same URL.
// Opening it again can only reload it.
export function isReloadOf(loaded, incoming) {
  return (
    loaded.source.sourceKind === 'url' &&
    incoming.source.sourceKind === 'url' &&
    loaded.overview.dbId === incoming.overview.dbId &&
    normalizeComparableUrl(loaded.source.sourceLabel) === normalizeComparableUrl(incoming.source.sourceLabel)
  );
}

// Whether opening `entries` alone would open every loaded database again.
export function selectionIncludesLoadedDatabases(entries, databases) {
  const selectedKeys = new Set(entries.flatMap((entry) => entryKeys(entry)));
  return databases.every(({ inspection }) => loadedSourceKeys(inspection).some((key) => selectedKeys.has(key)));
}

// Sorts the settled loads of selected entries into the databases they opened and the errors to
// show: failed loads, named by URL, and database lists, which can only be opened alone.
export function collectSelectedDatabases(entries, results) {
  const loaded = [];
  const errors = [];
  results.forEach((result, index) => {
    const entry = entries[index];
    if (result.status === 'rejected') {
      const message = result.reason?.message;
      errors.push(
        !message ? `Could not load ${entry.dbUrl}.` : message.includes(entry.dbUrl) ? message : `${entry.dbUrl}: ${message}`,
      );
    } else if (result.value.kind !== 'database') {
      errors.push(`${entry.dbUrl} is a database list. Open it alone to choose one of its databases.`);
    } else {
      loaded.push({ entry, loadedSource: result.value });
    }
  });

  return { loaded, errors };
}
