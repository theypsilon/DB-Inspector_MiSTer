import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mergeRuntimeDatabaseCatalogEntries,
  parseMultiDatabasesCatalog,
} from '../../src/lib/database.js';
import { mergeCatalogEntries } from '../../src/lib/utils.js';

const EXISTING_DATABASE_URL =
  'https://raw.githubusercontent.com/theypsilon/MultiDatabases_MiSTer/db/existing-db/db.json';
const NEW_DATABASE_URL =
  'https://raw.githubusercontent.com/theypsilon/MultiDatabases_MiSTer/db/new-db/db.json.zip';

test('MultiDatabases catalog entries come from README Inspect links', () => {
  const entries = parseMultiDatabasesCatalog(`
| Database | What it installs | Links |
| --- | --- | --- |
| [Existing title](existing-db/) | Existing database | [Inspect](${buildInspectUrl(EXISTING_DATABASE_URL)}) |
| [New title](new-db/) | New database | [Inspect](${buildInspectUrl(NEW_DATABASE_URL)}) |
| [Not inspectable](missing/) | Missing query parameter | [Inspect](https://example.com/) |
  `);

  assert.deepEqual(
    entries.map(({ key, ...entry }) => entry),
    [
      {
        dbId: 'MultiDatabases/existing-db',
        dbIdApproximate: true,
        dbUrl: EXISTING_DATABASE_URL,
        title: 'Existing title',
      },
      {
        dbId: 'MultiDatabases/new-db',
        dbIdApproximate: true,
        dbUrl: NEW_DATABASE_URL,
        title: 'New title',
      },
    ],
  );
  assert.ok(entries.every((entry) => entry.key.startsWith('multidatabases:')));
});

test('Update_All entries win URL collisions and only new MultiDatabases entries are appended', () => {
  const updateAllEntry = {
    key: 'UPDATE_ALL_EXISTING',
    dbId: 'authoritative/existing-db',
    dbUrl: EXISTING_DATABASE_URL,
    title: 'Authoritative title',
  };
  const multiDatabasesEntries = parseMultiDatabasesCatalog(`
| Database | What it installs | Links |
| --- | --- | --- |
| [README title](existing-db/) | Existing database | [Inspect](${buildInspectUrl(EXISTING_DATABASE_URL)}) |
| [New title](new-db/) | New database | [Inspect](${buildInspectUrl(NEW_DATABASE_URL)}) |
  `);

  const mergedEntries = mergeRuntimeDatabaseCatalogEntries(
    [updateAllEntry],
    multiDatabasesEntries,
  );

  assert.equal(mergedEntries.length, 2);
  assert.strictEqual(mergedEntries[0], updateAllEntry);
  assert.deepEqual(
    mergedEntries.map((entry) => ({
      dbId: entry.dbId,
      title: entry.title,
      approximate: Boolean(entry.dbIdApproximate),
    })),
    [
      {
        dbId: 'authoritative/existing-db',
        title: 'Authoritative title',
        approximate: false,
      },
      {
        dbId: 'MultiDatabases/new-db',
        title: 'New title',
        approximate: true,
      },
    ],
  );
});

test('a definitive session override keeps the runtime entry position', () => {
  const databaseUrl =
    'https://raw.githubusercontent.com/theypsilon/MultiDatabases_MiSTer/db/readme-only/db.json';
  const runtimeEntries = [
    {
      key: 'first',
      dbId: 'first',
      dbUrl: 'https://example.com/first.json',
      title: 'First',
    },
    {
      key: 'approximate',
      dbId: 'MultiDatabases/readme-only',
      dbIdApproximate: true,
      dbUrl: databaseUrl,
      title: 'README Exclusive',
    },
    {
      key: 'last',
      dbId: 'last',
      dbUrl: 'https://example.com/last.json',
      title: 'Last',
    },
  ];
  const definitiveEntry = {
    key: 'definitive',
    dbId: 'definitive/readme-only',
    dbIdApproximate: false,
    dbUrl: databaseUrl,
    title: 'Loaded title',
  };

  const mergedEntries = mergeCatalogEntries([definitiveEntry], runtimeEntries);

  assert.deepEqual(
    mergedEntries.map(({ key, dbId, title, dbIdApproximate }) => ({
      key,
      dbId,
      title,
      approximate: Boolean(dbIdApproximate),
    })),
    [
      { key: 'first', dbId: 'first', title: 'First', approximate: false },
      {
        key: 'definitive',
        dbId: 'definitive/readme-only',
        title: 'README Exclusive',
        approximate: false,
      },
      { key: 'last', dbId: 'last', title: 'Last', approximate: false },
    ],
  );
});

function buildInspectUrl(databaseUrl) {
  return `https://theypsilon.github.io/DB-Inspector_MiSTer/?database-url=${encodeURIComponent(databaseUrl)}`;
}
