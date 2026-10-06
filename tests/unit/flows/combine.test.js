import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { inflateRawSync } from 'node:zlib';

import { file, openApp } from '../support/app.js';

// Mirrors tests/combine.spec.js.

const ALPHA_URL = 'https://example.com/combine/alpha.json';
const BETA_URL = 'https://example.com/combine/beta.json';
const ALPHA_TWIN_URL = 'https://example.com/combine/alpha-twin.json';
const GAMMA_URL = 'https://example.com/combine/gamma.json';
const BETA_TWIN_URL = 'https://example.com/combine/beta-twin.json';

const ALPHA = database('alpha', {
  'cores/alpha.rbf': { size: 10, hash: 'a1', tags: [0] },
  'games/shared.rom': { size: 5, hash: 'same' },
});
const BETA = database(
  'beta',
  {
    'cores/beta.rbf': { size: 20, hash: 'b1', tags: [1] },
    'games/shared.rom': { size: 7, hash: 'other' },
  },
  { default_options: { filter: '!console' } },
);

const ROUTES = {
  [ALPHA_URL]: { body: ALPHA },
  [BETA_URL]: { body: BETA },
  [ALPHA_TWIN_URL]: { body: database('alpha', { 'twin.rbf': { size: 1 } }) },
  [GAMMA_URL]: { body: database('gamma', { 'gamma.rbf': { size: 1, tags: [0] } }) },
  [BETA_TWIN_URL]: { body: database('beta', { 'beta-twin.rbf': { size: 1 } }) },
};

let app;
afterEach(() => app?.close());

test('combining shows both databases, lists the paths they share as collisions, and keeps them in the URL', async () => {
  app = await openApp('/', { routes: ROUTES });
  await app.fetch(ALPHA_URL);
  assert.equal(app.view.heading, 'alpha');

  await app.fetch(BETA_URL);
  await app.combine();

  assert.equal(app.view.heading, '2 combined databases');
  assert.deepEqual(
    app.view.fileRows.filter(({ name }) => name === 'alpha.rbf'),
    [{ name: 'alpha.rbf', dbId: 'alpha' }],
  );
  // Beta's own default filter (!console) still applies to it.
  assert.ok(!app.view.files.includes('beta.rbf'));
  assert.ok(!app.view.files.includes('shared.rom'));

  assert.equal(app.view.collisions.filter((name) => name === 'shared.rom').length, 3);
  assert.deepEqual(app.view.collisionRows.filter(({ dbId }) => dbId).map(({ dbId }) => dbId), ['alpha', 'beta']);
  assert.ok(
    app.view.issues.some((message) => message.includes('1 path is claimed by more than one database: alpha, beta.')),
    app.view.issues.join('\n'),
  );
  assert.equal(app.hash, `#db=${ALPHA_URL}&db=${BETA_URL}`);

  // Collided paths can be found like any other row.
  assert.equal(app.find('shared.rom').length, 3);
});

test('the load prompt can be cancelled, asks which database stays when its db_id is loaded, and can load alone', async () => {
  app = await openApp('/', { routes: ROUTES });
  await app.fetch(ALPHA_URL);
  assert.equal(app.view.heading, 'alpha');

  await app.fetch(BETA_URL);
  await app.cancelLoad();
  assert.equal(app.prompt, null);
  assert.equal(app.view.heading, 'alpha');

  await app.fetch(BETA_URL);
  await app.combine();
  assert.equal(app.view.heading, '2 combined databases');
  const combinedUrl = app.url;

  // Only one database per db_id can be loaded: the user chooses which one stays.
  await app.fetch(ALPHA_TWIN_URL);
  await app.combine();
  assert.equal(app.prompt.kind, 'replaceLoaded');
  assert.deepEqual(
    app.prompt.conflicts.map(({ dbId, loaded, incoming }) => [dbId, loaded.inspection.source.sourceLabel, incoming.inspection.source.sourceLabel]),
    [['alpha', ALPHA_URL, ALPHA_TWIN_URL]],
  );
  await app.keepLoaded();
  assert.equal(app.prompt, null);
  assert.equal(app.view.heading, '2 combined databases');
  assert.ok(!app.view.files.includes('twin.rbf'));
  assert.equal(app.url, combinedUrl);

  // Escape keeps the loaded one too.
  await app.fetch(ALPHA_TWIN_URL);
  await app.combine();
  assert.equal(app.prompt.kind, 'replaceLoaded');
  await app.escape();
  assert.equal(app.prompt, null);
  assert.ok(!app.view.files.includes('twin.rbf'));
  assert.equal(app.url, combinedUrl);

  await app.fetch(ALPHA_TWIN_URL);
  await app.combine();
  await app.replaceIt();
  assert.deepEqual(app.view.cards, ['alpha', 'beta']);
  assert.ok(app.view.files.includes('twin.rbf'));
  assert.ok(!app.view.files.includes('alpha.rbf'));
  assert.equal(app.hash, `#db=${ALPHA_TWIN_URL}&db=${BETA_URL}`);

  await app.fetch(ALPHA_TWIN_URL);
  await app.loadAlone();
  assert.ok(app.view.files.includes('twin.rbf'));
  assert.equal(app.view.combined, null);
  assert.equal(app.hash, `#db=${ALPHA_TWIN_URL}`);
});

