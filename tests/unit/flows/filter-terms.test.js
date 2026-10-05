import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { openApp } from '../support/app.js';
import { buildFilterTerms, toggleSharedFilter, toggleTerm } from '../../../src/lib/filterTerms.js';
import { countLoadedFiles } from '../../../src/model/views.js';

// The filter terms dialog over databases opened as the page opens them: the terms it lists for
// each FILTER box, and the FILTER a choice writes, which then works as typed FILTER does (the link,
// the filters applied). The dialog itself (its rows and buttons) is in the component tests.

const ALPHA_URL = 'https://example.com/alpha.json';
const BETA_URL = 'https://example.com/beta.json';

const database = (dbId, tagDictionary, files) => ({
  db_id: dbId,
  v: 1,
  timestamp: 1710000000,
  base_files_url: `https://example.com/${dbId}/`,
  tag_dictionary: tagDictionary,
  files,
  folders: {},
});

const ROUTES = {
  [ALPHA_URL]: { body: database('alpha', { arcade: 0, cheats: 1 }, { 'a.rbf': { size: 1, hash: 'a', tags: [0] }, 'a.cht': { size: 1, hash: 'b', tags: [1] } }) },
  [BETA_URL]: { body: database('beta', { arcade: 0, console: 1 }, { 'b.rbf': { size: 1, hash: 'c', tags: [0] }, 'b.rom': { size: 1, hash: 'd', tags: [1] } }) },
};

let app;
afterEach(() => app?.close());

// The terms of the loaded databases, as the page builds them for a FILTER box: every database's for
// FILTER and the shared filter, one database's for its own filter.
function termsFor(box) {
  const loaded = app.state.databases.map(({ inspection }) => ({ dbId: inspection.overview.dbId, inspection }));
  return buildFilterTerms(box === 'main' ? loaded : loaded.filter(({ dbId }) => dbId === box)).terms;
}

function term(box, name) {
  return termsFor(box).find((candidate) => candidate.name === name);
}

test('choosing terms writes FILTER, which filters and reaches the link as typing it does', async () => {
  app = await openApp(`/#db=${ALPHA_URL}`, { routes: ROUTES });
  assert.deepEqual(termsFor('main').map(({ name }) => name), ['arcade', 'cheats']);

  await app.typeFilter(toggleTerm(app.filter, term('main', 'cheats'), 'excluded'));
  assert.equal(app.filter, '!cheats');
  assert.deepEqual(app.view.files, ['a.rbf']);
  assert.equal(app.hash, `#db=${ALPHA_URL}&filter=!cheats`);

  await app.typeFilter(toggleTerm(app.filter, term('main', 'cheats'), 'excluded'));
  assert.equal(app.filter, '');
  assert.deepEqual(app.view.files, ['a.cht', 'a.rbf']);
});

test('combined databases: the shared filter’s terms are every database’s, a database’s own filter’s are its own', async () => {
  app = await openApp(`/#db=${ALPHA_URL}&db=${BETA_URL}`, { routes: ROUTES });
  assert.equal(app.view.heading, '2 combined databases');
  assert.deepEqual(termsFor('main').map(({ name, dbIds }) => `${name} ${dbIds.join(',')}`), ['arcade alpha,beta', 'cheats alpha', 'console beta']);
  assert.deepEqual(termsFor('beta').map(({ name }) => name), ['arcade', 'console']);

  await app.typeSharedFilter(toggleTerm(app.sharedFilter, term('main', 'arcade'), 'kept'));
  await app.giveOwnFilter('beta');
  await app.typeOwnFilter('beta', toggleTerm(app.ownFilter('beta'), term('beta', 'console'), 'kept'));
  assert.equal(app.sharedFilter, 'arcade');
  assert.equal(app.ownFilter('beta'), 'arcade console');
  assert.deepEqual(app.view.appliedFilters, ['alphaarcadeshared filter', 'betaarcade consoleits own filter']);
  assert.equal(app.hash, `#db=${ALPHA_URL}&db=${BETA_URL}&filter=arcade&filter.beta=arcade+console`);
});

test('a database’s own filter that includes the shared filter gets its terms, in the link as [mister], until it leaves it out again', async () => {
  app = await openApp(`/#db=${ALPHA_URL}&db=${BETA_URL}&filter=arcade&filter.beta=console`, { routes: ROUTES });
  assert.deepEqual(app.view.appliedFilters, ['alphaarcadeshared filter', 'betaconsoleits own filter']);

  await app.typeOwnFilter('beta', toggleSharedFilter(app.ownFilter('beta'), true));
  assert.equal(app.ownFilter('beta'), '[mister] console');
  assert.deepEqual(app.view.appliedFilters, ['alphaarcadeshared filter', 'betaarcade consoleits own filter']);
  assert.equal(app.hash, `#db=${ALPHA_URL}&db=${BETA_URL}&filter=arcade&filter.beta=[mister]+console`);

  await app.typeOwnFilter('beta', toggleSharedFilter(app.ownFilter('beta'), false));
  assert.equal(app.ownFilter('beta'), 'console');
  assert.deepEqual(app.view.appliedFilters, ['alphaarcadeshared filter', 'betaconsoleits own filter']);
  assert.equal(app.hash, `#db=${ALPHA_URL}&db=${BETA_URL}&filter=arcade&filter.beta=console`);
});

test('the dialog counts what FILTER matches against all the files the loaded databases list: archive entries in, a shared path once', async () => {
  const archived = {
    ...database('archived', { arcade: 0 }, { 'cores/shared.rbf': { size: 1, hash: 's', tags: [0] } }),
    archives: {
      roms: {
        description: 'ROMs',
        format: 'zip',
        extract: 'all',
        target_folder: 'games/',
        archive_file: { url: 'https://example.com/roms.zip', size: 1, hash: 'z' },
        summary_inline: { files: { 'games/one.rom': { arc_id: 'roms', size: 1, hash: 'o' }, 'games/two.rom': { arc_id: 'roms', size: 1, hash: 't' } }, folders: {} },
      },
    },
  };
  const ARCHIVED_URL = 'https://example.com/archived.json';
  app = await openApp(`/#db=${ARCHIVED_URL}`, { routes: { ...ROUTES, [ARCHIVED_URL]: { body: archived } } });
  assert.equal(countLoadedFiles(app.state.databases), 3);
  await app.typeFilter('!arcade');
  // What FILTER leaves does not change what there is to count.
  assert.equal(countLoadedFiles(app.state.databases), 3);
  assert.equal(app.view.inspection.activeFilter.resultCounts.files, 2);
  app.close();

  // Alpha's and the archived database's cores/shared.rbf is one path when they are combined.
  const alpha = { ...database('alpha', { arcade: 0 }, { 'cores/shared.rbf': { size: 1, hash: 'x', tags: [0] }, 'a.rbf': { size: 1, hash: 'a', tags: [0] } }) };
  app = await openApp(`/#db=${ALPHA_URL}&db=${ARCHIVED_URL}`, { routes: { [ALPHA_URL]: { body: alpha }, [ARCHIVED_URL]: { body: archived } } });
  assert.equal(app.view.heading, '2 combined databases');
  assert.equal(countLoadedFiles(app.state.databases), 4);
  assert.equal(app.view.combined.resultCounts.files, 4);
});
