// The explorer: the SD card as Downloader would leave it with the current filters. The database's
// files and folders are put together with the files and folders inside its archives, each at the
// path it installs to; the archives themselves are not shown. Combined databases add the paths that
// several of them claim (collisions) once each, with every version. Paths are compared ignoring
// letter case, as the SD card and collisions compare them.
//
// A folder's `children` are its folders, then its files, each by name, as the tree sections sort
// them. Every folder counts the files it holds at any depth, and adds up their known sizes.

/**
 * Where a folder is declared, or where a file comes from: the database's own files and folders
 * (`archiveId` null), or one of its archives. `dbId` is set when databases are combined.
 * @typedef {{ record: any, dbId: string | null, archiveId: string | null }} ExplorerOrigin
 */

/**
 * @typedef {object} ExplorerFolder
 * @property {'folder'} kind
 * @property {string} path Without a trailing slash; '' for the SD card itself.
 * @property {string} name
 * @property {ExplorerFolder | null} parent
 * @property {ExplorerEntry[]} children
 * @property {ExplorerOrigin[]} origins Where it is declared; none when only what it holds implies it.
 * @property {number} fileCount The files it holds, at any depth.
 * @property {number} sizeBytes The size of those files whose size is known.
 * @property {Map<string, ExplorerFolder>} folderIndex Its folders by lowercase name.
 * @property {Map<string, ExplorerFile>} fileIndex Its files by lowercase name.
 */

/**
 * @typedef {object} ExplorerFile
 * @property {'file'} kind
 * @property {string} path
 * @property {string} name
 * @property {ExplorerFolder} parent
 * @property {ExplorerOrigin[]} versions One, or one for each database or source that installs it.
 * @property {boolean} identical Whether its versions are identical copies (same hash and size).
 * @property {number | null} sizeBytes Its size; with several versions, the largest.
 */

/** @typedef {ExplorerFolder | ExplorerFile} ExplorerEntry */

export const EXPLORER_ROOT_NAME = 'SD card';

/**
 * The SD card a view installs: a database's filtered inspection, or combined databases' view.
 * @param {any} view
 * @returns {ExplorerFolder}
 */
export function buildExplorerTree(view) {
  const root = createFolder('', EXPLORER_ROOT_NAME, null);
  const identicalByFile = new Map();

  const folderAt = (segments) => {
    let folder = root;
    for (let index = 0; index < segments.length; index += 1) {
      const key = segments[index].toLowerCase();
      let next = folder.folderIndex.get(key);
      if (!next) {
        next = createFolder(joinPath(folder.path, segments[index]), segments[index], folder);
        folder.folderIndex.set(key, next);
      }
      folder = next;
    }
    return folder;
  };

  const addFolder = (record, origin) => {
    const segments = splitPath(record.path);
    if (segments.length) {
      folderAt(segments).origins.push(origin);
    }
  };

  const addFile = (path, versions, identical = null) => {
    const segments = splitPath(path);
    if (!segments.length || !versions.length) {
      return;
    }

    const parent = folderAt(segments.slice(0, -1));
    const name = segments[segments.length - 1];
    const key = name.toLowerCase();
    const existing = parent.fileIndex.get(key);
    if (existing) {
      existing.versions.push(...versions);
      return;
    }

    /** @type {ExplorerFile} */
    const file = { kind: 'file', path: joinPath(parent.path, name), name, parent, versions: [...versions], identical: false, sizeBytes: null };
    parent.fileIndex.set(key, file);
    if (identical !== null) {
      identicalByFile.set(file, identical);
    }
  };

  const addRecord = (record, origin) => {
    if (record.kind === 'file') {
      addFile(record.path, [origin]);
    } else if (record.kind === 'folder') {
      addFolder(record, origin);
    }
  };

  for (const record of view?.filesystemRecords ?? []) {
    addRecord(record, { record, dbId: record.dbId ?? null, archiveId: null });
  }

  for (const archive of view?.archiveViews ?? []) {
    for (const record of archive.summaryRecords ?? []) {
      addRecord(record, { record, dbId: archive.dbId ?? record.dbId ?? null, archiveId: archive.id });
    }
  }

  // Combined databases leave collided files out of their views and list them here, with each
  // database's version (and the databases that need a folder there, which have their folder).
  for (const collision of view?.collisions ?? []) {
    const versions = collision.versions
      .filter((version) => version.record)
      .map((version) => ({ record: version.record, dbId: version.dbId, archiveId: version.archiveId }));
    addFile(collision.path, versions, collision.identical);
  }

  finalizeFolder(root, identicalByFile);
  return root;
}

/**
 * @param {string} path
 * @param {string} name
 * @param {ExplorerFolder | null} parent
 * @returns {ExplorerFolder}
 */
