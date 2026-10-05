import assert from 'node:assert/strict';
import test from 'node:test';

import { NO_COMBINED_FILTERS, UNSET_FILTER } from '../../src/lib/combinedFilters.js';
import {
  buildDownloaderIni,
  hasInstallFilters,
  sessionInstallFilters,
  splitInstallableDatabases,
} from '../../src/lib/downloaderIni.js';

const loaded = (dbId, { url = `https://example.com/${dbId}.json`, defaultFilter = '' } = {}) => ({
  inspection: {
    overview: { dbId, defaultFilter },
    source: url ? { sourceKind: 'url', requestedUrl: url } : { sourceKind: 'upload', requestedUrl: null },
  },
});

test('the databases loaded from a URL are installed, in order; uploaded ones are left out', () => {
  const { installable, leftOut } = splitInstallableDatabases([
    loaded('alpha'),
    loaded('mine', { url: null }),
    loaded('Coin-OpCollection/Distribution-MiSTerFPGA', { url: 'https://example.com/coin-op/db.json.zip' }),
  ]);
  assert.deepEqual(installable, [
    { dbId: 'alpha', dbUrl: 'https://example.com/alpha.json' },
    { dbId: 'Coin-OpCollection/Distribution-MiSTerFPGA', dbUrl: 'https://example.com/coin-op/db.json.zip' },
  ]);
  assert.deepEqual(leftOut, ['mine']);
});

test('downloader.ini lists each database with its db_url, and with the filters, [mister] and each own filter', () => {
  const installable = [
    { dbId: 'alpha', dbUrl: 'https://example.com/alpha.json' },
    { dbId: 'beta', dbUrl: 'https://example.com/beta.json' },
  ];
  const filters = { shared: { isSet: true, value: ' arcade ' }, overrides: { beta: '[mister] !cheats', gone: 'x' } };

  assert.equal(buildDownloaderIni(installable), '[alpha]\ndb_url=https://example.com/alpha.json\n\n[beta]\ndb_url=https://example.com/beta.json\n');
  assert.equal(
    buildDownloaderIni(installable, filters),
    '[mister]\nfilter=arcade\n\n[alpha]\ndb_url=https://example.com/alpha.json\n\n[beta]\ndb_url=https://example.com/beta.json\nfilter=[mister] !cheats\n',
  );
  // An empty filter that is set is written: it still replaces the filter a database gets otherwise.
  assert.equal(
    buildDownloaderIni(installable, { shared: { isSet: true, value: '' }, overrides: { alpha: '' } }),
    '[mister]\nfilter=\n\n[alpha]\ndb_url=https://example.com/alpha.json\nfilter=\n\n[beta]\ndb_url=https://example.com/beta.json\n',
  );
  assert.equal(buildDownloaderIni(installable, NO_COMBINED_FILTERS), buildDownloaderIni(installable));
});

test('there are filters to include when the shared filter is set or an installed database has its own', () => {
  const installable = [{ dbId: 'alpha', dbUrl: 'https://example.com/alpha.json' }];
  assert.equal(hasInstallFilters(installable, NO_COMBINED_FILTERS), false);
  assert.equal(hasInstallFilters(installable, { shared: { isSet: true, value: '' }, overrides: {} }), true);
  assert.equal(hasInstallFilters(installable, { shared: UNSET_FILTER, overrides: { alpha: 'arcade' } }), true);
  // An uploaded database's own filter has nowhere to go.
  assert.equal(hasInstallFilters(installable, { shared: UNSET_FILTER, overrides: { mine: 'arcade' } }), false);
});

test('combined databases keep their filters; a database alone has FILTER as its own filter when it differs from its default', () => {
  const combinedFilters = { shared: { isSet: true, value: 'arcade' }, overrides: { beta: 'console' } };
  assert.equal(sessionInstallFilters({ databases: [loaded('alpha'), loaded('beta')], combinedFilters, filterInput: '' }), combinedFilters);

  const alone = [loaded('alpha', { defaultFilter: 'arcade' })];
  const single = (filterInput) => sessionInstallFilters({ databases: alone, combinedFilters: NO_COMBINED_FILTERS, filterInput });
  assert.deepEqual(single('arcade'), { shared: UNSET_FILTER, overrides: {} });
  assert.deepEqual(single('console'), { shared: UNSET_FILTER, overrides: { alpha: 'console' } });
  // Emptied, FILTER shows everything, which its default would not.
  assert.deepEqual(single(''), { shared: UNSET_FILTER, overrides: { alpha: '' } });
});
