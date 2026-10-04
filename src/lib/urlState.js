import { Inflate, deflateSync } from 'fflate';

// The page's link: what is open and how it is shown, kept after the # of the address so it never
// reaches the server. It is &-separated key=value pairs, read as a query string is (+ is a space,
// %XX an escape), and written in this order:
//
// - db=<url>: a database, one per database, in the order they were opened. A single one is shown
//   alone, unless the link gives it its own filter (see isCombinedLink).
// - filter=<terms>: FILTER of a database shown alone, or the shared ([mister]) filter of combined
//   databases. Without it defaults apply; empty, nothing is filtered.
// - filter.<db_id>=<terms>: a combined database's own filter.
// - detailed: details are shown.
// - at=<anchor>: a row (see buildNodeAnchor), a section (filter, files, issues...), or `install`,
//   the install dialog of a database shown alone.
//
// When the whole address would be longer than LINK_READABLE_MAX characters, the keys before `at`
// are packed into z=<data>: their text, deflated, in base64url. Unknown keys are ignored. Only %,
// &, +, =, #, whitespace, control and non-ASCII characters are escaped, and those that browsers
// escape in an address themselves (" < > `).

export const LINK_READABLE_MAX = 2000;
// How long packed keys can be once unpacked; a link that unpacks to more is damaged.
const UNPACKED_MAX_BYTES = 1 << 20;
const DAMAGED_LINK_MESSAGE = 'This link is damaged, so what it names could not be opened.';
const UNSET = Object.freeze({ isSet: false, value: '' });
const OWN_FILTER_KEY = 'filter.';

/**
 * @typedef {object} Link
 * @property {string[]} databases The URLs of its databases.
 * @property {{ isSet: boolean, value: string }} filter
 * @property {Record<string, string>} overrides Own filters, by db_id.
 * @property {boolean} detailed
 * @property {string} at The anchor, or ''.
 */

/**
 * Reads a link's text after #. `error` tells why part of it could not be read.
 * @param {string} fragment
 * @returns {Link & { error: string }}
 */
export function parseLink(fragment) {
  const link = { databases: [], filter: UNSET, overrides: {}, detailed: false, at: '', error: '' };
  readPairs(link, new URLSearchParams(fragment), { packed: false });
  return link;
}

function readPairs(link, pairs, { packed }) {
  for (const [key, value] of pairs) {
    if (key === 'db') {
      if (value) {
        link.databases.push(value);
      }
    } else if (key === 'filter') {
      link.filter = { isSet: true, value };
    } else if (key.startsWith(OWN_FILTER_KEY) && key.length > OWN_FILTER_KEY.length) {
      link.overrides[key.slice(OWN_FILTER_KEY.length)] = value;
    } else if (key === 'detailed') {
      link.detailed = true;
    } else if (key === 'at') {
      link.at = value;
    } else if (key === 'z' && !packed) {
      // Packed keys read as if they were written in its place.
      let unpacked;
      try {
        unpacked = unpack(value);
      } catch {
        link.error = DAMAGED_LINK_MESSAGE;
        continue;
      }
      readPairs(link, new URLSearchParams(unpacked), { packed: true });
    }
  }
}

/**
 * A link's text after #, readable while the whole address is at most LINK_READABLE_MAX characters
 * long, else packed. `base` is the address before the #.
 * @param {Link} link
 * @param {string} [base]
 */
export function formatLink(link, base = '') {
  const readable = readableText(link);
  if (base.length + 1 + readable.length <= LINK_READABLE_MAX) {
    return readable;
  }

  const packed = formatPairs([['z', pack(formatPairs(statePairs(link)))], ...anchorPairs(link)]);
  return packed.length < readable.length ? packed : readable;
}

// The readable text says everything a link says, the same way each time.
function readableText(link) {
  return formatPairs([...statePairs(link), ...anchorPairs(link)]);
}

function statePairs(link) {
  return [
    ...link.databases.map((url) => ['db', url]),
    ...(link.filter.isSet ? [['filter', link.filter.value]] : []),
    ...Object.entries(link.overrides).map(([dbId, value]) => [`${OWN_FILTER_KEY}${dbId}`, value]),
    ...(link.detailed ? [['detailed', null]] : []),
  ];
}

function anchorPairs(link) {
  return link.at ? [['at', link.at]] : [];
}

