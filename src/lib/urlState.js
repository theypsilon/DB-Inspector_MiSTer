// Shareable page state kept in the address bar: the loaded database URL, the FILTER, the
// detailed toggle, and node anchors in the hash. Several combined databases use
// database-url[<db_id>] per database, `filter` for the shared ([mister]) filter, and
// filter[<db_id>] for each database's own filter.

export const DATABASE_URL_PARAM = 'database-url';
export const FILTER_URL_PARAM = 'filter';
export const DETAILED_URL_PARAM = 'detailed';
const SCOPED_DATABASE_URL_PARAM = /^database-url\[(.*)\]$/;
const SCOPED_FILTER_PARAM = /^filter\[(.*)\]$/;

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

  // Archive anchors carry the database id when several databases are combined: archives[<db_id>]:.
  const archiveFileMatch = hash.match(/^archives(\[[^\]]*\])?:([^:]+):files:(.+)/);
  if (archiveFileMatch) {
    const [, scope = '', archiveId, path] = archiveFileMatch;
    return { section: 'archives', rowId: `archive${scope}:${archiveId}:file:${path}` };
  }

  const archiveFolderMatch = hash.match(/^archives(\[[^\]]*\])?:([^:]+):folders:(.+)/);
  if (archiveFolderMatch) {
    const [, scope = '', archiveId, path] = archiveFolderMatch;
    return {
      section: 'archives',
      rowId: `archive${scope}:${archiveId}:folder:${path}`,
      altRowId: `archive${scope}:${archiveId}:missingfolder:${path}`,
    };
  }

  const archiveMatch = hash.match(/^archives(\[[^\]]*\])?:(.+)/);
  if (archiveMatch) {
    const [, scope = '', archiveId] = archiveMatch;
    return { section: 'archives', rowId: `archive${scope}:${archiveId}` };
  }

  const collisionMatch = hash.match(/^collisions:(.+)/);
  if (collisionMatch) {
    return { section: 'collisions', rowId: `collision:${collisionMatch[1]}` };
  }

  return null;
}

