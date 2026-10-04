import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { file, openApp, zipJson } from '../support/app.js';
import { formatFilterPromptValue } from '../../../src/lib/filterDefaults.js';

// Mirrors tests/pickers.spec.js.

const RUNTIME_CATALOG_URL =
  'https://raw.githubusercontent.com/theypsilon/Update_All_MiSTer/master/src/update_all/databases.py';
const MULTIDATABASES_CATALOG_URL =
  'https://raw.githubusercontent.com/theypsilon/MultiDatabases_MiSTer/main/README.md';

// The four databases Update All installs by default, as its catalog lists them.
const UPDATE_ALL_URL = 'https://raw.githubusercontent.com/theypsilon/Update_All_MiSTer/db/update_all_db.json';
const PINNED_URL =
  'https://raw.githubusercontent.com/theypsilon/MultiDatabases_MiSTer/db/distribution-mister-pinned-linux/db.json.zip';
const JTCORES_URL = 'https://raw.githubusercontent.com/jotego/jtcores_mister/main/jtbindb.json.zip';
const COIN_OP_URL = 'https://raw.githubusercontent.com/Coin-OpCollection/Distribution-MiSTerFPGA/db/db.json.zip';
const EDGE_URL = 'https://raw.githubusercontent.com/MiSTer-devel/Distribution_MiSTer/main/db.json.zip';
const ARCADE_URL = 'https://example.com/pickers/arcade.json';
const EXTRA_URL = 'https://raw.githubusercontent.com/theypsilon/MultiDatabases_MiSTer/db/extra/db.json';

// Edge Linux comes before the pinned Main Distribution, so "first" and "Update All default" differ.
const RUNTIME_CATALOG_SOURCE = `
self.UPDATE_ALL_MISTER = Database(db_id='update_all_mister', db_url='${UPDATE_ALL_URL}', title='Update All files')
self.MISTER_DEVEL_DISTRIBUTION_MISTER = Database(db_id='distribution_mister', db_url='${EDGE_URL}', title='Main Distribution: MiSTer-devel (Edge Linux)')
self.MISTER_PINNED_LINUX_DISTRIBUTION_MISTER = Database(db_id='distribution_mister', db_url='${PINNED_URL}', title='Main Distribution: MiSTer-devel')
self.JTCORES = Database(db_id='jtcores', db_url='${JTCORES_URL}', title='JTCORES for MiSTer')
self.ARCADE_ROMS = Database(db_id='arcade_roms_db', db_url='${ARCADE_URL}', title='Arcade ROMs Database')
self.COIN_OP_COLLECTION = Database(db_id='Coin-OpCollection/Distribution-MiSTerFPGA', db_url='${COIN_OP_URL}', title='Coin-Op Collection')
`;
const MULTIDATABASES_CATALOG_SOURCE = `
| Database | What it installs | Links |
| --- | --- | --- |
| [Extra](extra/) | Extra files | [Inspect](https://theypsilon.github.io/DB-Inspector_MiSTer/?database-url=${encodeURIComponent(EXTRA_URL)}) |
`;

const DATABASES = [
  [UPDATE_ALL_URL, 'update_all_mister'],
  [EDGE_URL, 'distribution_mister'],
  [PINNED_URL, 'distribution_mister'],
  [JTCORES_URL, 'jtcores'],
  [ARCADE_URL, 'arcade_roms_db'],
  [COIN_OP_URL, 'Coin-OpCollection/Distribution-MiSTerFPGA'],
  [EXTRA_URL, 'extra_db'],
];
const UPDATE_ALL_DEFAULTS = [
  'Update All files (update_all_mister)',
  'Main Distribution: MiSTer-devel (distribution_mister)',
  'JTCORES for MiSTer (jtcores)',
  'Coin-Op Collection (Coin-OpCollection/Distribution-MiSTerFPGA)',
];
const EDGE = 'Main Distribution: MiSTer-devel (Edge Linux) (distribution_mister)';

const LIST_INI = `[mister]
filter=arcade

[jtcores]
db_url=${JTCORES_URL}
filter=[mister] console

[arcade_roms_db]
db_url=${ARCADE_URL}
`;