// Pairs whose value is null are flags: written as their key alone.
function formatPairs(pairs) {
  return pairs
    .map(([key, value]) => (value === null ? escapeLinkText(key) : `${escapeLinkText(key)}=${escapeLinkText(value)}`))
    .join('&');
}

// What is written as it is: printable ASCII, but " # % & + < = > and `.
const ESCAPED_CHARACTER = /[^!$'()*,\-./0-9:;?@A-Z[\\\]^_a-z{|}~]/gu;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

function escapeLinkText(text) {
  return String(text)
    .replace(LONE_SURROGATE, '\uFFFD')
    .replace(ESCAPED_CHARACTER, (character) => (character === ' ' ? '+' : encodeURIComponent(character)));
}

function pack(text) {
  const bytes = deflateSync(new TextEncoder().encode(text), { level: 9 });
  let binary = '';
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

// Throws when the data is not packed keys, or unpacks to more than UNPACKED_MAX_BYTES.
function unpack(data) {
  const base64 = data.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const chunks = [];
  let size = 0;
  const inflater = new Inflate((chunk) => {
    size += chunk.length;
    if (size > UNPACKED_MAX_BYTES) {
      throw new RangeError('The packed keys are too long.');
    }
    chunks.push(chunk);
  });
  // A little at a time, so data that unpacks to too much stops early.
  for (let start = 0; start < bytes.length; start += 1024) {
    inflater.push(bytes.subarray(start, start + 1024), start + 1024 >= bytes.length);
  }

  const unpacked = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    unpacked.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(unpacked);
}

/** @returns {Link & { error: string }} */
export function readLink() {
  return parseLink(typeof window === 'undefined' ? '' : window.location.hash.slice(1));
}

// Whether a link names combined databases: several, or one with its own filter, which is how the
// only one of combined databases that can be shared keeps the filter it had among the others.
export function isCombinedLink(link) {
  return link.databases.length > 1 || (link.databases.length === 1 && Object.keys(link.overrides).length > 0);
}

// The database a link shows alone, or ''.
export function linkedDatabaseUrl(link) {
  return isCombinedLink(link) ? '' : link.databases[0] ?? '';
}

// The page's address with `link`; other addresses than the app's keep their query.
function linkPath(link) {
  const base = window.location.pathname + window.location.search;
  const fragment = formatLink(link, window.location.origin + base);
  return fragment ? `${base}#${fragment}` : base;
}

/**
 * The page's link with `changes`, as a full address (the install dialog's link).
 * @param {Partial<Link>} changes
 */
export function buildLinkUrl(changes) {
  if (typeof window === 'undefined') {
    return '';
  }

  return window.location.origin + linkPath({ ...readLink(), ...changes });
}

/**
 * Changes the page's link, in a new history entry with `pushHistory`, when that changes what it
 * says. A damaged link is replaced.
 * @param {Partial<Link>} changes
 */
function writeLink(changes, { pushHistory = false } = {}) {
  if (typeof window === 'undefined') {
    return;
  }

  const { error, ...current } = readLink();
  const next = { ...current, ...changes };
  if (!error && readableText(next) === readableText(current)) {
    return;
  }

  if (pushHistory) {
    window.history.pushState(null, '', linkPath(next));
  } else {
    window.history.replaceState(null, '', linkPath(next));
  }
}

// Names one database, shown alone, or none. It replaces combined databases and their own filters,
// and keeps FILTER unless `preserveFilter` is false.
export function writeLinkDatabase(url, { pushHistory = false, preserveFilter = true } = {}) {
  writeLink({ databases: url ? [url] : [], overrides: {}, ...(preserveFilter ? {} : { filter: UNSET }) }, { pushHistory });
}

export function writeLinkFilter(value, { isPresent = true } = {}) {
  writeLink({ filter: isPresent ? { isSet: true, value } : UNSET });
}

/**
 * Names combined databases (see buildCombinedLink).
 * @param {{ databases: string[], filter: { isSet: boolean, value: string }, overrides: Record<string, string> }} session
 */
export function writeLinkSession({ databases, filter, overrides }, { pushHistory = false } = {}) {
  writeLink({ databases, filter, overrides }, { pushHistory });
}

export function writeLinkDetailed(detailed) {
  writeLink({ detailed });
}

export function writeLinkAnchor(at) {
  writeLink({ at });
}

// Links from before the # named their database in ?database-url=<url>. They open as #db=<url>;
// nothing else of them is read.
export function rewriteOldLink() {
  if (typeof window === 'undefined') {
    return;
  }

  const url = new URLSearchParams(window.location.search).get('database-url');
  if (url) {
    const { pathname } = window.location;
    const link = { databases: [url], filter: UNSET, overrides: {}, detailed: false, at: '' };
    window.history.replaceState(null, '', `${pathname}#${formatLink(link, window.location.origin + pathname)}`);
  }
}

// Row anchors: files:<path>, folders:<path>, archives:<id>, archives:<id>:files:<path>,
// archives:<id>:folders:<path>, and collisions:<path>. Combined databases put the database of an
// archive before its id: archives:<db_id>:<id>. Returns null for rows without one.
export function buildNodeAnchor(row) {
  const id = row.id;
  if (row.type === 'archive') {
    const [, dbId, archiveId] = id.match(/^archive(?:\[([^\]]*)\])?:(.+)/);
    return `archives:${archiveScope(dbId)}${archiveId}`;
  }

  const archiveFileMatch = id.match(/^archive(?:\[([^\]]*)\])?:([^:]+):file:(.+)/);
  if (archiveFileMatch) {
    const [, dbId, archiveId, path] = archiveFileMatch;
    return `archives:${archiveScope(dbId)}${archiveId}:files:${path}`;
  }

  const archiveFolderMatch = id.match(/^archive(?:\[([^\]]*)\])?:([^:]+):(?:folder|missingfolder):(.+)/);
  if (archiveFolderMatch) {
    const [, dbId, archiveId, path] = archiveFolderMatch;
    return `archives:${archiveScope(dbId)}${archiveId}:folders:${path}`;
  }

  // A collided path's versions share their path's anchor.
  const collisionMatch = id.match(/^collision(?:-version:\d+)?:(.+)/);
  if (collisionMatch) {
    return `collisions:${collisionMatch[1]}`;
  }

  const fileMatch = id.match(/^database:file:(.+)/);
  if (fileMatch) {
    return `files:${fileMatch[1]}`;
  }

  const folderMatch = id.match(/^database:(?:folder|missingfolder):(.+)/);
  if (folderMatch) {
    return `folders:${folderMatch[1]}`;
  }

  return null;
}

