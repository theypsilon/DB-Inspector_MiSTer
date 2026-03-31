import assert from 'node:assert/strict';
import test from 'node:test';

import { loadDatabaseSourceFile } from '../../src/lib/database.js';

test('INI uploads keep [mister] ignored as an entry but apply its filter as the source default', async () => {
  const file = new File(
    [
      `
[MiSTer]
filter=console !cheats

[main]
db_url=https://example.com/main.json
`.trim(),
    ],
    'downloader.ini',
    { type: 'text/plain' },
  );

  const loadedSource = await loadDatabaseSourceFile(file);

  assert.equal(loadedSource.kind, 'ini');
  assert.equal(loadedSource.defaultFilter, 'console !cheats');
  assert.equal(loadedSource.defaultFilterPresent, true);
  assert.deepEqual(
    loadedSource.entries.map((entry) => ({
      dbId: entry.dbId,
      dbUrl: entry.dbUrl,
      defaultFilter: entry.defaultFilter,
      defaultFilterPresent: entry.defaultFilterPresent,
    })),
    [
      {
        dbId: 'main',
        dbUrl: 'https://example.com/main.json',
        defaultFilter: 'console !cheats',
        defaultFilterPresent: true,
      },
    ],
  );
});

test('INI entry filters override or inherit the [mister] filter regardless of section order', async () => {
  const file = new File(
    [
      `
[inherits]
db_url=https://example.com/inherits.json
filter=arcade [mister] !docs

[empty-parent]
db_url=https://example.com/empty-parent.json
filter=[mister]

[own]
db_url=https://example.com/own.json
filter=portable

[MiSTer]
filter=console !cheats
`.trim(),
    ],
    'downloader.ini',
    { type: 'text/plain' },
  );

  const loadedSource = await loadDatabaseSourceFile(file);

  assert.equal(loadedSource.kind, 'ini');
  assert.equal(loadedSource.defaultFilter, 'console !cheats');
  assert.equal(loadedSource.defaultFilterPresent, true);
  assert.deepEqual(
    loadedSource.entries.map((entry) => ({
      dbId: entry.dbId,
      defaultFilter: entry.defaultFilter,
      defaultFilterPresent: entry.defaultFilterPresent,
    })),
    [
      {
        dbId: 'inherits',
        defaultFilter: 'arcade console !cheats !docs',
        defaultFilterPresent: true,
      },
      {
        dbId: 'empty-parent',
        defaultFilter: 'console !cheats',
        defaultFilterPresent: true,
      },
      {
        dbId: 'own',
        defaultFilter: 'portable',
        defaultFilterPresent: true,
      },
    ],
  );
});

test('INI entry filters replace missing [mister] inheritance with an empty filter', async () => {
  const file = new File(
    [
      `
[inherits-empty]
db_url=https://example.com/inherits-empty.json
filter=[mister]
`.trim(),
    ],
    'downloader.ini',
    { type: 'text/plain' },
  );

  const loadedSource = await loadDatabaseSourceFile(file);

  assert.equal(loadedSource.kind, 'ini');
  assert.equal(loadedSource.defaultFilterPresent, false);
  assert.deepEqual(
    loadedSource.entries.map((entry) => ({
      dbId: entry.dbId,
      defaultFilter: entry.defaultFilter,
      defaultFilterPresent: entry.defaultFilterPresent,
    })),
    [
      {
        dbId: 'inherits-empty',
        defaultFilter: '',
        defaultFilterPresent: true,
      },
    ],
  );
});
