import assert from 'node:assert/strict';
import test from 'node:test';

import {
  UPDATE_ALL_DEFAULT_DATABASES,
  buildListChoice,
  buildUploadChoice,
  collectSelectedDatabases,
  findDbIdConflict,
  findLoadedKeys,
  findUpdateAllDefaultKeys,
  isLoadedUrl,
  isReloadOf,
  selectOnePerDbId,
  selectPreset,
  selectionIncludesLoadedDatabases,
} from '../../src/lib/selection.js';

const [distribution, updateAll, jtcores, coinOp] = UPDATE_ALL_DEFAULT_DATABASES;
const CATALOG = [
  { key: 'devel', dbId: 'distribution_mister', dbUrl: 'https://raw.githubusercontent.com/MiSTer-devel/Distribution_MiSTer/main/db.json.zip' },
  { key: 'pinned', dbId: 'distribution_mister', dbUrl: distribution.dbUrl },
  { key: 'db9', dbId: 'distribution_mister', dbUrl: 'https://example.com/dbencc.json.zip' },
  { key: 'update-all', dbId: 'update_all_mister', dbUrl: updateAll.dbUrl },
  { key: 'jtcores', dbId: 'jtcores', dbUrl: jtcores.dbUrl },
  { key: 'coin-op', dbId: coinOp.dbId, dbUrl: coinOp.dbUrl },
  { key: 'arcade-1', dbId: 'arcade_roms', dbUrl: 'https://example.com/arcade-1.json' },
  { key: 'arcade-2', dbId: 'arcade_roms', dbUrl: 'https://example.com/arcade-2.json' },
];

test('the Update All defaults are found by URL, else by their db_id', () => {
  assert.deepEqual(findUpdateAllDefaultKeys(CATALOG), ['pinned', 'update-all', 'jtcores', 'coin-op']);

  const withoutPinned = CATALOG.filter((entry) => entry.key !== 'pinned');
  assert.deepEqual(findUpdateAllDefaultKeys(withoutPinned), ['devel', 'update-all', 'jtcores', 'coin-op']);
  assert.deepEqual(findUpdateAllDefaultKeys([]), []);
});

test('selecting all keeps one database per db_id: the Update All default, else the first', () => {
  assert.deepEqual(selectOnePerDbId(CATALOG, findUpdateAllDefaultKeys(CATALOG)), [
    'pinned',
    'update-all',
    'jtcores',
    'coin-op',
    'arcade-1',
  ]);
  assert.deepEqual(selectOnePerDbId(CATALOG), ['devel', 'update-all', 'jtcores', 'coin-op', 'arcade-1']);
  // Earlier preferences win: a database the user picked stays chosen over the Update All default.
  assert.deepEqual(selectOnePerDbId(CATALOG, ['db9', 'arcade-2', ...findUpdateAllDefaultKeys(CATALOG)]), [
    'db9',
    'update-all',
    'jtcores',
    'coin-op',
    'arcade-2',
  ]);
});

test('a preset selects its entries, never two with one db_id', () => {
  assert.deepEqual(selectPreset(CATALOG, ['jtcores', 'pinned', 'update-all']), ['pinned', 'update-all', 'jtcores']);
  assert.deepEqual(selectPreset(CATALOG, ['db9', 'pinned', 'missing']), ['db9']);
});

test('selecting a database whose db_id is already selected finds the conflict', () => {
  const selected = new Set(['pinned', 'jtcores']);

  assert.equal(findDbIdConflict(CATALOG, selected, CATALOG[2]).key, 'pinned');
  assert.equal(findDbIdConflict(CATALOG, selected, CATALOG[1]), null);
  assert.equal(findDbIdConflict(CATALOG, selected, CATALOG[6]), null);
});

function loaded(sourceKind, url, extra = {}) {
  return { inspection: { source: { sourceKind, sourceLabel: url, sourceUrl: url, requestedUrl: url, ...extra } } };
}

test('entries are marked as loaded by any URL their database was opened from', () => {
  const pinned = loaded('url', distribution.dbUrl.toUpperCase());
  const aliased = loaded('url', 'https://example.com/elsewhere.json', { resolvedUrl: jtcores.dbUrl });
  const upload = { inspection: { source: { sourceKind: 'upload', sourceLabel: 'db.json', sourceUrl: 'blob:https://x/1' } } };
  const entries = [...CATALOG, { key: 'uploaded', dbId: 'mine', dbUrl: 'blob:https://x/1' }];

  assert.deepEqual([...findLoadedKeys(entries, [pinned, aliased, upload])], ['pinned', 'jtcores', 'uploaded']);
});

test('a URL is loaded when a loaded database was opened from it', () => {
  const pinned = loaded('url', distribution.dbUrl);
  const aliased = loaded('url', 'https://example.com/elsewhere.json', { resolvedUrl: jtcores.dbUrl });

  assert.equal(isLoadedUrl([pinned, aliased], distribution.dbUrl.toUpperCase()), true);
  assert.equal(isLoadedUrl([pinned, aliased], jtcores.dbUrl), true);
  assert.equal(isLoadedUrl([pinned, aliased], updateAll.dbUrl), false);
  assert.equal(isLoadedUrl([pinned, aliased], 'not a url'), false);
  assert.equal(isLoadedUrl([], distribution.dbUrl), false);
});