function archiveScope(dbId) {
  return dbId === undefined ? '' : `${dbId}:`;
}

/**
 * The row an anchor names: { section, rowId, altRowId? }, or null when it names none. `dbIds` are
 * the db_ids of combined databases, which archive anchors start with; null for a database alone.
 * @param {string} at
 * @param {string[] | null} [dbIds]
 */
export function parseNodeAnchor(at, dbIds = null) {
  const filesMatch = at.match(/^files:(.+)/);
  if (filesMatch) {
    return { section: 'filesystem', rowId: `database:file:${filesMatch[1]}` };
  }

  const foldersMatch = at.match(/^folders:(.+)/);
  if (foldersMatch) {
    const path = foldersMatch[1];
    return { section: 'filesystem', rowId: `database:folder:${path}`, altRowId: `database:missingfolder:${path}` };
  }

  const collisionMatch = at.match(/^collisions:(.+)/);
  if (collisionMatch) {
    return { section: 'collisions', rowId: `collision:${collisionMatch[1]}` };
  }

  if (!at.startsWith('archives:')) {
    return null;
  }

  let rest = at.slice('archives:'.length);
  let scope = '';
  if (dbIds) {
    // The longest db_id that fits, as db_ids can hold a colon.
    const dbId = dbIds
      .filter((candidate) => rest.startsWith(`${candidate}:`))
      .reduce((longest, candidate) => (longest === null || candidate.length > longest.length ? candidate : longest), null);
    if (dbId === null) {
      return null;
    }

    scope = `[${dbId}]`;
    rest = rest.slice(dbId.length + 1);
  }

  const archiveFileMatch = rest.match(/^([^:]+):files:(.+)/);
  if (archiveFileMatch) {
    const [, archiveId, path] = archiveFileMatch;
    return { section: 'archives', rowId: `archive${scope}:${archiveId}:file:${path}` };
  }

  const archiveFolderMatch = rest.match(/^([^:]+):folders:(.+)/);
  if (archiveFolderMatch) {
    const [, archiveId, path] = archiveFolderMatch;
    return {
      section: 'archives',
      rowId: `archive${scope}:${archiveId}:folder:${path}`,
      altRowId: `archive${scope}:${archiveId}:missingfolder:${path}`,
    };
  }

  return rest ? { section: 'archives', rowId: `archive${scope}:${rest}` } : null;
}