test('combined databases share a [mister] filter and can have their own, kept in the URL and in history', async () => {
  app = await openApp('/', { routes: ROUTES });
  await app.fetch(ALPHA_URL);
  assert.equal(app.view.heading, 'alpha');
  await app.fetch(BETA_URL);
  await app.combine();

  assert.deepEqual(app.view.appliedFilters, ['alphaEverythingno filter', 'beta!consoledatabase default']);

  // Beta's default does not include [mister], so the shared filter replaces it, as in Downloader.
  await app.typeSharedFilter('arcade');
  assert.deepEqual(app.view.appliedFilters, ['alphaarcadeshared filter', 'betaarcadeshared filter']);

  await app.giveOwnFilter('beta');
  await app.typeOwnFilter('beta', '[mister] console');
  assert.deepEqual(app.view.appliedFilters, ['alphaarcadeshared filter', 'betaarcade consoleits own filter']);
  assert.ok(app.view.files.includes('beta.rbf'));
  assert.equal(app.hash, `#db=${ALPHA_URL}&db=${BETA_URL}&filter=arcade&filter.beta=[mister]+console`);

  await app.reload();
  assert.equal(app.view.heading, '2 combined databases');
  assert.equal(app.sharedFilter, 'arcade');
  assert.equal(app.ownFilter('beta'), '[mister] console');

  await app.back();
  assert.equal(app.view.heading, 'alpha');
  assert.equal(app.view.combined, null);
  await app.forward();
  assert.equal(app.view.heading, '2 combined databases');
  assert.deepEqual(app.view.appliedFilters, ['alphaarcadeshared filter', 'betaarcade consoleits own filter']);

  // Clearing the shared filter and removing beta's own one gives each database its own default back.
  await app.clearSharedFilter();
  await app.removeOwnFilter('beta');
  assert.deepEqual(app.view.appliedFilters, ['alphaEverythingno filter', 'beta!consoledatabase default']);
  assert.equal(app.hash, `#db=${ALPHA_URL}&db=${BETA_URL}`);
});

test('uploads and database list entries can be combined too, and uploads stay out of the URL', async () => {
  app = await openApp('/', { routes: ROUTES });
  await app.fetch(ALPHA_URL);
  assert.equal(app.view.heading, 'alpha');

  await app.upload(file('beta.json', BETA));
  await app.combine();
  assert.equal(app.view.heading, '2 combined databases');

  await app.upload(
    file('downloader.ini', `[mister]\nfilter=arcade\n\n[gamma]\ndb_url=${GAMMA_URL}\n\n[other]\ndb_url=${BETA_URL}\n`),
  );
  // The list's picker opens first; combining is asked once its databases are chosen.
  const picker = app.openChoice();
  picker.toggleAll();
  picker.check('gamma');
  assert.equal(picker.openLabel, 'Open selected database');
  await picker.open();
  await app.combine();

  assert.equal(app.view.heading, '3 combined databases');
  // Gamma keeps the filter its list gives it ([mister] = arcade) as its own.
  assert.equal(app.view.appliedFilters[2], 'gammaarcadeits own filter');
  assert.equal(app.hash, `#db=${ALPHA_URL}&db=${GAMMA_URL}&filter.gamma=arcade`);
});