const ROUTES = {
  [RUNTIME_CATALOG_URL]: { body: RUNTIME_CATALOG_SOURCE, contentType: 'text/plain' },
  [MULTIDATABASES_CATALOG_URL]: { body: MULTIDATABASES_CATALOG_SOURCE, contentType: 'text/markdown' },
  ...Object.fromEntries(
    DATABASES.map(([url, dbId]) => {
      const database = {
        db_id: dbId,
        v: 1,
        timestamp: 1710000000,
        base_files_url: 'https://example.com/files/',
        tag_dictionary: { arcade: 0, console: 1 },
        files: {
          [`cores/${dbId.replaceAll('/', '_')}.rbf`]: { size: 1, hash: dbId, tags: [0] },
          'cores/console.rbf': { size: 2, hash: dbId, tags: [1] },
        },
        folders: {},
      };
      const zipped = url.endsWith('.zip');
      return [url, zipped ? { body: zipJson(database), contentType: 'application/zip' } : { body: database }];
    }),
  ),
};

let app;
afterEach(() => app?.close());

function openCatalog(entryCount = 7) {
  const picker = app.openCatalog();
  assert.equal(app.catalog.status, 'ready');
  assert.equal(picker.search('').length, entryCount);
  return picker;
}

test('the catalog starts with nothing selected and selects the Update All defaults', async () => {
  app = await openApp('/', { routes: ROUTES });
  const catalog = openCatalog();
  assert.deepEqual(catalog.selected, []);
  assert.equal(catalog.openLabel, 'Open selected databases');

  catalog.selectUpdateAllDefaults();
  assert.deepEqual(catalog.selected, UPDATE_ALL_DEFAULTS);
  assert.deepEqual(catalog.selectedDbIds, [
    'update_all_mister',
    'distribution_mister',
    'jtcores',
    'Coin-OpCollection/Distribution-MiSTerFPGA',
  ]);

  assert.equal(catalog.openLabel, 'Open 4 selected databases');
  await catalog.open();
  assert.equal(app.view.heading, '4 combined databases');
  assert.deepEqual(app.view.cards, [
    'update_all_mister',
    'distribution_mister',
    'jtcores',
    'Coin-OpCollection/Distribution-MiSTerFPGA',
  ]);
  assert.equal(app.hash, `#db=${UPDATE_ALL_URL}&db=${PINNED_URL}&db=${JTCORES_URL}&db=${COIN_OP_URL}`);
});

test('choosing a database whose db_id is selected asks whether to replace it', async () => {
  app = await openApp('/', { routes: ROUTES });
  const catalog = openCatalog();
  catalog.selectUpdateAllDefaults();

  catalog.click(EDGE);
  assert.equal(catalog.conflict.selected.dbId, 'distribution_mister');
  assert.equal(catalog.conflict.incoming.dbId, 'distribution_mister');
  // Escape cancels the question, not the catalog.
  catalog.cancelConflict();
  assert.equal(catalog.conflict, null);
  assert.equal(app.state.catalogModalOpen, true);
  assert.ok(!catalog.selected.includes(EDGE));

  catalog.click(EDGE);
  catalog.cancelConflict();
  assert.ok(!catalog.selected.includes(EDGE));
  assert.ok(catalog.selected.includes(UPDATE_ALL_DEFAULTS[1]));

  catalog.click(EDGE);
  catalog.replaceConflict();
  assert.ok(catalog.selected.includes(EDGE));
  assert.ok(!catalog.selected.includes(UPDATE_ALL_DEFAULTS[1]));
  assert.deepEqual(catalog.selected, [UPDATE_ALL_DEFAULTS[0], EDGE, UPDATE_ALL_DEFAULTS[2], UPDATE_ALL_DEFAULTS[3]]);
});

test('select all picks one database per db_id: the one chosen, else the Update All default', async () => {
  app = await openApp('/', { routes: ROUTES });
  const catalog = openCatalog();
  const allDatabases = [
    UPDATE_ALL_DEFAULTS[0],
    UPDATE_ALL_DEFAULTS[1],
    UPDATE_ALL_DEFAULTS[2],
    'Arcade ROMs Database (arcade_roms_db)',
    UPDATE_ALL_DEFAULTS[3],
    'Extra (MultiDatabases/extra)',
  ];

  assert.equal(catalog.toggleAllLabel, 'Select all');
  catalog.toggleAll();
  assert.deepEqual(catalog.selected, allDatabases);

  assert.equal(catalog.toggleAllLabel, 'Select none');
  catalog.toggleAll();
  assert.deepEqual(catalog.selected, []);

  catalog.check(EDGE);
  catalog.toggleAll();
  const withEdge = [...allDatabases];
  withEdge[1] = EDGE;
  assert.deepEqual(catalog.selected, withEdge);
});

