import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NO_COMBINED_FILTERS,
  addDatabasesToSession,
  addIncomingDatabaseFilters,
  buildCombinedUrlState,
  downloaderFilterInputs,
  findLoadedDbIdConflicts,
  listAppliedFilters,
  startCombinedFilters,
  startSession,
} from '../../src/lib/combinedFilters.js';
import { NO_FILTER_DEFAULTS, resolveDownloaderFilter } from '../../src/lib/filterDefaults.js';

function inspection(dbId, defaultFilter = '', sourceKind = 'url', sourceLabel = `https://example.com/${dbId}.json`) {
  return {
    overview: { dbId, defaultFilter },
    source: { sourceKind, sourceLabel },
  };
}

const fromList = (mister, section) => ({
  ...NO_FILTER_DEFAULTS,
  misterDefaultFilter: mister ?? '',
  misterDefaultFilterPresent: mister !== undefined,
  sourceDefaultFilter: section ?? mister ?? '',
  sourceDefaultFilterPresent: section !== undefined || mister !== undefined,
  sourceDefaultFilterOverridesDatabaseDefault: section !== undefined,
});

test('the first database keeps a customized FILTER as its own filter when a second one joins', () => {
  const first = { inspection: inspection('distribution_mister', '!unstable'), filterDefaults: NO_FILTER_DEFAULTS };

  assert.deepEqual(startCombinedFilters(first, '!unstable'), { shared: NO_COMBINED_FILTERS.shared, overrides: {} });
  assert.deepEqual(startCombinedFilters(first, 'arcade'), {
    shared: NO_COMBINED_FILTERS.shared,
    overrides: { distribution_mister: 'arcade' },
  });
});

test('the shared filter starts as the [mister] filter of the first database list', () => {
  const first = { inspection: inspection('jtcores', '[mister] !jtbeta'), filterDefaults: fromList('console') };

  // jtcores' default inherits [mister], so with [mister] = console its FILTER was `console !jtbeta`.
  assert.deepEqual(startCombinedFilters(first, 'console !jtbeta'), {
    shared: { isSet: true, value: 'console' },
    overrides: {},
  });
});

test('a database joining from a list keeps the filter its list gives it, only when it would differ', () => {
  const shared = { shared: { isSet: true, value: 'arcade' }, overrides: {} };

  assert.deepEqual(addIncomingDatabaseFilters(shared, inspection('plain'), NO_FILTER_DEFAULTS), shared);
  assert.deepEqual(addIncomingDatabaseFilters(shared, inspection('same'), fromList('arcade')), shared);
  assert.deepEqual(addIncomingDatabaseFilters(shared, inspection('other'), fromList('console')), {
    ...shared,
    overrides: { other: 'console' },
  });
  assert.deepEqual(addIncomingDatabaseFilters(shared, inspection('entry'), fromList('arcade', 'snes')), {
    ...shared,
    overrides: { entry: 'snes' },
  });
});

test('only databases loaded from a URL go in the address bar', () => {
  const filters = { shared: { isSet: true, value: 'arcade' }, overrides: { b: '' } };
  const state = buildCombinedUrlState(
    [{ inspection: inspection('a') }, { inspection: inspection('b', '', 'upload') }],
    filters,
  );

  assert.deepEqual(state, {
    databases: [
      { dbId: 'a', url: 'https://example.com/a.json' },
      { dbId: 'b', url: null },
    ],
    sharedFilter: filters.shared,
    overrides: filters.overrides,
  });
});

test('a new session keeps one database per db_id, with their section filters as written', () => {
  const plain = { inspection: inspection('plain'), filterDefaults: NO_FILTER_DEFAULTS };
  const entry = { inspection: inspection('entry'), filterDefaults: fromList('arcade', 'arcade snes') };
  const inherits = { inspection: inspection('inherits', '[mister] !cheats'), filterDefaults: fromList('arcade') };
  const twin = { inspection: inspection('entry'), filterDefaults: fromList('arcade', 'console') };

  const session = startSession(
    [plain, { ...entry, ownFilter: '[mister] snes' }, { ...inherits, ownFilter: null }, { ...twin, ownFilter: 'console' }],
    { isSet: true, value: 'arcade' },
  );

  assert.deepEqual(session.databases, [plain, entry, inherits]);
  assert.deepEqual(session.rejected, [twin]);
  assert.deepEqual(session.filters, {
    shared: { isSet: true, value: 'arcade' },
    overrides: { entry: '[mister] snes' },
  });
  // Each database gets what Downloader would give it with that downloader.ini.
  const applied = session.databases.map(({ inspection: database }) =>
    resolveDownloaderFilter(downloaderFilterInputs(session.filters, database)),
  );
  assert.deepEqual(applied, ['arcade', 'arcade snes', 'arcade !cheats']);
});