test('databases chosen together leave out those whose db_id is taken, and report what failed', async () => {
  const missingUrl = 'https://example.com/combine/missing.json';
  app = await openApp('/', {
    routes: { ...ROUTES, [missingUrl]: { status: 404, contentType: 'text/plain', body: 'missing' } },
  });

  // Opened alone: within the selection, the first database with a db_id wins.
  await app.upload(
    file('downloader.ini', `[twin]\ndb_url=${ALPHA_TWIN_URL}\n\n[gamma]\ndb_url=${GAMMA_URL}\n\n[alpha]\ndb_url=${ALPHA_URL}\n`),
  );
  await openAllSelected(3);
  assert.equal(app.view.heading, '2 combined databases');
  assert.deepEqual(app.view.cards, ['alpha', 'gamma']);
  assert.ok(app.view.files.includes('twin.rbf'));
  assert.ok(
    app.errorMessage.includes(`Another selected database has the db_id alpha, so ${ALPHA_URL} was not opened.`),
    app.errorMessage,
  );

  // Combined with the loaded ones: a database whose db_id is loaded replaces it only when the user
  // says so, and a selected database that is itself loaded (gamma) just stays.
  await app.upload(
    file('downloader.ini', `[beta]\ndb_url=${BETA_URL}\n\n[alpha]\ndb_url=${ALPHA_URL}\n\n[gamma]\ndb_url=${GAMMA_URL}\n`),
  );
  await openAllSelected(3);
  await app.combine();
  await app.keepLoaded();
  assert.equal(app.view.heading, '3 combined databases');
  assert.deepEqual(app.view.cards, ['alpha', 'gamma', 'beta']);
  assert.ok(app.view.files.includes('twin.rbf'));
  assert.equal(app.errorMessage, '');
  expectOneDatabasePerDbId();

  // Several databases with loaded db_ids: each one replaces the loaded one or stays out.
  const replacing = `[alpha]\ndb_url=${ALPHA_URL}\n\n[other]\ndb_url=${BETA_TWIN_URL}\n`;
  await app.upload(file('replacing.ini', replacing));
  await openAllSelected(2);
  await app.combine();
  assert.deepEqual(app.prompt.conflicts.map(({ dbId }) => dbId), ['alpha', 'beta']);
  await app.cancelReplace();
  assert.deepEqual(app.view.cards, ['alpha', 'gamma', 'beta']);
  assert.ok(app.view.files.includes('twin.rbf'));

  await app.upload(file('replacing.ini', replacing));
  await openAllSelected(2);
  await app.combine();
  // Every conflict starts checked; unchecking beta leaves alpha.
  await app.continueReplacing('alpha');
  assert.deepEqual(app.view.cards, ['alpha', 'gamma', 'beta']);
  assert.ok(app.view.files.includes('alpha.rbf'));
  assert.ok(!app.view.files.includes('twin.rbf'));
  assert.ok(!app.view.files.includes('beta-twin.rbf'));
  expectOneDatabasePerDbId();

  // When only one of them opens, it is shown alone.
  await app.upload(file('downloader.ini', `[missing]\ndb_url=${missingUrl}\n\n[gamma]\ndb_url=${GAMMA_URL}\n`));
  await openAllSelected(2);
  await app.loadAlone();
  assert.equal(app.view.heading, 'gamma');
  assert.equal(app.view.combined, null);
  assert.ok(app.errorMessage.includes(`${missingUrl}: Request failed with 404 Not Found.`), app.errorMessage);
  assert.equal(app.hash, `#db=${GAMMA_URL}`);
});

