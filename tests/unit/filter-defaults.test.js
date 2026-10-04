import assert from 'node:assert/strict';
import test from 'node:test';

import { loadDatabaseSourceFile } from '../../src/lib/database.js';
import {
  NO_FILTER_DEFAULTS,
  buildListEntryFilterDefaults,
  formatFilterPromptValue,
  listMisterFilter,
  normalizeFilterPromptValue,
  resolveDownloaderFilter,
  resolveEffectiveDefaultFilter,
  shouldConfirmFilterOverride,
} from '../../src/lib/filterDefaults.js';

const INI_WITH_MISTER = `
[mister]
filter=console !cheats

[with_filter]
db_url=https://example.com/a.json
filter=arcade [mister]

[without_filter]
db_url=https://example.com/b.json
`;

async function loadIni(text) {
  return loadDatabaseSourceFile(new File([text.trim()], 'downloader.ini', { type: 'text/plain' }));
}

function effectiveDefaultFor(iniSource, entryIndex, databaseDefaultFilter) {
  return resolveEffectiveDefaultFilter({
    ...buildListEntryFilterDefaults(iniSource.entries[entryIndex], listMisterFilter(iniSource)),
    databaseDefaultFilter,
  });
}

test('an INI entry filter takes precedence over the database default and [mister]', async () => {
  const iniSource = await loadIni(INI_WITH_MISTER);

  assert.equal(effectiveDefaultFor(iniSource, 0, 'db-default'), 'arcade console !cheats');
  assert.equal(effectiveDefaultFor(iniSource, 0, ''), 'arcade console !cheats');
});

test('the database default wins over [mister] only when it inherits [mister], as in Downloader', async () => {
  const iniSource = await loadIni(INI_WITH_MISTER);

  assert.equal(effectiveDefaultFor(iniSource, 1, 'snes [mister]'), 'snes console !cheats');
  assert.equal(effectiveDefaultFor(iniSource, 1, 'snes'), 'console !cheats');
});

test('[mister] is the fallback when neither the entry nor the database defines a filter', async () => {
  const iniSource = await loadIni(INI_WITH_MISTER);

  assert.equal(effectiveDefaultFor(iniSource, 1, ''), 'console !cheats');
  assert.equal(effectiveDefaultFor(iniSource, 1, '   '), 'console !cheats');
});

test('[mister] expands to an empty string when the INI has no [mister] filter', async () => {
  const iniSource = await loadIni(`
[only]
db_url=https://example.com/only.json
`);

  assert.equal(effectiveDefaultFor(iniSource, 0, 'snes [mister]'), 'snes');
  assert.equal(effectiveDefaultFor(iniSource, 0, ''), '');
});

test('sources without INI defaults use the database default', () => {
  assert.equal(resolveEffectiveDefaultFilter({ ...NO_FILTER_DEFAULTS, databaseDefaultFilter: 'arcade' }), 'arcade');
  assert.equal(resolveEffectiveDefaultFilter({ ...NO_FILTER_DEFAULTS, databaseDefaultFilter: 'a [mister]' }), 'a');
  assert.equal(resolveEffectiveDefaultFilter({ ...NO_FILTER_DEFAULTS, databaseDefaultFilter: '' }), '');
});

test('INI entry defaults tolerate a missing list source, where [mister] means nothing', async () => {
  const iniSource = await loadIni(INI_WITH_MISTER);

  assert.deepEqual(buildListEntryFilterDefaults(iniSource.entries[0], null), {
    sourceDefaultFilter: 'arcade',
    sourceDefaultFilterPresent: true,
    sourceDefaultFilterOverridesDatabaseDefault: true,
    misterDefaultFilter: '',
    misterDefaultFilterPresent: false,
  });
});

test('filter prompt values compare and display with collapsed whitespace', () => {
  assert.equal(normalizeFilterPromptValue('  arcade   !cheats \n'), 'arcade !cheats');
  assert.equal(formatFilterPromptValue('  arcade   !cheats '), 'arcade !cheats');
  assert.equal(formatFilterPromptValue('   '), 'Empty filter');
});

