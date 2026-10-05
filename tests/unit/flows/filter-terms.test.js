import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { openApp } from '../support/app.js';
import { buildFilterTerms, toggleTerm } from '../../../src/lib/filterTerms.js';

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