test('databases chosen to open alone keep the combined databases’ shared filter as FILTER, and a selection of every loaded database opens without asking', async () => {
  const missingUrl = 'https://example.com/combine/missing.json';
  app = await openApp('/', {
    routes: { ...ROUTES, [missingUrl]: { status: 404, contentType: 'text/plain', body: 'missing' } },
  });
  await app.fetch(ALPHA_URL);
  await app.fetch(BETA_URL);
  await app.combine();
  await app.typeSharedFilter('arcade');

  await app.upload(file('downloader.ini', `[missing]\ndb_url=${missingUrl}\n\n[gamma]\ndb_url=${GAMMA_URL}\n`));
  await openAllSelected(2);
  await app.loadAlone();
  assert.equal(app.view.heading, 'gamma');
  assert.ok(app.errorMessage.includes(`${missingUrl}: Request failed with 404 Not Found.`), app.errorMessage);
  assert.equal(app.filter, 'arcade');
  await app.pause();
  assert.equal(app.hash, `#db=${GAMMA_URL}&filter=arcade`);

  // Gamma is loaded and selected, so the selection opens afresh, and the first database with a
  // db_id wins within it.
  await app.upload(
    file('downloader.ini', `[twin]\ndb_url=${ALPHA_TWIN_URL}\n\n[gamma]\ndb_url=${GAMMA_URL}\n\n[alpha]\ndb_url=${ALPHA_URL}\n`),
  );
  await openAllSelected(3);
  assert.equal(app.prompt, null);
  assert.equal(app.view.heading, '2 combined databases');
  assert.deepEqual(app.view.cards, ['alpha', 'gamma']);
  assert.ok(
    app.errorMessage.includes(`Another selected database has the db_id alpha, so ${ALPHA_URL} was not opened.`),
    app.errorMessage,
  );
});

test('fetching the only loaded database again asks just whether to reload it', async () => {
  const routes = { ...ROUTES };
  app = await openApp('/', { routes });
  await app.fetch(ALPHA_URL);
  await app.typeFilter('arcade');
  const loadedUrl = app.url;
  const historyLength = app.historyLength;
  // Alpha publishes a new version.
  routes[ALPHA_URL] = { body: database('alpha', { 'cores/alpha-v2.rbf': { size: 11, hash: 'a2', tags: [0] } }) };

  // A database cannot be combined with itself, so nothing asks whether to combine.
  await app.fetch(ALPHA_URL);
  assert.equal(app.prompt.kind, 'replaceLoaded');
  assert.deepEqual(app.prompt.conflicts.map(({ dbId, reload }) => [dbId, reload]), [['alpha', true]]);
  // The new version is asked for, not the browser's cached copy.
  assert.deepEqual(app.browser.requests.at(-1), { url: ALPHA_URL, init: { redirect: 'follow', cache: 'no-cache' } });

  await app.keepLoaded();
  assert.equal(app.prompt, null);
  assert.ok(app.view.files.includes('alpha.rbf'));
  assert.ok(!app.view.files.includes('alpha-v2.rbf'));

  await app.fetch(ALPHA_URL);
  await app.reloadIt();
  assert.equal(app.prompt, null);
  assert.equal(app.view.heading, 'alpha');
  assert.equal(app.view.combined, null);
  assert.ok(app.view.files.includes('alpha-v2.rbf'));
  assert.ok(!app.view.files.includes('alpha.rbf'));
  // Reloading keeps FILTER and the address as they were.
  assert.equal(app.filter, 'arcade');
  assert.equal(app.url, loadedUrl);
  assert.equal(app.historyLength, historyLength);
});

test('fetching one of several loaded databases again asks whether to combine, then whether to reload it', async () => {
  const routes = { ...ROUTES };
  app = await openApp('/', { routes });
  await app.fetch(ALPHA_URL);
  await app.fetch(BETA_URL);
  await app.combine();
  await app.giveOwnFilter('alpha');
  await app.typeOwnFilter('alpha', 'console');
  const combinedUrl = app.url;
  routes[ALPHA_URL] = { body: database('alpha', { 'cores/alpha-v2.rbf': { size: 11, hash: 'a2', tags: [1] } }) };

  await app.fetch(ALPHA_URL);
  assert.equal(app.browser.requests.at(-1).init.cache, 'no-cache');
  await app.combine();
  assert.deepEqual(app.prompt.conflicts.map(({ dbId, reload }) => [dbId, reload]), [['alpha', true]]);
  await app.reloadIt();

  // The reloaded database keeps its place and its own filter.
  assert.deepEqual(app.view.cards, ['alpha', 'beta']);
  assert.ok(app.view.files.includes('alpha-v2.rbf'));
  assert.equal(app.ownFilter('alpha'), 'console');
  assert.equal(app.url, combinedUrl);

  // Loading it alone still replaces every loaded database.
  await app.fetch(ALPHA_URL);
  await app.loadAlone();
  assert.equal(app.view.heading, 'alpha');
  assert.equal(app.hash, `#db=${ALPHA_URL}`);
});

