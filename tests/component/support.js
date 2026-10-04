import { strToU8 } from 'fflate';
import { applyInspectionFilter, loadDatabaseSourceBytes } from '../../src/lib/database.js';
import { buildArchivesIndex, buildFilesystemIndex } from '../../src/model/views.js';

// An element's text, with its whitespace collapsed as the page shows it.
export function text(element) {
  return element.textContent.replace(/\s+/g, ' ').trim();
}

// What the page shows for a database: its inspection, read by the app's own parser.
export async function inspect(database, name = 'test.json') {
  const loaded = await loadDatabaseSourceBytes(strToU8(JSON.stringify(database)), name);
  return loaded.inspection;
}

// The filesystem rows of a database, as the tree sections index them.
export async function filesystemRows(database, filter = '') {
  const index = buildFilesystemIndex(applyInspectionFilter(await inspect(database), filter));
  return { index, row: (name) => [...index.rowsById.values()].find((row) => row.node.name === name) };
}

// The archive rows of a database, as the Archives section indexes them.
export async function archiveRows(database, filter = '') {
  const index = buildArchivesIndex(applyInspectionFilter(await inspect(database), filter));
  return { index, row: (title) => [...index.rowsById.values()].find((row) => row.type === 'archive' && row.archive.title === title) };
}

// A picker entry, as the catalog, database lists and uploads list them.
export function entry(dbId, extra = {}) {
  return { key: extra.key ?? `url:${dbId}`, dbId, dbUrl: `https://example.com/${dbId}.json`, ...extra };
}