test('databases join the loaded ones, except those whose db_id is already loaded', () => {
  const first = { inspection: inspection('first'), filterDefaults: NO_FILTER_DEFAULTS };
  const second = { inspection: inspection('second'), filterDefaults: NO_FILTER_DEFAULTS };
  const twin = { inspection: inspection('first'), filterDefaults: NO_FILTER_DEFAULTS };

  const session = addDatabasesToSession({ databases: [first], filters: NO_COMBINED_FILTERS }, [second, twin], 'custom');

  assert.deepEqual(session.databases.map(({ inspection: { overview } }) => overview.dbId), ['first', 'second']);
  assert.deepEqual(session.rejected, [twin]);
  assert.deepEqual(session.filters.overrides, { first: 'custom' });
});

test('a database whose db_id is loaded replaces the loaded one in place, only when chosen', () => {
  const first = { inspection: inspection('first'), filterDefaults: NO_FILTER_DEFAULTS };
  const second = { inspection: inspection('second'), filterDefaults: NO_FILTER_DEFAULTS };
  const twin = { inspection: inspection('first'), filterDefaults: fromList('arcade') };
  const another = { inspection: inspection('first'), filterDefaults: NO_FILTER_DEFAULTS };
  const session = { databases: [first, second], filters: { shared: { isSet: true, value: 'console' }, overrides: {} } };

  // The twin comes from the loaded one's URL, so replacing it would reload it.
  assert.deepEqual(findLoadedDbIdConflicts(session.databases, [twin, another]), [
    { dbId: 'first', loaded: first, incoming: twin, reload: true },
  ]);

  const kept = addDatabasesToSession(session, [twin], '');
  assert.deepEqual(kept.databases, [first, second]);
  assert.deepEqual(kept.rejected, [twin]);

  // The twin takes the loaded one's place and keeps the filter its list gives it; a second
  // database with that db_id stays out.
  const replaced = addDatabasesToSession(session, [twin, another], '', new Set(['first']));
  assert.deepEqual(replaced.databases, [twin, second]);
  assert.deepEqual(replaced.rejected, [another]);
  assert.deepEqual(replaced.filters.overrides, { first: 'arcade' });
});

test('a conflict reloads the loaded database only when it comes from the same URL', () => {
  const loaded = [{ inspection: inspection('first'), filterDefaults: NO_FILTER_DEFAULTS }];
  const reloads = (incoming) =>
    findLoadedDbIdConflicts(loaded, [{ inspection: incoming, filterDefaults: NO_FILTER_DEFAULTS }]).map(({ reload }) => reload);

  assert.deepEqual(reloads(inspection('first')), [true]);
  // URLs compare as the pickers' Loaded markers do, ignoring letter case.
  assert.deepEqual(reloads(inspection('first', '', 'url', 'https://EXAMPLE.com/FIRST.json')), [true]);
  assert.deepEqual(reloads(inspection('first', '', 'url', 'https://example.com/fork/first.json')), [false]);
  assert.deepEqual(reloads(inspection('first', '', 'upload', 'first.json')), [false]);
  assert.deepEqual(reloads(inspection('second')), []);
});

test('with many databases, the applied filters list only those of their own, and group the rest by the filter they get', () => {
  const applied = (dbId, filterSource, effectiveFilter = '') => ({ dbId, filterSource, effectiveFilter });
  const databases = [
    applied('a', 'none'),
    applied('b', 'default', '!console'),
    applied('c', 'own', 'arcade'),
    applied('d', 'none'),
    applied('e', 'shared', 'x'),
    applied('f', 'none'),
    applied('g', 'own', ''),
  ];

  assert.deepEqual(listAppliedFilters(databases, { listEach: true }), { listed: databases, rest: [] });
  const { listed, rest } = listAppliedFilters(databases, { listEach: false });
  // An own filter that is empty still stands out: the user set it.
  assert.deepEqual(listed.map(({ dbId }) => dbId), ['b', 'c', 'g']);
  assert.deepEqual(rest, [
    { filter: 'Everything', source: 'no filter', count: 3 },
    { filter: 'x', source: 'shared filter', count: 1 },
  ]);
});

test('no sequence of openings, combinations and replacements loads two databases with one db_id', () => {
  let seed = 7;
  const random = (count) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % count;
  };
  const item = () => ({ inspection: inspection(`db${random(4)}`), filterDefaults: NO_FILTER_DEFAULTS });
  const batch = () => Array.from({ length: 1 + random(4) }, item);
  let session = { databases: [], filters: NO_COMBINED_FILTERS };

  for (let step = 0; step < 500; step += 1) {
    const items = batch();
    if (random(3) === 0) {
      session = startSession(items, NO_COMBINED_FILTERS.shared);
    } else {
      const replaceDbIds = new Set(
        findLoadedDbIdConflicts(session.databases, items)
          .filter(() => random(2) === 0)
          .map(({ dbId }) => dbId),
      );
      session = addDatabasesToSession(session, items, '', replaceDbIds);
    }

    const dbIds = session.databases.map(({ inspection: { overview } }) => overview.dbId);
    assert.equal(new Set(dbIds).size, dbIds.length, `step ${step}: ${dbIds.join(', ')}`);
  }
});
