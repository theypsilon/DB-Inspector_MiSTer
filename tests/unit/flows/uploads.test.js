import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { droppedEntries, file, openApp, zipJson } from '../support/app.js';

// Mirrors tests/uploads.spec.js.

const GAMMA_URL = 'https://example.com/uploads/gamma.json';

const ALPHA = database('alpha', { 'alpha.rbf': { size: 1, tags: [0] } });
const ALPHA_FORK = database('alpha', { 'fork.rbf': { size: 2 } });
const BETA = database('beta', { 'beta.rbf': { size: 3 } });
const GAMMA = database('gamma', { 'gamma.rbf': { size: 4 } });
const BETA_ZIP = zipJson(BETA);
const LIST_INI = `[mister]\nfilter=arcade\n\n[gamma]\ndb_url=${GAMMA_URL}\n`;

const ROUTES = { [GAMMA_URL]: { body: GAMMA } };

let app;
afterEach(() => app?.close());

test('several chosen files offer their databases, and other files are skipped without a word', async () => {
  app = await openApp('/', { routes: ROUTES });
  await app.upload(
    file('a.json', ALPHA),
    file('copy-of-a.json', ALPHA),
    file('b.json.zip', BETA_ZIP),
    file('notes.txt', 'hello'),
    file('broken.json', '{'),
    file('settings.json', { theme: 'dark' }),
    file('list.ini', LIST_INI),
  );

  assert.equal(app.view.choice.title, 'Choose databases from your files');
  const picker = app.openChoice();
  assert.deepEqual(picker.selected, ['alpha (a.json)', 'beta (b.json.zip)', 'gamma (list.ini)']);
  assert.equal(picker.entries.length, 3);
  assert.equal(picker.entries[0].origin, 'a.json');
  assert.equal(picker.misterOptions[0].label, 'list.ini');
  // "Apply the [mister] filter" starts checked.
  assert.equal(picker.misterKey, picker.misterOptions[0].key);
  assert.equal(app.view.choice.description, 'Found 3 databases in 3 files.');
  assert.equal(app.errorMessage, '');

  assert.equal(picker.openLabel, 'Open 3 selected databases');
  await picker.open();
  assert.equal(app.view.heading, '3 combined databases');
  assert.deepEqual(app.view.appliedFilters, [
    'alphaarcadeshared filter',
    'betaarcadeshared filter',
    'gammaarcadeshared filter',
  ]);
  // Uploaded databases cannot be shared, so only the list's remote database is in the address.
  assert.equal(app.search, `?database-url[gamma]=${GAMMA_URL}&filter=arcade`);

  // Files with the same content as loaded databases are marked as loaded.
  await app.upload(file('again.json', ALPHA), file('again.json.zip', BETA_ZIP), file('fork.json', ALPHA_FORK));
  const again = app.openChoice();
  assert.equal(again.entries.length, 3);
  assert.deepEqual(again.loaded, ['alpha (again.json)', 'beta (again.json.zip)']);
});

test('a chosen folder offers the databases of all its folders, one selected per db_id', async () => {
  app = await openApp('/', { routes: ROUTES });
  await app.uploadFolder('my-dbs', {
    'one/alpha.json': ALPHA,
    'one/deep/beta.json.zip': zipJson(BETA),
    'two/alpha-copy.json': ALPHA,
    'two/alpha-fork.json': ALPHA_FORK,
    'two/list.ini': LIST_INI,
    'readme.md': '# My databases',
  });

  const picker = app.openChoice();
  assert.equal(picker.entries.length, 4);
  assert.deepEqual(picker.selected, [
    'alpha (my-dbs/one/alpha.json)',
    'beta (my-dbs/one/deep/beta.json.zip)',
    'gamma (my-dbs/two/list.ini)',
  ]);

  // Only one database per db_id can be selected.
  picker.click('alpha (my-dbs/two/alpha-fork.json)');
  assert.equal(picker.conflict.selected.dbId, 'alpha');
  picker.replaceConflict();
  assert.deepEqual(picker.selected, [
    'beta (my-dbs/one/deep/beta.json.zip)',
    'alpha (my-dbs/two/alpha-fork.json)',
    'gamma (my-dbs/two/list.ini)',
  ]);

  assert.equal(picker.openLabel, 'Open 3 selected databases');
  await picker.open();
  assert.equal(app.view.heading, '3 combined databases');
  assert.deepEqual(app.view.cards, ['beta', 'alpha', 'gamma']);
  assert.ok(app.view.files.includes('fork.rbf'));
});

