import assert from 'node:assert/strict';
import test from 'node:test';

import { applyInspectionFilter, loadDatabaseSourceFile } from '../../src/lib/database.js';

// Reading database sources: JSON databases and INI lists, and the issues their inspection reports.

function makeJsonFile(obj, filename = 'test.json') {
  const content = JSON.stringify(obj);
  return new File([content], filename, { type: 'application/json' });
}

function makeIniFile(text, filename = 'downloader.ini') {
  return new File([text], filename, { type: 'text/plain' });
}

function makeMinimalDb(overrides = {}) {
  return {
    db_id: 'test_db',
    timestamp: 1710000000,
    files: {},
    folders: {},
    ...overrides,
  };
}

function findIssue(issues, substring) {
  return issues.find((issue) => issue.message.includes(substring));
}

test('JSON database parses correctly and returns kind=database with correct db_id', async () => {
  const db = makeMinimalDb({ db_id: 'my_custom_db' });
  const result = await loadDatabaseSourceFile(makeJsonFile(db));

  assert.equal(result.kind, 'database');
  assert.equal(result.inspection.overview.dbId, 'my_custom_db');
});

test('INI file with ; and # comment lines are ignored', async () => {
  const ini = [
    '; This is a semicolon comment',
    '# This is a hash comment',
    '[my_db]',
    'db_url = https://example.com/db.json',
    '; another comment inside a section',
    '# another hash comment inside a section',
  ].join('\n');

  const result = await loadDatabaseSourceFile(makeIniFile(ini));

  assert.equal(result.kind, 'ini');
  assert.equal(result.source.containerType, 'ini');
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].dbId, 'my_db');
  assert.equal(result.entries[0].dbUrl, 'https://example.com/db.json');
});

test('INI file with multiple entries parses all with correct dbId and dbUrl', async () => {
  const ini = [
    '[first_db]',
    'db_url = https://example.com/first.json',
    '',
    '[second_db]',
    'db_url = https://example.com/second.json',
    '',
    '[third_db]',
    'db_url = https://example.com/third.json',
  ].join('\n');

  const result = await loadDatabaseSourceFile(makeIniFile(ini));

  assert.equal(result.kind, 'ini');
  assert.equal(result.entries.length, 3);

  assert.equal(result.entries[0].dbId, 'first_db');
  assert.equal(result.entries[0].dbUrl, 'https://example.com/first.json');

  assert.equal(result.entries[1].dbId, 'second_db');
  assert.equal(result.entries[1].dbUrl, 'https://example.com/second.json');

  assert.equal(result.entries[2].dbId, 'third_db');
  assert.equal(result.entries[2].dbUrl, 'https://example.com/third.json');
});

test('legacy tags_dictionary is accepted and produces a warning via inspectDatabase', async () => {
  const db = makeMinimalDb({
    tags_dictionary: { nes: 0, snes: 1 },
    files: {
      'games/nes_game.rbf': { hash: 'abc', size: 100, tags: [0] },
    },
    folders: {
      'games': {},
    },
  });

  const result = await loadDatabaseSourceFile(makeJsonFile(db));

  assert.equal(result.kind, 'database');

  const legacyWarning = findIssue(
    result.inspection.issues,
    'tags_dictionary',
  );
  assert.ok(legacyWarning, 'expected a warning about tags_dictionary');
  assert.equal(legacyWarning.level, 'warning');
  assert.match(
    legacyWarning.message,
    /tags_dictionary.*tag_dictionary/,
  );
});

test('tag_dictionary (correct field name) populates the overview tag list', async () => {
  const db = makeMinimalDb({
    tag_dictionary: { nes: 0, snes: 1 },
  });

  const result = await loadDatabaseSourceFile(makeJsonFile(db));

  assert.equal(result.kind, 'database');
  assert.equal(result.inspection.overview.tagDictionary.length, 2);

  const tagNames = result.inspection.overview.tagDictionary.map((t) => t.name).sort();
  assert.deepEqual(tagNames, ['nes', 'snes']);
});

test('missing timestamp generates an issue', async () => {
  const db = makeMinimalDb();
  delete db.timestamp;

  const result = await loadDatabaseSourceFile(makeJsonFile(db));

  assert.equal(result.kind, 'database');

  const timestampIssue = findIssue(
    result.inspection.issues,
    'timestamp',
  );
  assert.ok(timestampIssue, 'expected an issue about missing timestamp');
});

test('missing db_id generates an issue', async () => {
  const db = makeMinimalDb();
  delete db.db_id;

  const result = await loadDatabaseSourceFile(makeJsonFile(db));

  assert.equal(result.kind, 'database');

  const dbIdIssue = findIssue(
    result.inspection.issues,
    'db_id',
  );
  assert.ok(dbIdIssue, 'expected an issue about missing db_id');
  assert.equal(dbIdIssue.level, 'error');

  // Overview should show the fallback value.
  assert.equal(result.inspection.overview.dbId, '(missing)');
});