export function buildNodeAnchorHash(row) {
  const id = row.id;
  if (row.type === 'archive') {
    const [, scope = '', archiveId] = id.match(/^archive(\[[^\]]*\])?:(.+)/);
    return `#archives${encodeScope(scope)}:${encodeURIComponent(archiveId)}`;
  }

  const archiveFileMatch = id.match(/^archive(\[[^\]]*\])?:([^:]+):file:(.+)/);
  if (archiveFileMatch) {
    const [, scope = '', archiveId, path] = archiveFileMatch;
    return `#archives${encodeScope(scope)}:${encodeURIComponent(archiveId)}:files:${encodeURIComponent(path)}`;
  }

  const archiveFolderMatch = id.match(/^archive(\[[^\]]*\])?:([^:]+):(?:folder|missingfolder):(.+)/);
  if (archiveFolderMatch) {
    const [, scope = '', archiveId, path] = archiveFolderMatch;
    return `#archives${encodeScope(scope)}:${encodeURIComponent(archiveId)}:folders:${encodeURIComponent(path)}`;
  }

  // A collided path's versions share their path's anchor.
  const collisionMatch = id.match(/^collision(?:-version:\d+)?:(.+)/);
  if (collisionMatch) {
    return `#collisions:${encodeURIComponent(collisionMatch[1])}`;
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

function encodeScope(scope) {
  return scope ? `[${encodeURIComponent(scope.slice(1, -1))}]` : '';
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

export function readDetailedSearchParam() {
  if (typeof window === 'undefined') {
    return false;
  }

  return new URLSearchParams(window.location.search).has(DETAILED_URL_PARAM);
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

  // A single database replaces a combined session's database-url[<db_id>] and filter[<db_id>].
  for (const name of [...currentUrl.searchParams.keys()]) {
    if (SCOPED_DATABASE_URL_PARAM.test(name) || SCOPED_FILTER_PARAM.test(name)) {
      currentUrl.searchParams.delete(name);
    }
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

export function writeDetailedSearchParam(detailed) {
  if (typeof window === 'undefined') {
    return;
  }

  if (parseCombinedSearch(window.location.search)) {
    // Keeps the database-url[<db_id>] and filter[<db_id>] params of combined databases readable.
    const params = [...new URLSearchParams(window.location.search)].filter(([name]) => name !== DETAILED_URL_PARAM);
    history.replaceState(
      null,
      '',
      window.location.pathname + serializeParams(detailed ? [...params, [DETAILED_URL_PARAM, '']] : params) + window.location.hash,
    );
    return;
  }

  const url = new URL(window.location.href);
  if (detailed) {
    url.searchParams.set(DETAILED_URL_PARAM, '');
  } else {
    url.searchParams.delete(DETAILED_URL_PARAM);
  }
  history.replaceState(null, '', url.pathname + url.search + url.hash);
}

// Reads a combined session from a query string, or returns null when it has no
// database-url[<db_id>] params. A plain `database-url` alongside them comes first, with an empty key.
export function parseCombinedSearch(search) {
  const databases = [];
  const overrides = {};
  let unscopedUrl = null;
  let sharedFilter = { isSet: false, value: '' };

  for (const [name, value] of new URLSearchParams(search)) {
    const scopedUrl = name.match(SCOPED_DATABASE_URL_PARAM);
    const scopedFilter = name.match(SCOPED_FILTER_PARAM);
    if (scopedUrl) {
      databases.push({ key: scopedUrl[1], url: value });
    } else if (scopedFilter) {
      overrides[scopedFilter[1]] = value;
    } else if (name === DATABASE_URL_PARAM) {
      unscopedUrl = value;
    } else if (name === FILTER_URL_PARAM) {
      sharedFilter = { isSet: true, value };
    }
  }

  if (!databases.length) {
    return null;
  }

  return {
    databases: unscopedUrl ? [{ key: '', url: unscopedUrl }, ...databases] : databases,
    sharedFilter,
    overrides,
  };
}

// Writes a combined session into a query string, keeping its other params (such as `detailed`).
// `databases` is [{ dbId, url }] in load order; databases without a URL (uploads) are left out.
export function buildCombinedSearch(search, { databases, sharedFilter, overrides }) {
  const otherParams = [...new URLSearchParams(search)].filter(
    ([name]) =>
      name !== DATABASE_URL_PARAM &&
      name !== FILTER_URL_PARAM &&
      !SCOPED_DATABASE_URL_PARAM.test(name) &&
      !SCOPED_FILTER_PARAM.test(name),
  );
  const params = [
    ...databases.filter(({ url }) => url).map(({ dbId, url }) => [`database-url[${dbId}]`, url]),
    ...(sharedFilter.isSet ? [[FILTER_URL_PARAM, sharedFilter.value]] : []),
    ...databases
      .filter(({ dbId }) => Object.hasOwn(overrides, dbId))
      .map(({ dbId }) => [`filter[${dbId}]`, overrides[dbId]]),
    ...otherParams,
  ];
  return serializeParams(params);
}

function serializeParams(params) {
  const query = params.map(([name, value]) => `${encodeParamName(name)}=${encodeURIComponent(value)}`).join('&');
  return query ? `?${query}` : '';
}

export function writeCombinedSearch(state, { pushHistory = false } = {}) {
  if (typeof window === 'undefined') {
    return;
  }

  const next = window.location.pathname + buildCombinedSearch(window.location.search, state) + window.location.hash;
  if (next === window.location.pathname + window.location.search + window.location.hash) {
    return;
  }

  if (pushHistory) {
    window.history.pushState({}, '', next);
  } else {
    window.history.replaceState({}, '', next);
  }
}

// Keeps the brackets of database-scoped param names readable: filter[db_id].
function encodeParamName(name) {
  const scoped = name.match(/^([^[]*)\[(.*)\]$/);
  return scoped ? `${encodeURIComponent(scoped[1])}[${encodeURIComponent(scoped[2])}]` : encodeURIComponent(name);
}