test('opening a selection asks first only when it would close a loaded database', async () => {
  app = await openApp('/', { routes: ROUTES });
  await app.fetch(ARCADE_URL);
  assert.equal(app.view.heading, 'arcade_roms_db');

  let catalog = openCatalog();
  assert.deepEqual(catalog.loaded, ['Arcade ROMs Database (arcade_roms_db)']);
  catalog.selectUpdateAllDefaults();
  assert.equal(catalog.openLabel, 'Open 4 selected databases');
  await catalog.open();
  assert.equal(app.prompt.kind, 'loadMode');
  assert.equal(app.prompt.incomingCount, 4);
  await app.combine();
  assert.equal(app.view.heading, '5 combined databases');
  assert.deepEqual(app.view.cards, [
    'arcade_roms_db',
    'update_all_mister',
    'distribution_mister',
    'jtcores',
    'Coin-OpCollection/Distribution-MiSTerFPGA',
  ]);

  // Every loaded database is part of this selection, so nothing would close and nothing is asked.
  catalog = openCatalog();
  assert.equal(catalog.loaded.length, 5);
  catalog.toggleAll();
  assert.equal(catalog.openLabel, 'Open 6 selected databases');
  await catalog.open();
  assert.equal(app.view.heading, '6 combined databases');
  assert.equal(app.prompt, null);
  // The selection is opened afresh, in catalog order, and the approximate catalog ID is replaced
  // by the real one once that database is opened.
  assert.deepEqual(app.view.cards, [
    'update_all_mister',
    'distribution_mister',
    'jtcores',
    'arcade_roms_db',
    'Coin-OpCollection/Distribution-MiSTerFPGA',
    'extra_db',
  ]);

  catalog = openCatalog();
  catalog.check(UPDATE_ALL_DEFAULTS[2]);
  assert.equal(catalog.openLabel, 'Open selected database');
  await catalog.open();
  await app.loadAlone();
  assert.equal(app.view.heading, 'jtcores');
  assert.equal(app.view.combined, null);
  assert.equal(app.hash, `#db=${JTCORES_URL}`);
});

test('databases opened together from the catalog share the current FILTER', async () => {
  app = await openApp('/', { routes: ROUTES });
  await app.fetch(ARCADE_URL);
  await app.typeFilter('console', { pause: false });
  assert.equal(app.filter, 'console');

  const catalog = openCatalog();
  catalog.check(UPDATE_ALL_DEFAULTS[0]);
  catalog.check(UPDATE_ALL_DEFAULTS[2]);
  assert.equal(catalog.openLabel, 'Open 2 selected databases');
  await catalog.open();
  await app.loadAlone();

  assert.equal(app.view.heading, '2 combined databases');
  assert.equal(app.sharedFilter, 'console');
  assert.deepEqual(app.view.appliedFilters, ['update_all_misterconsoleshared filter', 'jtcoresconsoleshared filter']);
  assert.equal(app.hash, `#db=${UPDATE_ALL_URL}&db=${JTCORES_URL}&filter=console`);
});

test('a database list opens with all its databases selected and its [mister] filter applied', async () => {
  app = await openApp('/', { routes: ROUTES });
  await app.upload(file('downloader.ini', LIST_INI));

  assert.equal(app.view.choice.title, 'Choose databases from this list');
  const picker = app.openChoice();
  // "Apply the [mister] filter" starts checked.
  assert.equal(picker.misterKey, picker.misterOptions[0].key);
  assert.equal(formatFilterPromptValue(picker.misterOptions[0].filter), 'arcade');
  assert.equal(formatFilterPromptValue(picker.entries[0].sectionFilter), '[mister] console');
  assert.deepEqual(picker.selected, ['jtcores', 'arcade_roms_db']);

  picker.toggleAll();
  assert.deepEqual(picker.selected, []);
  assert.equal(picker.openLabel, 'Open selected databases');
  picker.toggleAll();

  assert.equal(picker.openLabel, 'Open 2 selected databases');
  await picker.open();
  assert.equal(app.view.heading, '2 combined databases');
  // As in downloader.ini: [mister] is the shared filter and each section's filter is its own.
  assert.deepEqual(app.view.appliedFilters, ['jtcoresarcade consoleits own filter', 'arcade_roms_dbarcadeshared filter']);
  assert.equal(app.sharedFilter, 'arcade');
  assert.equal(app.ownFilter('jtcores'), '[mister] console');
  assert.equal(app.hash, `#db=${JTCORES_URL}&db=${ARCADE_URL}&filter=arcade&filter.jtcores=[mister]+console`);
});