test('file with absolute path starting with / generates an issue', async () => {
  const db = makeMinimalDb({
    files: {
      '/absolute/path/file.rbf': { hash: 'abc', size: 100 },
    },
    folders: {
      '/absolute/path': {},
    },
  });

  const result = await loadDatabaseSourceFile(makeJsonFile(db));

  assert.equal(result.kind, 'database');

  const pathIssues = result.inspection.issues.filter(
    (issue) => issue.message.includes('invalid') && issue.message.includes('path'),
  );
  assert.ok(pathIssues.length > 0, 'expected at least one path validation issue for absolute paths');
});

test('empty database with no files and no folders parses successfully', async () => {
  const db = makeMinimalDb({
    files: {},
    folders: {},
  });

  const result = await loadDatabaseSourceFile(makeJsonFile(db));

  assert.equal(result.kind, 'database');
  assert.equal(result.inspection.overview.counts.files, 0);
  assert.equal(result.inspection.overview.counts.folders, 0);
  assert.equal(result.inspection.filesystemRecords.length, 0);
  assert.deepEqual(result.inspection.filesystemTree.children, []);
});

test('database with default_options.filter includes the defaultFilter in the overview', async () => {
  const db = makeMinimalDb({
    default_options: { filter: '!cheats' },
  });

  const result = await loadDatabaseSourceFile(makeJsonFile(db));

  assert.equal(result.kind, 'database');
  assert.equal(result.inspection.overview.defaultFilter, '!cheats');
});

test('INI with no [mister] section still parses entries and has empty defaultFilter', async () => {
  const ini = [
    '[alpha_db]',
    'db_url = https://example.com/alpha.json',
    '',
    '[beta_db]',
    'db_url = https://example.com/beta.json',
  ].join('\n');

  const result = await loadDatabaseSourceFile(makeIniFile(ini));

  assert.equal(result.kind, 'ini');
  assert.equal(result.entries.length, 2);
  assert.equal(result.defaultFilter, '');
  assert.equal(result.defaultFilterPresent, false);

  // Individual entries should also have empty defaultFilter.
  assert.equal(result.entries[0].defaultFilter, '');
  assert.equal(result.entries[1].defaultFilter, '');
});

// The first names of an entry's tags, in the order its row shows them.
function tagOrder(records, path) {
  const record = records.find((candidate) => candidate.path === path);
  return record.primaryFields.find((field) => field.kind === 'tags').value.map((tag) => tag.names[0]);
}

test('entries list their tags rarest in the database first, counting files, folders and archive entries', async () => {
  const db = makeMinimalDb({
    tag_dictionary: { common: 0, folderish: 1, rare: 2, also_rare: 3, single: 4, zeta: 5, alpha: 6 },
    folders: { games: { tags: [1] } },
    files: {
      'games/a.rbf': { hash: 'a', size: 1, tags: [1, 2] },
      'games/b.rbf': { hash: 'b', size: 1, tags: [3, 4] },
      'games/d.rbf': { hash: 'd', size: 1, tags: [5, 6] },
    },
    archives: {
      pack: {
        format: 'zip',
        extract: 'selective',
        target_folder: 'games/',
        archive_file: { url: 'https://example.com/pack.zip', hash: 'p', size: 1 },
        summary_inline: { files: { 'games/c.bin': { arc_id: 'pack', arc_at: 'c.bin', hash: 'c', size: 1, tags: [3, 0] } }, folders: {} },
      },
    },
  });

  const { inspection } = await loadDatabaseSourceFile(makeJsonFile(db));
  const files = inspection.filesystemRecords;
  // The folder uses folderish too, so rare comes first.
  assert.deepEqual(tagOrder(files, 'games/a.rbf'), ['rare', 'folderish']);
  // The archive entry uses also_rare too, so single comes first.
  assert.deepEqual(tagOrder(files, 'games/b.rbf'), ['single', 'also_rare']);
  // Tags used as often keep the database's order.
  assert.deepEqual(tagOrder(files, 'games/d.rbf'), ['zeta', 'alpha']);
  assert.deepEqual(tagOrder(inspection.archiveViews[0].summaryRecords, 'games/c.bin'), ['common', 'also_rare']);

  // A filter shows fewer entries, but the order stays the database's.
  const filtered = applyInspectionFilter(inspection, 'single');
  assert.deepEqual(tagOrder(filtered.filesystemRecords, 'games/b.rbf'), ['single', 'also_rare']);
});