test('a database opened again from its URL, with its db_id, reloads it', () => {
  const at = (sourceKind, url, dbId = 'update_all_mister') => ({ overview: { dbId }, source: { sourceKind, sourceLabel: url } });
  const loadedUpdateAll = at('url', updateAll.dbUrl);

  assert.equal(isReloadOf(loadedUpdateAll, at('url', updateAll.dbUrl)), true);
  assert.equal(isReloadOf(loadedUpdateAll, at('url', updateAll.dbUrl.toUpperCase())), true);
  assert.equal(isReloadOf(loadedUpdateAll, at('url', 'https://example.com/fork/update_all_db.json')), false);
  assert.equal(isReloadOf(loadedUpdateAll, at('url', updateAll.dbUrl, 'another_db')), false);
  assert.equal(isReloadOf(loadedUpdateAll, at('upload', 'update_all_db.json')), false);
  assert.equal(isReloadOf(at('upload', 'update_all_db.json'), at('upload', 'update_all_db.json')), false);
});

test('a selection includes the loaded databases only when it opens each of them again', () => {
  const pinned = loaded('url', distribution.dbUrl);
  const jt = loaded('url', jtcores.dbUrl);

  assert.equal(selectionIncludesLoadedDatabases(CATALOG.slice(1, 5), [pinned, jt]), true);
  assert.equal(selectionIncludesLoadedDatabases(CATALOG.slice(1, 4), [pinned, jt]), false);
  assert.equal(selectionIncludesLoadedDatabases(CATALOG, []), true);

  // An upload is opened again from its catalog entry, or from a file with the same content.
  const upload = {
    inspection: { source: { sourceKind: 'upload', sourceLabel: 'db.json', sourceUrl: 'blob:https://x/1', contentHash: 'abc' } },
  };
  assert.equal(selectionIncludesLoadedDatabases([{ key: 'uploaded', dbId: 'mine', dbUrl: 'blob:https://x/1' }], [upload]), true);
  assert.equal(selectionIncludesLoadedDatabases([{ key: 'file:abc', dbId: 'mine', hash: 'abc' }], [upload]), true);
  assert.equal(selectionIncludesLoadedDatabases([{ key: 'file:def', dbId: 'mine', hash: 'def' }], [upload]), false);
});

test('loaded selections keep their databases and report failures and lists', () => {
  const entries = CATALOG.slice(0, 4);
  const database = { kind: 'database', inspection: {} };
  const results = [
    { status: 'fulfilled', value: database },
    { status: 'rejected', reason: new Error('Request failed with 404 Not Found.') },
    { status: 'fulfilled', value: { kind: 'ini', entries: [] } },
    { status: 'rejected', reason: null },
  ];

  assert.deepEqual(collectSelectedDatabases(entries, results), {
    loaded: [{ entry: entries[0], loadedSource: database }],
    errors: [
      `${entries[1].dbUrl}: Request failed with 404 Not Found.`,
      `${entries[2].dbUrl} is a database list. Open it alone to choose one of its databases.`,
      `Could not load ${entries[3].dbUrl}.`,
    ],
  });
  // Messages that already name the URL are kept as they are.
  const blocked = new Error(`Could not open ${entries[0].dbUrl} in the browser.`);
  assert.deepEqual(collectSelectedDatabases(entries.slice(0, 1), [{ status: 'rejected', reason: blocked }]).errors, [
    blocked.message,
  ]);
});

test('a list offers its entries and its [mister] filter; uploads say what was found where', () => {
  const entries = [{ key: '0:a', dbId: 'a', dbUrl: 'https://example.com/a.json' }];
  const list = { source: { sourceLabel: 'downloader.ini' }, entries, defaultFilter: '', defaultFilterPresent: true };

  const listChoice = buildListChoice(list);
  assert.equal(listChoice.description, 'downloader.ini contains 1 entry.');
  assert.deepEqual(listChoice.misterOptions, [{ key: 'mister', label: 'downloader.ini', filter: '' }]);
  assert.deepEqual(buildListChoice({ ...list, defaultFilterPresent: false }).misterOptions, []);

  const uploadChoice = buildUploadChoice({ entries: [...entries, ...entries], misterOptions: [], fileCount: 1 });
  assert.equal(uploadChoice.kind, 'upload');
  assert.equal(uploadChoice.description, 'Found 2 databases in 1 file.');
});

test('uploaded files are marked as loaded by their content', () => {
  const upload = { inspection: { source: { sourceKind: 'upload', sourceLabel: 'a.json', sourceUrl: 'blob:https://x/1', contentHash: 'abc' } } };
  const entries = [
    { key: 'file:abc', dbId: 'a', hash: 'abc' },
    { key: 'file:def', dbId: 'a', hash: 'def' },
    { key: 'catalog', dbId: 'a', dbUrl: 'blob:https://x/1' },
  ];

  assert.deepEqual([...findLoadedKeys(entries, [upload])], ['file:abc', 'catalog']);
});