test('a database list can be opened without its [mister] filter', async () => {
  app = await openApp('/', { routes: ROUTES });
  await app.upload(file('downloader.ini', LIST_INI));

  const picker = app.openChoice();
  // Unchecking "Apply the [mister] filter".
  picker.setMister(null);
  assert.equal(picker.openLabel, 'Open 2 selected databases');
  await picker.open();

  assert.equal(app.view.heading, '2 combined databases');
  assert.deepEqual(app.view.appliedFilters, ['jtcoresconsoleits own filter', 'arcade_roms_dbEverythingno filter']);
  assert.equal(app.hash, `#db=${JTCORES_URL}&db=${ARCADE_URL}&filter.jtcores=[mister]+console`);
});

test('a database list read while databases are loaded asks to combine only once its databases are chosen', async () => {
  app = await openApp('/', { routes: ROUTES });
  await app.fetch(UPDATE_ALL_URL);
  assert.equal(app.view.heading, 'update_all_mister');

  await app.upload(file('downloader.ini', LIST_INI));
  assert.equal(app.state.choicePickerOpen, true);
  assert.equal(app.prompt, null);

  const picker = app.openChoice();
  assert.equal(picker.openLabel, 'Open 2 selected databases');
  await picker.open();
  assert.equal(app.prompt.kind, 'loadMode');
  assert.equal(app.prompt.incomingCount, 2);
  await app.combine();

  assert.equal(app.view.heading, '3 combined databases');
  // Joining databases keep what their list gives them, resolved against the list's [mister].
  assert.deepEqual(app.view.appliedFilters, [
    'update_all_misterEverythingno filter',
    'jtcoresarcade consoleits own filter',
    'arcade_roms_dbarcadeits own filter',
  ]);
});

test('uploaded databases open again from the catalog, alone or combined', async () => {
  const uploaded = (dbId) => ({ db_id: dbId, v: 1, timestamp: 1710000000, files: { [`${dbId}.rbf`]: { size: 1 } }, folders: {} });
  app = await openApp('/', { routes: ROUTES });
  await app.upload(file('mine.json', uploaded('mine_db')));
  assert.equal(app.view.heading, 'mine_db');
  await app.upload(file('other.json', uploaded('other_db')));
  await app.loadAlone();
  assert.equal(app.view.heading, 'other_db');

  let catalog = openCatalog(9);
  catalog.check('Uploaded: mine.json (mine_db)');
  assert.equal(catalog.openLabel, 'Open selected database');
  await catalog.open();
  await app.loadAlone();
  assert.equal(app.view.heading, 'mine_db');
  assert.equal(app.errorMessage, '');
  // Uploaded databases cannot be shared, so the link is empty.
  assert.equal(app.hash, '');

  catalog = openCatalog(9);
  assert.ok(catalog.loaded.includes('Uploaded: mine.json (mine_db)'));
  catalog.check('Uploaded: other.json (other_db)');
  await catalog.open();
  await app.combine();
  assert.deepEqual(app.view.cards, ['mine_db', 'other_db']);

  // Both uploads are part of this selection, so they open again without a question.
  catalog = openCatalog(9);
  catalog.check('Uploaded: mine.json (mine_db)');
  catalog.check('Uploaded: other.json (other_db)');
  assert.equal(catalog.openLabel, 'Open 2 selected databases');
  await catalog.open();
  assert.equal(app.view.heading, '2 combined databases');
  assert.equal(app.prompt, null);
  assert.equal(app.errorMessage, '');
});
