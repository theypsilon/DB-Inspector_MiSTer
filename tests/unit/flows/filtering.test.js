import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { file, openApp } from '../support/app.js';

// Mirrors tests/filtering.spec.js.

let app;
afterEach(() => app?.close());

test('FILTER applies downloader-style terms across files and archive summaries, ignores inherited terms with a warning, and hides emptied sections', async () => {
  app = await openApp('/');
  await app.upload(file('filter-smoke.json', buildFilterDatabase()));
  assert.equal(app.view.heading, 'filter_smoke');

  await app.typeFilter('a !b');

  assert.equal(app.view.summary, 'Showing 5 files, 5 folders, and 1 archives for this filter.');
  assertShown(app.view.files, ['file_a.rbf', 'plain.rbf', 'essential.rbf'], ['file_b.rbf']);
  assertShown(app.view.archives, ['a.cht', 'plain.cht'], ['b.cht']);

  await app.typeFilter('[mister] b');

  // The warning shows once this filter applies; its summary reads the same as the previous one.
  assert.ok(
    app.view.issues.includes('Inherited filter terms [mister] are not supported in this inspector and were ignored.'),
    app.view.issues.join('\n'),
  );
  assert.equal(app.view.summary, 'Showing 5 files, 5 folders, and 1 archives for this filter.');
  assertShown(app.view.files, ['file_b.rbf', 'plain.rbf', 'essential.rbf'], ['file_a.rbf']);

  await app.typeFilter('!all');

  // The summary shows the filter applied, so the missing heading is not just an empty page.
  assert.equal(app.view.summary, 'Showing 1 files, 1 folders, and 0 archives for this filter.');
  // No archive is left, so the Archives section is gone.
  assert.equal(app.view.archivesIndex, null);
});

test('FILTER syncs with the URL for shared remote databases', async () => {
  const remoteUrl = 'https://example.com/filter-shared.json';
  app = await openApp(`/#db=${remoteUrl}&filter=a+!b`, {
    routes: { [remoteUrl]: { body: buildFilterDatabase() } },
  });

  assert.equal(app.view.heading, 'filter_smoke');
  assert.equal(app.filter, 'a !b');
  assert.equal(app.view.summary, 'Showing 5 files, 5 folders, and 1 archives for this filter.');

  await app.typeFilter('b');
  assert.equal(app.view.summary, 'Showing 5 files, 5 folders, and 1 archives for this filter.');
  assert.equal(app.hash, `#db=${remoteUrl}&filter=b`);
});

test('missing FILTER param uses the database default, clear returns to that default, and explicit empty FILTER still overrides it', async () => {
  const remoteUrl = 'https://example.com/filter-default.json';
  app = await openApp(`/#db=${remoteUrl}`, {
    routes: { [remoteUrl]: { body: buildFilterDatabase({ defaultFilter: 'a' }) } },
  });

  assert.equal(app.view.heading, 'filter_smoke');
  assert.equal(app.filter, 'a');
  await app.pause();
  assert.equal(app.hash, `#db=${remoteUrl}`);

  await app.typeFilter('b', { pause: false });
  assert.equal(app.canResetFilter, true);
  await app.clearFilter();
  assert.equal(app.filter, 'a');
  assert.equal(app.hash, `#db=${remoteUrl}`);

  await app.typeFilter('');
  assert.equal(app.filter, '');
  assert.equal(app.view.summary, 'Showing the full database: 7 files, 7 folders, 1 archives.');
  assert.equal(app.hash, `#db=${remoteUrl}&filter=`);
});

test('manual FILTER survives uploads and direct URL fetches of other databases', async () => {
  const remoteUrl = 'https://example.com/filter-preserve-remote.json';
  app = await openApp('/', {
    routes: {
      [remoteUrl]: { body: buildFilterDatabase({ dbId: 'remote_filter_smoke', defaultFilter: 'catalog-default' }) },
    },
  });

  await app.upload(file('filter-smoke.json', buildFilterDatabase()));
  await app.typeFilter('manual !keep', { pause: false });
  assert.equal(app.filter, 'manual !keep');

  await app.upload(
    file('next-filter-smoke.json', buildFilterDatabase({ dbId: 'next_filter_smoke', defaultFilter: 'upload-default' })),
  );
  await app.loadAlone();
  assert.equal(app.view.heading, 'next_filter_smoke');
  assert.equal(app.filter, 'manual !keep');

  await app.fetch(remoteUrl);
  await app.loadAlone();

  assert.equal(app.view.heading, 'remote_filter_smoke');
  assert.equal(app.filter, 'manual !keep');
  await app.pause();
  assert.equal(app.hash, `#db=${remoteUrl}&filter=manual+!keep`);
});

