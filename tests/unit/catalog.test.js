import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mergeRuntimeDatabaseCatalogEntries,
  parseMultiDatabasesCatalog,
} from '../../src/lib/database.js';

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

function buildInspectUrl(databaseUrl) {
  return `https://theypsilon.github.io/DB-Inspector_MiSTer/?database-url=${encodeURIComponent(databaseUrl)}`;
}