test('replacing FILTER is confirmed only when FILTER has terms and the entry brings a different filter', () => {
  const confirm = (currentFilter, nextFilter, nextFilterPresent = true) =>
    shouldConfirmFilterOverride({ currentFilter, nextFilter, nextFilterPresent });

  assert.equal(confirm('manual !keep', 'arcade ini-list-default'), true);
  assert.equal(confirm('manual !keep', ''), true);
  assert.equal(confirm('', 'arcade'), false);
  assert.equal(confirm('  \n ', 'arcade'), false);
  assert.equal(confirm('manual !keep', '', false), false);
  assert.equal(confirm('  arcade   !cheats ', 'arcade !cheats'), false);
});

test('each database gets the filter Downloader would apply to it', () => {
  const unset = { isSet: false, value: '' };
  const set = (value) => ({ isSet: true, value });
  // Expected values come from Downloader's build_db_config (lowercased there).
  const cases = [
    [unset, unset, '', ''],
    [unset, unset, 'snes', 'snes'],
    [unset, unset, '[MiSTer] !jtbeta', '!jtbeta'],
    [set('console'), unset, '', 'console'],
    [set('console'), unset, 'snes', 'console'],
    [set(''), unset, 'snes', ''],
    [set('console'), unset, 'snes [mister]', 'snes console'],
    [set('console'), unset, '[MiSTer] !jtbeta', 'console !jtbeta'],
    [set('console'), set('arcade'), 'snes', 'arcade'],
    [set('console'), set('[mister] arcade'), 'snes', 'console arcade'],
    [set('console'), set(''), 'snes', ''],
    [unset, set('[mister] arcade'), 'snes', 'arcade'],
  ];

  for (const [misterFilter, sectionFilter, databaseDefaultFilter, expected] of cases) {
    assert.equal(
      resolveDownloaderFilter({ misterFilter, sectionFilter, databaseDefaultFilter }),
      expected,
      JSON.stringify({ misterFilter, sectionFilter, databaseDefaultFilter }),
    );
  }
});

test('database list entries can be opened with or without the list [mister] filter', async () => {
  const iniSource = await loadIni(INI_WITH_MISTER);
  const [withFilter, withoutFilter] = iniSource.entries;

  assert.deepEqual(buildListEntryFilterDefaults(withFilter, listMisterFilter(iniSource)), {
    sourceDefaultFilter: 'arcade console !cheats',
    sourceDefaultFilterPresent: true,
    sourceDefaultFilterOverridesDatabaseDefault: true,
    misterDefaultFilter: 'console !cheats',
    misterDefaultFilterPresent: true,
  });
  assert.deepEqual(buildListEntryFilterDefaults(withoutFilter, listMisterFilter(iniSource)), {
    sourceDefaultFilter: 'console !cheats',
    sourceDefaultFilterPresent: true,
    sourceDefaultFilterOverridesDatabaseDefault: false,
    misterDefaultFilter: 'console !cheats',
    misterDefaultFilterPresent: true,
  });

  assert.deepEqual(buildListEntryFilterDefaults(withFilter, null), {
    sourceDefaultFilter: 'arcade',
    sourceDefaultFilterPresent: true,
    sourceDefaultFilterOverridesDatabaseDefault: true,
    misterDefaultFilter: '',
    misterDefaultFilterPresent: false,
  });
  assert.deepEqual(buildListEntryFilterDefaults(withoutFilter, null), NO_FILTER_DEFAULTS);
  // A database file has no section filter: it only takes the [mister] filter.
  assert.deepEqual(buildListEntryFilterDefaults({}, 'arcade'), {
    sourceDefaultFilter: 'arcade',
    sourceDefaultFilterPresent: true,
    sourceDefaultFilterOverridesDatabaseDefault: false,
    misterDefaultFilter: 'arcade',
    misterDefaultFilterPresent: true,
  });
  assert.equal(listMisterFilter(iniSource), 'console !cheats');
  assert.equal(listMisterFilter({ defaultFilterPresent: false, defaultFilter: '' }), null);
});