test('single-entry INI lists apply their resolved section filter to FILTER', async () => {
  const iniRemoteUrl = 'https://example.com/filter-preserve-ini.json';
  app = await openApp('/', {
    routes: { [iniRemoteUrl]: { body: buildFilterDatabase({ defaultFilter: 'ini-default' }) } },
  });

  await app.upload(file('filter-smoke.json', buildFilterDatabase()));
  await app.typeFilter('manual !keep', { pause: false });
  assert.equal(app.filter, 'manual !keep');

  await app.upload(
    file(
      'downloader.ini',
      `[MiSTer]
filter=ini-list-default

[Preserved]
db_url=${iniRemoteUrl}
filter=arcade [mister]
`,
    ),
  );

  await app.loadAlone();
  assert.equal(app.prompt.kind, 'filterOverride');
  assert.equal(app.prompt.currentFilter, 'manual !keep');
  assert.equal(app.prompt.nextFilter, 'arcade ini-list-default');
  await app.answer('filterOverride', true);

  assert.equal(app.view.heading, 'filter_smoke');
  assert.equal(app.filter, 'arcade ini-list-default');
});

test('INI filter override confirmation can keep the current FILTER instead', async () => {
  const iniRemoteUrl = 'https://example.com/filter-preserve-ini-keep.json';
  app = await openApp('/', {
    routes: { [iniRemoteUrl]: { body: buildFilterDatabase({ defaultFilter: 'ini-default' }) } },
  });

  await app.upload(file('filter-smoke.json', buildFilterDatabase()));
  await app.typeFilter('manual !keep', { pause: false });

  await app.upload(
    file(
      'downloader.ini',
      `[MiSTer]
filter=ini-list-default

[Preserved]
db_url=${iniRemoteUrl}
filter=arcade [mister]
`,
    ),
  );

  await app.loadAlone();
  assert.equal(app.prompt.kind, 'filterOverride');
  await app.answer('filterOverride', false);

  assert.equal(app.view.heading, 'filter_smoke');
  assert.equal(app.filter, 'manual !keep');
});

test('fresh INI list loads do not prompt for a filter override when FILTER is empty', async () => {
  const firstRemoteUrl = 'https://example.com/filter-fresh-ini-first.json';
  const secondRemoteUrl = 'https://example.com/filter-fresh-ini-second.json';
  app = await openApp('/', {
    routes: {
      [firstRemoteUrl]: { body: buildFilterDatabase({ defaultFilter: 'arcade [mister]' }) },
      [secondRemoteUrl]: { body: buildFilterDatabase({ defaultFilter: 'console' }) },
    },
  });

  await app.upload(
    file(
      'downloader.ini',
      `[MiSTer]
filter=!cheats

[First]
db_url=${firstRemoteUrl}
filter=arcade [mister]

[Second]
db_url=${secondRemoteUrl}
`,
    ),
  );

  // The list's picker starts with every database selected; open just the first one.
  const picker = app.openChoice();
  assert.equal(picker.toggleAllLabel, 'Select none');
  picker.toggleAll();
  picker.check('First');
  assert.equal(picker.openLabel, 'Open selected database');
  await picker.open();

  assert.equal(app.prompt, null);
  assert.equal(app.view.heading, 'filter_smoke');
  assert.equal(app.filter, 'arcade !cheats');
});

test('database default FILTER takes precedence over [mister] when the INI entry has no filter', async () => {
  const iniRemoteUrl = 'https://example.com/filter-db-precedence.json';
  app = await openApp('/', {
    routes: { [iniRemoteUrl]: { body: buildFilterDatabase({ defaultFilter: 'arcade [mister]' }) } },
  });

  await app.upload(
    file(
      'downloader.ini',
      `[MiSTer]
filter=console !cheats

[Preserved]
db_url=${iniRemoteUrl}
`,
    ),
  );

  assert.equal(app.view.heading, 'filter_smoke');
  assert.equal(app.filter, 'arcade console !cheats');
});

function assertShown(names, shown, hidden) {
  for (const name of shown) {
    assert.ok(names.includes(name), `${name} should be shown: ${names.join(', ')}`);
  }
  for (const name of hidden) {
    assert.ok(!names.includes(name), `${name} should be hidden: ${names.join(', ')}`);
  }
}

function buildFilterDatabase({ dbId = 'filter_smoke', defaultFilter = '' } = {}) {
  return {
    db_id: dbId,
    v: 1,
    timestamp: 1710000000,
    default_options: defaultFilter
      ? {
          filter: defaultFilter,
        }
      : undefined,
    files: {
      'games/A/file_a.rbf': { tags: ['a'] },
      'games/B/file_b.rbf': { tags: ['b'] },
      'games/plain/plain.rbf': {},
      'games/essential/essential.rbf': { tags: ['essential'] },
    },
    folders: {
      'games/A': { tags: ['a'] },
      'games/B': { tags: ['b'] },
      'games/plain': {},
      'games/essential': { tags: ['essential'] },
    },
    archives: {
      filter_archive: {
        description: 'Filter archive',
        format: 'zip',
        extract: 'selective',
        target_folder: 'games/archives/',
        archive_file: {
          url: 'https://example.com/filter-archive.zip',
        },
        summary_inline: {
          files: {
            'games/archives/a.cht': { arc_id: 'filter_archive', arc_at: 'a.cht', tags: ['a'] },
            'games/archives/b.cht': { arc_id: 'filter_archive', arc_at: 'b.cht', tags: ['b'] },
            'games/archives/plain.cht': { arc_id: 'filter_archive', arc_at: 'plain.cht' },
          },
          folders: {
            'games/archives/a': { tags: ['a'] },
            'games/archives/b': { tags: ['b'] },
            'games/archives/plain': {},
          },
        },
      },
    },
  };
}