function createFolder(path, name, parent) {
  return {
    kind: 'folder',
    path,
    name,
    parent,
    children: [],
    origins: [],
    fileCount: 0,
    sizeBytes: 0,
    folderIndex: new Map(),
    fileIndex: new Map(),
  };
}

function finalizeFolder(folder, identicalByFile) {
  const folders = [...folder.folderIndex.values()].sort(byName);
  const files = [...folder.fileIndex.values()].sort(byName);
  let fileCount = 0;
  let sizeBytes = 0;

  for (const child of folders) {
    finalizeFolder(child, identicalByFile);
    fileCount += child.fileCount;
    sizeBytes += child.sizeBytes;
  }

  for (const file of files) {
    file.sizeBytes = largestSize(file.versions);
    file.identical = identicalByFile.get(file) ?? (file.versions.length > 1 && areIdenticalCopies(file.versions));
    fileCount += 1;
    sizeBytes += file.sizeBytes ?? 0;
  }

  folder.children = [...folders, ...files];
  folder.fileCount = fileCount;
  folder.sizeBytes = sizeBytes;
}

function byName(left, right) {
  return left.name.localeCompare(right.name);
}

function largestSize(versions) {
  const sizes = versions.map(({ record }) => record.sizeBytes).filter((size) => Number.isFinite(size));
  return sizes.length ? Math.max(...sizes) : null;
}

function areIdenticalCopies(versions) {
  const [first] = versions;
  return versions.every(
    ({ record }) =>
      record.hash &&
      Number.isFinite(record.sizeBytes) &&
      String(record.hash).toLowerCase() === String(first.record.hash).toLowerCase() &&
      record.sizeBytes === first.record.sizeBytes,
  );
}

function splitPath(path) {
  return String(path ?? '').split('/').filter(Boolean);
}

// Paths are the folders' names as the tree has them, so a path met in another letter case
// still reads as the one shown.
function joinPath(folderPath, name) {
  return folderPath ? `${folderPath}/${name}` : name;
}

/**
 * Where a path leads: the folder it names, or the folder of the file it names with that file. A
 * path that is not there (a filter hides it) leads to the deepest folder on its way.
 * @param {ExplorerFolder} root
 * @param {string} path
 * @returns {{ folder: ExplorerFolder, file: ExplorerFile | null }}
 */
export function resolveExplorerLocation(root, path) {
  const segments = splitPath(path);
  let folder = root;
  for (let index = 0; index < segments.length; index += 1) {
    const key = segments[index].toLowerCase();
    const next = folder.folderIndex.get(key);
    if (next) {
      folder = next;
      continue;
    }

    const file = index === segments.length - 1 ? folder.fileIndex.get(key) : null;
    return { folder, file: file ?? null };
  }

  return { folder, file: null };
}

/**
 * The folders from the SD card down to `folder`, both included.
 * @param {ExplorerFolder} folder
 */
export function explorerAncestors(folder) {
  const folders = [];
  for (let current = folder; current; current = current.parent) {
    folders.unshift(current);
  }
  return folders;
}

// The folders visited, for Back and Forward. Visiting a folder drops the ones ahead of it, as a
// browser does.

/** @param {string} path */
export function startExplorerHistory(path) {
  return { paths: [path], index: 0 };
}

/**
 * @param {{ paths: string[], index: number }} history
 * @param {string} path
 */
export function visitExplorerFolder(history, path) {
  if (history.paths[history.index] === path) {
    return history;
  }

  return { paths: [...history.paths.slice(0, history.index + 1), path], index: history.index + 1 };
}

/**
 * Back (-1) or Forward (1).
 * @param {{ paths: string[], index: number }} history
 * @param {number} step
 */
export function stepExplorerHistory(history, step) {
  const index = Math.min(Math.max(history.index + step, 0), history.paths.length - 1);
  return index === history.index ? history : { ...history, index };
}

/**
 * The end of a name that stays in view when a row cuts it short: its extension and the nine
 * characters before it (a core's `_20240525.rbf`), or its last nine characters. The rest is the
 * start, which gives way first.
 * @param {string} name
 */
export function splitNameEnd(name) {
  const characters = Array.from(name);
  const dot = characters.lastIndexOf('.');
  const extensionLength = dot > 0 && characters.length - dot <= 6 ? characters.length - dot : 0;
  const endLength = Math.min(characters.length, extensionLength + 9);
  return {
    start: characters.slice(0, characters.length - endLength).join(''),
    end: characters.slice(characters.length - endLength).join(''),
  };
}