test('a long session is packed into its link, and opens again from it', async () => {
  const urls = Array.from({ length: 40 }, (_, index) => `https://example.com/combine/many/database_${index}.json`);
  const routes = {
    ...ROUTES,
    ...Object.fromEntries(urls.map((url, index) => [url, { body: database(`many_${index}`, { [`many_${index}.rbf`]: { size: 1, tags: [index % 2] } }) }])),
  };
  app = await openApp('/', { routes });
  await app.upload(file('many.ini', urls.map((url, index) => `[many_${index}]\ndb_url=${url}\n`).join('\n')));
  await openAllSelected(40);
  await app.typeSharedFilter('arcade');
  await app.giveOwnFilter('many_3');
  await app.typeOwnFilter('many_3', '[mister] console');

  assert.equal(app.view.heading, '40 combined databases');
  assert.match(app.hash, /^#z=[A-Za-z0-9_-]+$/);
  // Packed as the link format says: the readable keys, raw deflate, in base64url.
  const packed = new URLSearchParams(app.hash.slice(1)).get('z');
  assert.equal(
    inflateRawSync(Buffer.from(packed, 'base64url')).toString('utf8'),
    `${urls.map((url) => `db=${url}`).join('&')}&filter=arcade&filter.many_3=[mister]+console`,
  );
  assert.ok(app.url.length <= 2000, `${app.url.length}`);

  await app.reload();
  assert.equal(app.view.heading, '40 combined databases');
  assert.deepEqual(app.view.cards, urls.map((_, index) => `many_${index}`));
  assert.equal(app.sharedFilter, 'arcade');
  assert.equal(app.ownFilter('many_3'), '[mister] console');
  assert.ok(app.view.files.includes('many_3.rbf'));
  assert.ok(!app.view.files.includes('many_5.rbf'));
});

test('when only one of combined databases can be shared, its link keeps the filter it had', async () => {
  const inheritsUrl = 'https://example.com/combine/inherits.json';
  const inherits = database(
    'inherits',
    { 'inherits-arcade.rbf': { size: 1, tags: [0] }, 'inherits-console.rbf': { size: 1, tags: [1] } },
    { default_options: { filter: '[mister] !console' } },
  );
  app = await openApp('/', { routes: { ...ROUTES, [inheritsUrl]: { body: inherits } } });
  await app.fetch(inheritsUrl);
  await app.upload(file('beta.json', BETA));
  await app.combine();
  await app.typeSharedFilter('arcade console');
  assert.equal(app.view.appliedFilters[0], 'inheritsarcade console !consoledatabase default');

  // Shown alone with the shared filter as FILTER, it would lose its default's terms.
  assert.equal(app.hash, `#db=${inheritsUrl}&filter=arcade+console&filter.inherits=arcade+console+!console`);

  await app.reload();
  assert.equal(app.view.heading, 'inherits');
  assert.equal(app.filter, 'arcade console !console');
  assert.ok(app.view.files.includes('inherits-arcade.rbf'));
  assert.ok(!app.view.files.includes('inherits-console.rbf'));
  await app.pause();
  assert.equal(app.hash, `#db=${inheritsUrl}&filter=arcade+console+!console`);
});

// A list's picker starts with one database per db_id selected.
async function openAllSelected(count) {
  const picker = app.openChoice();
  assert.equal(picker.openLabel, `Open ${count} selected databases`);
  await picker.open();
}

// No two loaded databases ever share a db_id.
function expectOneDatabasePerDbId() {
  const dbIds = app.view.cards;
  assert.equal(new Set(dbIds).size, dbIds.length);
}

function database(dbId, files, extra = {}) {
  return {
    db_id: dbId,
    v: 1,
    timestamp: 1710000000,
    base_files_url: `https://example.com/${dbId}/`,
    tag_dictionary: { arcade: 0, console: 1 },
    files,
    folders: {},
    ...extra,
  };
}
