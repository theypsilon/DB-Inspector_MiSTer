import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCombinedSearch, buildNodeAnchorHash, parseCombinedSearch, parseNodeAnchor } from '../../src/lib/urlState.js';

// parseNodeAnchor reads the hash of the current page.
function parseHash(hash) {
  globalThis.window = { location: { hash } };
  try {
    return parseNodeAnchor();
  } finally {
    delete globalThis.window;
  }
}

const ROW_HASHES = [
  [{ type: 'archive', id: 'archive:cheats_folder_nes' }, '#archives:cheats_folder_nes'],
  [{ type: 'node', id: 'archive:cheats_folder_nes:file:Cheats/NES/a b.zip' }, '#archives:cheats_folder_nes:files:Cheats%2FNES%2Fa%20b.zip'],
  [{ type: 'node', id: 'archive:cheats_folder_nes:folder:Cheats/NES' }, '#archives:cheats_folder_nes:folders:Cheats%2FNES'],
  [{ type: 'node', id: 'archive:cheats_folder_nes:missingfolder:Cheats' }, '#archives:cheats_folder_nes:folders:Cheats'],
  [{ type: 'node', id: 'database:file:_Arcade/Pac Man.mra' }, '#files:_Arcade%2FPac%20Man.mra'],
  [{ type: 'node', id: 'database:folder:_Arcade/cores' }, '#folders:_Arcade%2Fcores'],
  [{ type: 'node', id: 'database:missingfolder:games' }, '#folders:games'],
];

test('every row kind gets an anchor hash', () => {
  for (const [row, hash] of ROW_HASHES) {
    assert.equal(buildNodeAnchorHash(row), hash, row.id);
  }
  assert.equal(buildNodeAnchorHash({ type: 'node', id: 'unexpected:row' }), null);
});

test('anchor hashes lead back to their row, in the right section', () => {
  for (const [row, hash] of ROW_HASHES) {
    const anchor = parseHash(hash);
    const section = row.id.startsWith('archive:') ? 'archives' : 'filesystem';
    assert.equal(anchor.section, section, hash);
    // Folder anchors also match folders the database lists without defining them.
    assert.ok(anchor.rowId === row.id || anchor.altRowId === row.id, hash);
  }
});

test('hashes that are not node anchors are ignored', () => {
  for (const hash of ['', '#', '#install', '#filter', '#unknown:thing']) {
    assert.equal(parseHash(hash), null, hash);
  }
});

test('combined databases scope archive anchors by database, and collided paths get their own', () => {
  const rows = [
    [{ type: 'archive', id: 'archive[jtcores]:cheats' }, '#archives[jtcores]:cheats', 'archives'],
    [{ type: 'node', id: 'archive[jtcores]:cheats:file:Cheats/a.zip' }, '#archives[jtcores]:cheats:files:Cheats%2Fa.zip', 'archives'],
    [{ type: 'node', id: 'archive[jtcores]:cheats:missingfolder:Cheats' }, '#archives[jtcores]:cheats:folders:Cheats', 'archives'],
    [{ type: 'node', id: 'collision:games/nes/mario.nes' }, '#collisions:games%2Fnes%2Fmario.nes', 'collisions'],
  ];

  for (const [row, hash, section] of rows) {
    assert.equal(buildNodeAnchorHash(row), hash, row.id);
    const anchor = parseHash(hash);
    assert.equal(anchor.section, section, hash);
    assert.ok(anchor.rowId === row.id || anchor.altRowId === row.id, hash);
  }

  assert.equal(
    buildNodeAnchorHash({ type: 'node', id: 'collision-version:1:games/nes/mario.nes' }),
    '#collisions:games%2Fnes%2Fmario.nes',
  );
});

test('combined databases are shared as database-url[db_id], with filter for [mister] and filter[db_id] per database', () => {
  const state = {
    databases: [
      { dbId: 'distribution_mister', url: 'https://example.com/db.json.zip' },
      { dbId: 'uploaded', url: null },
      { dbId: 'Coin-Op/Collection', url: 'https://example.com/coinop.json' },
    ],
    sharedFilter: { isSet: true, value: 'arcade !cheats' },
    overrides: { 'Coin-Op/Collection': '[mister] !beta', uploaded: '' },
  };

  const search = buildCombinedSearch('?database-url=https%3A%2F%2Fold.json&filter=old&detailed=', state);

  assert.equal(
    search,
    '?database-url[distribution_mister]=https%3A%2F%2Fexample.com%2Fdb.json.zip' +
      '&database-url[Coin-Op%2FCollection]=https%3A%2F%2Fexample.com%2Fcoinop.json' +
      '&filter=arcade%20!cheats' +
      '&filter[uploaded]=' +
      '&filter[Coin-Op%2FCollection]=%5Bmister%5D%20!beta' +
      '&detailed=',
  );
  assert.deepEqual(parseCombinedSearch(search), {
    databases: [
      { key: 'distribution_mister', url: 'https://example.com/db.json.zip' },
      { key: 'Coin-Op/Collection', url: 'https://example.com/coinop.json' },
    ],
    sharedFilter: { isSet: true, value: 'arcade !cheats' },
    overrides: { uploaded: '', 'Coin-Op/Collection': '[mister] !beta' },
  });
});

test('single-database URLs are not combined sessions, and an unset shared filter is left out', () => {
  assert.equal(parseCombinedSearch('?database-url=https%3A%2F%2Fexample.com%2Fdb.json&filter=arcade'), null);

  const search = buildCombinedSearch('', {
    databases: [{ dbId: 'a', url: 'https://example.com/a.json' }, { dbId: 'b', url: 'https://example.com/b.json' }],
    sharedFilter: { isSet: false, value: '' },
    overrides: {},
  });
  assert.equal(search, '?database-url[a]=https%3A%2F%2Fexample.com%2Fa.json&database-url[b]=https%3A%2F%2Fexample.com%2Fb.json');
  assert.deepEqual(parseCombinedSearch(search).sharedFilter, { isSet: false, value: '' });

  // Encoded brackets read the same, and a plain database-url joins the combination first.
  assert.deepEqual(
    parseCombinedSearch('?database-url=https%3A%2F%2Fexample.com%2Fz.json&database-url%5Ba%5D=https%3A%2F%2Fexample.com%2Fa.json').databases,
    [{ key: '', url: 'https://example.com/z.json' }, { key: 'a', url: 'https://example.com/a.json' }],
  );
});