/**
 * A name in two lines of `width`, as `measure` sizes text: the first line breaks between words
 * where it can, and a second line that would not fit keeps the name's end, after an ellipsis.
 * Returns the lines; the second is '' when the name fits on one.
 * @param {string} name
 * @param {number} width
 * @param {(text: string) => number} measure
 * @returns {[string, string]}
 */
export function splitTileName(name, width, measure) {
  if (measure(name) <= width) {
    return [name, ''];
  }

  const characters = Array.from(name);
  // The longest start that fits, ending at a space when there is one to end at.
  const fitting = longestFitting(characters.length, (count) => measure(characters.slice(0, count).join('')) <= width);
  let firstLength = Math.max(fitting, 1);
  const lastSpace = characters.slice(0, firstLength + 1).lastIndexOf(' ');
  if (lastSpace > 0 && firstLength < characters.length) {
    firstLength = lastSpace + 1;
  }

  const first = characters.slice(0, firstLength).join('').trimEnd();
  const rest = characters.slice(firstLength).join('').trimStart();
  if (measure(rest) <= width) {
    return [first, rest];
  }

  const restCharacters = Array.from(rest);
  const endLength = longestFitting(restCharacters.length, (count) =>
    measure(`…${restCharacters.slice(restCharacters.length - count).join('')}`) <= width,
  );
  return [first, `…${restCharacters.slice(restCharacters.length - endLength).join('')}`];
}

// The largest count in 0..max for which `fits` holds, given that it holds for every count below
// one that does.
function longestFitting(max, fits) {
  let low = 0;
  let high = max;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(middle)) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low;
}

/**
 * The lines (rows of the list, or rows of icons) to render: those in view and `overscan` more on
 * each side. Before the list has a size (or where nothing has one, as in tests), the first
 * `fallbackCount`.
 * @param {{ scrollTop: number, viewportHeight: number, lineHeight: number, lineCount: number, overscan?: number, fallbackCount?: number }} options
 */
export function explorerWindow({ scrollTop, viewportHeight, lineHeight, lineCount, overscan = 4, fallbackCount = 40 }) {
  if (!(viewportHeight > 0) || !(lineHeight > 0)) {
    return { start: 0, end: Math.min(lineCount, fallbackCount) };
  }

  return {
    start: Math.max(0, Math.floor(scrollTop / lineHeight) - overscan),
    end: Math.min(lineCount, Math.ceil((scrollTop + viewportHeight) / lineHeight) + overscan),
  };
}

/**
 * The scroll position that brings line `line` into view, or null when it is already in view.
 * @param {{ line: number, scrollTop: number, viewportHeight: number, lineHeight: number }} options
 */
export function revealExplorerLine({ line, scrollTop, viewportHeight, lineHeight }) {
  const top = line * lineHeight;
  if (top < scrollTop) {
    return top;
  }
  if (viewportHeight > 0 && top + lineHeight > scrollTop + viewportHeight) {
    return top + lineHeight - viewportHeight;
  }
  return null;
}

/**
 * Where a key moves the selection among `count` entries laid out in `columns` columns (one in the
 * list): the arrows, Home and End. Nothing selected (-1) moves to the first entry. Returns null for
 * other keys.
 * @param {number} index
 * @param {string} key
 * @param {number} count
 * @param {number} [columns]
 */
export function moveExplorerSelection(index, key, count, columns = 1) {
  if (!count) {
    return null;
  }

  const last = count - 1;
  if (key === 'Home') return 0;
  if (key === 'End') return last;
  if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(key)) return null;
  if (index < 0) return 0;
  if (key === 'ArrowDown') return Math.min(index + columns, last);
  if (key === 'ArrowUp') return index - columns >= 0 ? index - columns : index;
  if (columns < 2) return index;
  if (key === 'ArrowRight') return Math.min(index + 1, last);
  return Math.max(index - 1, 0);
}

export const EXPLORER_VIEW_STORAGE_KEY = 'inspector-explorer-view';

// The view the explorer opens in, remembered in this browser: 'icons', or else the list. Reaching
// localStorage throws where a browser blocks it, as some private windows do.
/** @returns {'list' | 'icons'} */
export function readExplorerView(storage = globalThis.localStorage) {
  try {
    return storage?.getItem(EXPLORER_VIEW_STORAGE_KEY) === 'icons' ? 'icons' : 'list';
  } catch {
    return 'list';
  }
}

/** @param {'list' | 'icons'} view */
export function storeExplorerView(view, storage = globalThis.localStorage) {
  try {
    if (view === 'icons') {
      storage?.setItem(EXPLORER_VIEW_STORAGE_KEY, 'icons');
    } else {
      storage?.removeItem(EXPLORER_VIEW_STORAGE_KEY);
    }
  } catch {
    // The choice is not remembered; the explorer still shows it.
  }
}
