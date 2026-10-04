import { readUploadCandidate } from './database.js';

// Several files, or whole folders, uploaded at once. Only database lists (`.ini`) and databases
// (`.json`, `.json.zip`) that Downloader would accept are kept; every other file is skipped.

const UPLOAD_SUFFIXES = ['.ini', '.json', '.json.zip'];

export function isUploadCandidateName(name) {
  const lowerName = String(name).toLowerCase();
  return UPLOAD_SUFFIXES.some((suffix) => lowerName.endsWith(suffix));
}

// The files of a file input, by name.
export function listChosenFiles(fileList) {
  return [...fileList].map((file) => ({ file, path: file.name }));
}

// What a drop holds. Runs during the drop event, since the browser empties the drop data after it.
// Files and folders come as entries when the browser can list folders, else as plain files.
export function captureDrop(dataTransfer) {
  const items = [...(dataTransfer?.items ?? [])].filter((item) => item.kind === 'file');
  const entries = items.map((item) => item.webkitGetAsEntry?.() ?? null);
  const files = [...(dataTransfer?.files ?? [])];
  return entries.length && entries.every(Boolean) ? { entries, files } : { entries: null, files };
}

// A drop of a single file is opened like a chosen file; anything else is a set of uploads.
export function isSingleFileDrop({ entries, files }) {
  return entries ? entries.length === 1 && entries[0].isFile : files.length === 1;
}

export function readSingleDroppedFile({ entries, files }) {
  return files[0] ? Promise.resolve(files[0]) : readFileEntry(entries[0]);
}

// How often walking a dropped folder reports how many files it has gone through.
const VISITED_PROGRESS_STEP = 50;

// The files of a drop that can hold databases, walking into folders. Paths start at the dropped
// item, and folders that cannot be read are skipped.
/**
 * @param {{ entries?: any[], files?: File[] }} drop
 * @param {(visited: number) => void} [onProgress]
 */
export async function listDroppedFiles({ entries, files }, onProgress = () => {}) {
  if (!entries) {
    return files.map((file) => ({ file, path: file.name }));
  }

  const found = [];
  let visited = 0;
  async function visit(entry) {
    if (entry.isDirectory) {
      for (const child of await readDirectoryEntries(entry)) {
        await visit(child);
      }
      return;
    }

    visited += 1;
    if (entry.isFile && isUploadCandidateName(entry.name)) {
      const file = await readFileEntry(entry).catch(() => null);
      if (file) {
        found.push({ file, path: entry.fullPath.replace(/^\/+/, '') });
      }
    }
    if (visited % VISITED_PROGRESS_STEP === 0) {
      onProgress(visited);
    }
  }

  for (const entry of entries) {
    await visit(entry);
  }
  return found;
}

function readFileEntry(entry) {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

async function readDirectoryEntries(directory) {
  const reader = directory.createReader();
  const children = [];
  try {
    for (;;) {
      const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
      if (!batch.length) {
        return children;
      }
      children.push(...batch);
    }
  } catch {
    return children;
  }
}

// Reads uploaded files ({ file, path }) and lists the databases they offer, in path order: each
// database file, and each entry of each database list, with the path it came from. Identical files
// are read once. `misterOptions` are the lists' [mister] filters.
/**
 * @param {{ file: File, path: string }[]} files
 * @param {{ onProgress?: (read: number, total: number) => void }} [options]
 */
export async function scanUploads(files, { onProgress = () => {} } = {}) {
  const candidates = files
    .filter(({ path }) => isUploadCandidateName(path))
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' }));
  const seenHashes = new Set();
  const entries = [];
  const lists = [];
  const misterOptions = [];
  let fileCount = 0;

  for (const [index, { file, path }] of candidates.entries()) {
    onProgress(index, candidates.length);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const hash = await hashContent(bytes);
    if (seenHashes.has(hash)) {
      continue;
    }

    seenHashes.add(hash);
    const candidate = readUploadCandidate(bytes, file.name);
    const expectedKind = path.toLowerCase().endsWith('.ini') ? 'ini' : 'database';
    if (candidate?.kind !== expectedKind) {
      continue;
    }

    fileCount += 1;
    if (candidate.kind === 'database') {
      entries.push({ key: `file:${hash}`, dbId: candidate.dbId, title: 'Database file', origin: path, file, hash });
      continue;
    }

    const list = { kind: 'ini', source: { sourceKind: 'upload', sourceLabel: path }, ...candidate };
    lists.push(list);
    if (list.defaultFilterPresent) {
      misterOptions.push({ key: hash, label: path, filter: list.defaultFilter });
    }
    for (const entry of list.entries) {
      entries.push({ ...entry, key: `list:${hash}:${entry.key}`, origin: path });
    }
  }

  onProgress(candidates.length, candidates.length);
  return { entries, lists, misterOptions, fileCount };
}

// A digest of a file's content, to recognize identical files. Pages served over plain HTTP have no
// SubtleCrypto, so they fall back to a 53-bit hash of the content and its length.
export async function hashContent(bytes, subtle = globalThis.crypto?.subtle) {
  if (subtle) {
    const digest = new Uint8Array(await subtle.digest('SHA-256', bytes));
    return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (const byte of bytes) {
    h1 = Math.imul(h1 ^ byte, 2654435761);
    h2 = Math.imul(h2 ^ byte, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${bytes.length}:${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16)}`;
}