test('several lists offer their [mister] filters to choose one from, and a folder always opens the picker', async () => {
  const alphaListUrl = GAMMA_URL.replace('gamma.json', 'alpha.json');
  app = await openApp('/', { routes: { ...ROUTES, [alphaListUrl]: { body: database('alpha_list', {}) } } });

  await app.uploadFolder('lists', {
    'a/downloader.ini': LIST_INI,
    'b/other.ini': `[mister]\nfilter=console\n\n[alpha_list]\ndb_url=${alphaListUrl}\n`,
  });
  const picker = app.openChoice();
  // Two [mister] filters, plus "No [mister] filter": the first one is chosen.
  assert.equal(picker.misterOptions.length, 2);
  assert.equal(picker.misterKey, picker.misterOptions[0].key);
  assert.equal(picker.misterOptions[0].label, 'lists/a/downloader.ini');

  picker.setMister(picker.misterOptions[1].key);
  assert.equal(picker.openLabel, 'Open 2 selected databases');
  await picker.open();
  assert.deepEqual(app.view.appliedFilters, ['gammaconsoleshared filter', 'alpha_listconsoleshared filter']);

  // A folder offers its databases even when it holds only one.
  await app.uploadFolder('single', { 'alpha.json': ALPHA });
  assert.equal(app.state.choicePickerOpen, true);
  assert.deepEqual(app.openChoice().selected, ['alpha (single/alpha.json)']);
});

test('databases opened together share the chosen [mister] filter, else the current FILTER', async () => {
  app = await openApp('/', { routes: ROUTES });
  await app.upload(file('beta.json', BETA));
  await app.typeFilter('console', { pause: false });
  assert.equal(app.filter, 'console');
  const files = () => [file('a.json', ALPHA), file('list.ini', LIST_INI)];

  // The list's [mister] filter wins over FILTER (console).
  await app.upload(...files());
  let picker = app.openChoice();
  assert.equal(picker.openLabel, 'Open 2 selected databases');
  await picker.open();
  await app.loadAlone();
  assert.deepEqual(app.view.appliedFilters, ['alphaarcadeshared filter', 'gammaarcadeshared filter']);

  // Without it, the current FILTER is shared. Both databases are loaded already, so they open
  // again without a question.
  await app.typeSharedFilter('console', { pause: false });
  await app.upload(...files());
  picker = app.openChoice();
  assert.equal(picker.loaded.length, 2);
  // Unchecking "Apply the [mister] filter".
  picker.setMister(null);
  await picker.open();
  assert.deepEqual(app.view.appliedFilters, ['alphaconsoleshared filter', 'gammaconsoleshared filter']);
  assert.equal(app.prompt, null);
  assert.equal(app.state.choicePickerOpen, false);
  assert.equal(app.state.catalogModalOpen, false);
});

test('dropped folders and files are walked the same way, and a single dropped file opens directly', async () => {
  app = await openApp('/', { routes: ROUTES });
  await app.drop(
    droppedEntries({
      'dropped/sub/beta.json.zip': zipJson(BETA),
      'dropped/sub/ignored.txt': 'nothing',
      'loose.json': ALPHA,
    }),
  );
  const picker = app.openChoice();
  assert.deepEqual(picker.selected, ['beta (dropped/sub/beta.json.zip)', 'alpha (loose.json)']);
  await picker.close();

  app.close();
  app = await openApp('/', { routes: ROUTES });
  await app.drop(droppedEntries({ 'loose.json': ALPHA }));
  assert.equal(app.view.heading, 'alpha');
  assert.equal(app.state.choicePickerOpen, false);
});

test('files without databases say so', async () => {
  app = await openApp('/', { routes: ROUTES });
  await app.upload(file('notes.txt', 'hello'), file('settings.json', { theme: 'dark' }));

  assert.equal(app.errorMessage, 'No databases or database lists were found in your files.');
  assert.equal(app.prompt, null);
  assert.equal(app.state.choicePickerOpen, false);
  assert.equal(app.state.catalogModalOpen, false);
});

test('files uploaded while databases are loaded are chosen first, then combined or opened alone', async () => {
  app = await openApp('/', { routes: ROUTES });
  await app.fetch(GAMMA_URL);
  assert.equal(app.view.heading, 'gamma');

  const localGamma = database('gamma', { 'local-gamma.rbf': { size: 5 } });
  await app.upload(file('a.json', ALPHA), file('gamma.json', localGamma));
  assert.equal(app.state.choicePickerOpen, true);
  assert.equal(app.prompt, null);
  assert.equal(app.view.heading, 'gamma');

  const picker = app.openChoice();
  assert.equal(picker.openLabel, 'Open 2 selected databases');
  await picker.open();
  await app.combine();
  assert.deepEqual(app.prompt.conflicts.map(({ dbId }) => dbId), ['gamma']);
  await app.replaceIt();
  assert.deepEqual(app.view.cards, ['gamma', 'alpha']);
  assert.ok(app.view.files.includes('local-gamma.rbf'));
  assert.ok(!app.view.files.includes('gamma.rbf'));
});

function database(dbId, files, extra = {}) {
  return {
    db_id: dbId,
    v: 1,
    timestamp: 1710000000,
    base_files_url: 'https://example.com/files/',
    tag_dictionary: { arcade: 0 },
    files,
    folders: {},
    ...extra,
  };
}
