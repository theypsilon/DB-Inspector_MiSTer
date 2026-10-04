import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { openApp } from '../support/app.js';

// Mirrors tests/catalog-session-merge.spec.js.

const RUNTIME_CATALOG_URL =
  'https://raw.githubusercontent.com/theypsilon/Update_All_MiSTer/master/src/update_all/databases.py';
const MULTIDATABASES_CATALOG_URL =
  'https://raw.githubusercontent.com/theypsilon/MultiDatabases_MiSTer/main/README.md';
const PRIMARY_DATABASE_URL = 'https://example.com/primary.json';
const MULTIDATABASES_ONLY_URL =
  'https://raw.githubusercontent.com/theypsilon/MultiDatabases_MiSTer/db/readme-only/db.json';

const RUNTIME_CATALOG_SOURCE = `
PRIMARY_URL = "${PRIMARY_DATABASE_URL}"
ALTERNATE_URL = "https://example.com/alias-alternate.json"
OTHER_URL = "https://example.com/other.json"
self.primary = Database(db_id='distribution_mister', db_url=PRIMARY_URL, title='Primary Distribution')
self.alternate = Database(db_id='distribution_mister', db_url=ALTERNATE_URL, title='Alternate Distribution')
self.other = Database(db_id='other_db', db_url=OTHER_URL, title='Other Database')
`;

const MULTIDATABASES_CATALOG_SOURCE = `
| Database | What it installs | Links |
| --- | --- | --- |
| [Lower-authority duplicate](duplicate/) | Duplicate | [Inspect](${buildInspectUrl(PRIMARY_DATABASE_URL)}) |
| [README Exclusive](readme-only/) | Additional database | [Inspect](${buildInspectUrl(MULTIDATABASES_ONLY_URL)}) |
`;

function routes(url) {
  if (url === RUNTIME_CATALOG_URL) {
    return { body: RUNTIME_CATALOG_SOURCE, contentType: 'text/plain; charset=utf-8' };
  }
  if (url === MULTIDATABASES_CATALOG_URL) {
    return { body: MULTIDATABASES_CATALOG_SOURCE, contentType: 'text/markdown; charset=utf-8' };
  }
  if (url === MULTIDATABASES_ONLY_URL) {
    return { body: buildDatabase('definitive/readme-only') };
  }
  if (url.startsWith('https://example.com/')) {
    const { pathname } = new URL(url);
    const dbId = pathname === '/other.json' ? 'other_db' : 'distribution_mister';
    const defaultFilter =
      pathname === '/primary.json' ? 'catalog-default' : pathname === '/alias-alternate.json' ? 'alternate-default' : '';
    return { body: buildDatabase(dbId, { defaultFilter }) };
  }
  return null;
}

let app;
afterEach(() => app?.close());

// The catalog entries whose text contains `text`, as the catalog lists them.
function optionsWith(picker, text) {
  return picker.names.filter((name) => name.includes(text));
}

test('loading a new shared-db_id URL keeps sibling catalog entries available', async () => {
  app = await openApp('/', { routes });

  assert.equal(app.catalog.status, 'ready');
  assert.equal(app.catalog.options.length, 4);

  await app.fetch('https://example.com/custom.json');

  assert.equal(app.view.heading, 'distribution_mister');
  assert.equal(app.catalog.options.length, 5);

  const picker = app.openCatalog();

  assert.equal(picker.search('').length, 5);
  assert.equal(optionsWith(picker, 'Primary Distribution').length, 1);
  assert.equal(optionsWith(picker, 'Alternate Distribution').length, 1);
  assert.equal(optionsWith(picker, 'example.com / custom.json').length, 1);
});

test('adds README-only catalog entries with approximate IDs while Update_All wins duplicates', async () => {
  app = await openApp('/', { routes });

  assert.equal(app.catalog.options.length, 4);
  let picker = app.openCatalog();

  assert.equal(optionsWith(picker, 'Primary Distribution').length, 1);
  assert.equal(optionsWith(picker, 'Lower-authority duplicate').length, 0);

  const additional = picker.entries.filter((entry) => entry.title === 'README Exclusive');
  assert.equal(additional.length, 1);
  assert.equal(picker.entries[3].title, 'README Exclusive');
  assert.equal(additional[0].dbId, 'MultiDatabases/readme-only');
  // Shown as an approximate ID, which the real one replaces once the database is opened.
  assert.equal(additional[0].dbIdApproximate, true);

  picker.click('README Exclusive (MultiDatabases/readme-only)');
  assert.deepEqual(picker.selected, ['README Exclusive (MultiDatabases/readme-only)']);
  assert.equal(picker.openLabel, 'Open selected database');

  await picker.open();
  assert.equal(app.view.heading, 'definitive/readme-only');

  picker = app.openCatalog();
  const updated = picker.entries.filter((entry) => entry.title === 'README Exclusive');
  assert.equal(updated.length, 1);
  assert.equal(updated[0].dbId, 'definitive/readme-only');
  assert.ok(!updated[0].dbIdApproximate);
  assert.equal(picker.entries[3].title, 'README Exclusive');
  assert.deepEqual(picker.loaded, ['README Exclusive (definitive/readme-only)']);
});

test('loading a URL registered in the catalog uses the existing entry without adding a duplicate', async () => {
  app = await openApp('/', { routes });

  assert.equal(app.catalog.options.length, 4);

  await app.fetch('https://example.com/alias-alternate.json');

  assert.equal(app.view.heading, 'distribution_mister');
  assert.equal(app.catalog.options.length, 4);

  const picker = app.openCatalog();

  assert.equal(picker.search('').length, 4);
  // The loaded database is recognized as its existing catalog entry.
  assert.deepEqual(picker.loaded, ['Alternate Distribution (distribution_mister)']);
  assert.equal(optionsWith(picker, 'Primary Distribution').length, 1);
  assert.equal(optionsWith(picker, 'Alternate Distribution').length, 1);
});

test('catalog selections keep the active filter until the user clears it', async () => {
  app = await openApp('/', { routes });

  await app.fetch('https://example.com/other.json');

  await app.typeFilter('manual !keep', { pause: false });
  assert.equal(app.filter, 'manual !keep');

  const picker = app.openCatalog();
  picker.click('Primary Distribution (distribution_mister)');
  await picker.open();
  await app.loadAlone();

  assert.equal(app.view.heading, 'distribution_mister');
  assert.equal(app.filter, 'manual !keep');
  await app.pause();
  assert.equal(app.hash, `#db=${PRIMARY_DATABASE_URL}&filter=manual+!keep`);
});

test('a catalog database can be combined with the loaded one', async () => {
  app = await openApp('/', { routes });
  await app.fetch('https://example.com/other.json');
  assert.equal(app.view.heading, 'other_db');

  const picker = app.openCatalog();
  picker.click('Primary Distribution (distribution_mister)');
  await picker.open();
  await app.combine();

  assert.equal(app.view.heading, '2 combined databases');
  assert.deepEqual(app.view.cards, ['other_db', 'distribution_mister']);
});

function buildDatabase(dbId, { defaultFilter = '' } = {}) {
  return {
    db_id: dbId,
    v: 1,
    timestamp: 1710000000,
    default_options: defaultFilter
      ? {
          filter: defaultFilter,
        }
      : undefined,
    files: {},
    folders: {},
    archives: {},
  };
}

function buildInspectUrl(databaseUrl) {
  return `https://theypsilon.github.io/DB-Inspector_MiSTer/?database-url=${encodeURIComponent(databaseUrl)}`;
}
