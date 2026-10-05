import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { file, openApp } from '../support/app.js';
import { buildDownloaderIni, sessionInstallFilters, splitInstallableDatabases } from '../../../src/lib/downloaderIni.js';

// install_all() in the console: the downloader.ini of every loaded database. Opened as any
// downloader.ini is, it gives each database the filter it had: what Downloader would give it.
// The dialog, its link and the download are in the component tests and the journeys.

const JTCORES_URL = 'https://example.com/install-all/jtcores.json';
const ARCADE_URL = 'https://example.com/install-all/arcade.json';
const database = (dbId, extra = {}) => ({
  db_id: dbId,
  v: 1,
  timestamp: 1710000000,
  base_files_url: `https://example.com/${dbId}/`,
  tag_dictionary: { arcade: 0, console: 1, cheats: 2 },
  files: { 'cores/arcade.rbf': { size: 1, hash: 'a', tags: [0] }, 'cores/console.rbf': { size: 2, hash: 'c', tags: [1] } },
  folders: {},
  ...extra,
});
const ROUTES = {
  // jtcores has a default filter of its own.
  [JTCORES_URL]: { body: database('jtcores', { default_options: { filter: 'console' } }) },
  [ARCADE_URL]: { body: database('arcade_roms_db') },
};
const LIST_INI = `[mister]
filter=arcade

[jtcores]
db_url=${JTCORES_URL}

[arcade_roms_db]
db_url=${ARCADE_URL}
`;

let app;
afterEach(() => app?.close());

// The downloader.ini of what is loaded, with its filters or without them.
function installAllIni({ includeFilters }) {
  const { databases, debouncedCombinedFilters, debouncedFilterInput } = app.state;
  const filters = sessionInstallFilters({ databases, combinedFilters: debouncedCombinedFilters, filterInput: debouncedFilterInput });
  return buildDownloaderIni(splitInstallableDatabases(databases).installable, includeFilters ? filters : null);
}

// Opens a downloader.ini on a fresh page, with every database in it.
async function openIni(ini) {
  app.close();
  app = await openApp('/', { routes: ROUTES });
  await app.upload(file('downloader.ini', ini));
  if (app.view.choice) {
    await app.openChoice().open();
  }
}

test('combined databases come back from their downloader.ini with the filters each one had', async () => {
  app = await openApp('/', { routes: ROUTES });
  await app.upload(file('downloader.ini', LIST_INI));
  await app.openChoice().open();
  // The shared filter changes, and arcade_roms_db gets a filter of its own that keeps [mister].
  await app.typeSharedFilter('arcade !cheats');
  await app.giveOwnFilter('arcade_roms_db');
  await app.typeOwnFilter('arcade_roms_db', '[mister] console');
  const applied = app.view.appliedFilters;
  const hash = app.hash;
  // The shared filter replaces jtcores' default, as [mister] does in Downloader.
  assert.deepEqual(applied, [
    'jtcoresarcade !cheatsshared filter',
    'arcade_roms_dbarcade !cheats consoleits own filter',
  ]);

  const ini = installAllIni({ includeFilters: true });
  assert.equal(
    ini,
    `[mister]\nfilter=arcade !cheats\n\n[jtcores]\ndb_url=${JTCORES_URL}\n\n[arcade_roms_db]\ndb_url=${ARCADE_URL}\nfilter=[mister] console\n`,
  );
  await openIni(ini);
  assert.equal(app.view.heading, '2 combined databases');
  assert.deepEqual(app.view.appliedFilters, applied);
  assert.equal(app.sharedFilter, 'arcade !cheats');
  assert.equal(app.ownFilter('arcade_roms_db'), '[mister] console');
  assert.equal(app.hash, hash);

  // Without its filters, each database gets its default, or none.
  await openIni(installAllIni({ includeFilters: false }));
  assert.deepEqual(app.view.appliedFilters, ['jtcoresconsoledatabase default', 'arcade_roms_dbEverythingno filter']);
});

test('a database alone comes back with its FILTER, kept as its own filter only when it differs from its default', async () => {
  app = await openApp(`/#db=${JTCORES_URL}`, { routes: ROUTES });
  assert.equal(app.filter, 'console');
  assert.equal(installAllIni({ includeFilters: true }), `[jtcores]\ndb_url=${JTCORES_URL}\n`);

  await app.typeFilter('arcade');
  const ini = installAllIni({ includeFilters: true });
  assert.equal(ini, `[jtcores]\ndb_url=${JTCORES_URL}\nfilter=arcade\n`);
  await openIni(ini);
  assert.equal(app.view.heading, 'jtcores');
  assert.equal(app.filter, 'arcade');

  // Emptied, FILTER shows everything, and so does the database opened from its file.
  await app.typeFilter('');
  await openIni(installAllIni({ includeFilters: true }));
  assert.equal(app.view.heading, 'jtcores');
  assert.equal(app.filter, '');
});

test('uploaded databases are left out', async () => {
  app = await openApp(`/#db=${ARCADE_URL}`, { routes: ROUTES });
  await app.upload(file('mine.json', database('mine')));
  await app.combine();
  assert.equal(app.view.heading, '2 combined databases');
  assert.deepEqual(splitInstallableDatabases(app.state.databases).leftOut, ['mine']);
  assert.equal(installAllIni({ includeFilters: false }), `[arcade_roms_db]\ndb_url=${ARCADE_URL}\n`);
});
