import assert from 'node:assert/strict';
import test from 'node:test';

import { applyInspectionFilter } from '../../src/lib/database.js';

test('tagged a/b/c filter matrix matches the upstream Downloader expectations', async (t) => {
  const cases = [
    ['b', ['file_b'], ['folder_b/']],
    ['!b', ['file_a', 'file_c'], ['folder_a/', 'folder_c/']],
    ['a', ['file_a'], ['folder_a/']],
    [' a ', ['file_a'], ['folder_a/']],
    ['!a', ['file_b', 'file_c'], ['folder_b/', 'folder_c/']],
    ['a b', ['file_a', 'file_b'], ['folder_a/', 'folder_b/']],
    [' a b ', ['file_a', 'file_b'], ['folder_a/', 'folder_b/']],
    ['!a !b', ['file_c'], ['folder_c/']],
    ['a !b', ['file_a'], ['folder_a/']],
    ['!a b', ['file_b'], ['folder_b/']],
    ['a b c', ['file_a', 'file_b', 'file_c'], ['folder_a/', 'folder_b/', 'folder_c/']],
    ['all', ['file_a', 'file_b', 'file_c'], ['folder_a/', 'folder_b/', 'folder_c/']],
    ['all a', ['file_a', 'file_b', 'file_c'], ['folder_a/', 'folder_b/', 'folder_c/']],
    ['!a b c', ['file_b', 'file_c'], ['folder_b/', 'folder_c/']],
    ['a !b c', ['file_a', 'file_c'], ['folder_a/', 'folder_c/']],
    ['a b !c', ['file_a', 'file_b'], ['folder_a/', 'folder_b/']],
    ['a !b !c', ['file_a'], ['folder_a/']],
    ['!a b !c', ['file_b'], ['folder_b/']],
    ['!a !b c', ['file_c'], ['folder_c/']],
    ['!a !b !c', [], []],
    ['!all', [], []],
    ['something_not_in_db', [], []],
    ['a something_not_in_db', ['file_a'], ['folder_a/']],
    ['!a something_not_in_db', [], []],
  ];

  for (const [filter, expectedFiles, expectedFolders] of cases) {
    await t.test(filter, () => {
      const result = applyInspectionFilter(createFilesABCInspection(), filter);
      assert.equal(result.activeFilter.hasError, false);
      assert.deepEqual(listTreePaths(result.filesystemTree, 'file'), expectedFiles);
      assert.deepEqual(listTreePaths(result.filesystemTree, 'folder'), expectedFolders);
    });
  }
});

test('cheat/console filter matrix matches the upstream Downloader expectations', async (t) => {
  const cases = [
    ['!cheats', ['gb/gb_game', 'nes/nes_game'], ['gb/', 'nes/']],
    ['cheats', ['cheats/gb/gb_cheat', 'cheats/nes/nes_cheat'], ['cheats/', 'cheats/gb/', 'cheats/nes/']],
    ['nes', ['cheats/nes/nes_cheat', 'nes/nes_game'], ['cheats/', 'cheats/nes/', 'nes/']],
    ['!nes', ['cheats/gb/gb_cheat', 'gb/gb_game'], ['cheats/', 'cheats/gb/', 'gb/']],
    ['gb', ['cheats/gb/gb_cheat', 'gb/gb_game'], ['cheats/', 'cheats/gb/', 'gb/']],
    ['!gb', ['cheats/nes/nes_cheat', 'nes/nes_game'], ['cheats/', 'cheats/nes/', 'nes/']],
    ['nes !cheats', ['nes/nes_game'], ['nes/']],
    ['!nes !cheats', ['gb/gb_game'], ['gb/']],
    ['gb !cheats', ['gb/gb_game'], ['gb/']],
    ['!gb !cheats', ['nes/nes_game'], ['nes/']],
    ['nes cheats', ['cheats/gb/gb_cheat', 'cheats/nes/nes_cheat', 'nes/nes_game'], ['cheats/', 'cheats/gb/', 'cheats/nes/', 'nes/']],
    ['!nes cheats', ['cheats/gb/gb_cheat'], ['cheats/', 'cheats/gb/']],
    ['gb cheats', ['cheats/gb/gb_cheat', 'cheats/nes/nes_cheat', 'gb/gb_game'], ['cheats/', 'cheats/gb/', 'cheats/nes/', 'gb/']],
    ['!gb cheats', ['cheats/nes/nes_cheat'], ['cheats/', 'cheats/nes/']],
    ['!gb !nes !cheats', [], []],
    ['!cheats !console', [], []],
    ['!all', [], []],
    ['!gb !nes', [], ['cheats/']],
    ['all', ['cheats/gb/gb_cheat', 'cheats/nes/nes_cheat', 'gb/gb_game', 'nes/nes_game'], ['cheats/', 'cheats/gb/', 'cheats/nes/', 'gb/', 'nes/']],
    ['nes gb', ['cheats/gb/gb_cheat', 'cheats/nes/nes_cheat', 'gb/gb_game', 'nes/nes_game'], ['cheats/', 'cheats/gb/', 'cheats/nes/', 'gb/', 'nes/']],
    ['nes gb cheats', ['cheats/gb/gb_cheat', 'cheats/nes/nes_cheat', 'gb/gb_game', 'nes/nes_game'], ['cheats/', 'cheats/gb/', 'cheats/nes/', 'gb/', 'nes/']],
    ['something_not_in_db', [], []],
    ['nes something_not_in_db', ['cheats/nes/nes_cheat', 'nes/nes_game'], ['cheats/', 'cheats/nes/', 'nes/']],
    ['!nes something_not_in_db', [], []],
  ];

  for (const [filter, expectedFiles, expectedFolders] of cases) {
    await t.test(filter, () => {
      const result = applyInspectionFilter(createCheatConsoleInspection(), filter);
      assert.equal(result.activeFilter.hasError, false);
      assert.deepEqual(listTreePaths(result.filesystemTree, 'file'), expectedFiles);
      assert.deepEqual(listTreePaths(result.filesystemTree, 'folder'), expectedFolders);
    });
  }
});

test('untagged and essential entries follow Downloader semantics', async (t) => {
  await t.test('untagged files remain visible with a positive filter', () => {
    const result = applyInspectionFilter(createUntaggedInspection(), 'a');
    assert.deepEqual(listTreePaths(result.filesystemTree, 'file'), ['file_a', 'file_one']);
    assert.deepEqual(listTreePaths(result.filesystemTree, 'folder'), ['folder_a/']);
  });

  await t.test('negative all removes untagged files', () => {
    const result = applyInspectionFilter(createUntaggedInspection(), '!all');
    assert.deepEqual(listTreePaths(result.filesystemTree, 'file'), []);
    assert.deepEqual(listTreePaths(result.filesystemTree, 'folder'), []);
  });

  await t.test('essential stays included unless explicitly negated', () => {
    const result = applyInspectionFilter(createEssentialInspection(), 'nes');
    assert.deepEqual(listTreePaths(result.filesystemTree, 'file'), ['cheats/nes/nes_cheat', 'essential.bin']);
    assert.deepEqual(listTreePaths(result.filesystemTree, 'folder'), ['cheats/', 'cheats/nes/']);
  });

  await t.test('negative all still keeps essential entries', () => {
    const result = applyInspectionFilter(createEssentialInspection(), '!all');
    assert.deepEqual(listTreePaths(result.filesystemTree, 'file'), ['essential.bin']);
    assert.deepEqual(listTreePaths(result.filesystemTree, 'folder'), []);
  });

  await t.test('negative essential plus negative all removes everything', () => {
    const result = applyInspectionFilter(createEssentialInspection(), '!essential !all');
    assert.deepEqual(listTreePaths(result.filesystemTree, 'file'), []);
    assert.deepEqual(listTreePaths(result.filesystemTree, 'folder'), []);
  });
});

test('underscore and hyphen normalization match the upstream expectations', async (t) => {
  await t.test('negative foo_bar excludes a foobar tag', () => {
    const result = applyInspectionFilter(createFoobarInspection(), '!foo_bar');
    assert.deepEqual(listTreePaths(result.filesystemTree, 'file'), []);
  });

  await t.test('negative foo-bar excludes a foobar tag', () => {
    const result = applyInspectionFilter(createFoobarInspection(), '!foo-bar');
    assert.deepEqual(listTreePaths(result.filesystemTree, 'file'), []);
  });

  await t.test('a non-matching negative term keeps the foobar tag', () => {
    const result = applyInspectionFilter(createFoobarInspection(), '!foobar2');
    assert.deepEqual(listTreePaths(result.filesystemTree, 'file'), ['file_one']);
  });
});

test('the same filter can be applied independently to multiple inspections', () => {
  const first = applyInspectionFilter(createFilesABCInspection(), 'b');
  const second = applyInspectionFilter(createFilesABCInspection({ prefix: 'alt_' }), 'b');

  assert.deepEqual(listTreePaths(first.filesystemTree, 'file'), ['file_b']);
  assert.deepEqual(listTreePaths(second.filesystemTree, 'file'), ['alt_file_b']);
  assert.deepEqual(listTreePaths(first.filesystemTree, 'folder'), ['folder_b/']);
  assert.deepEqual(listTreePaths(second.filesystemTree, 'folder'), ['folder_b/']);
});

test('invalid filter terms fail gracefully and keep the full view active', async (t) => {
  const invalidTerms = ['!!!b', '@what', '_hidden', 'wha+tever', '"quotes1"', "'quotes2'", '!all a', 'none'];

  for (const filter of invalidTerms) {
    await t.test(filter, () => {
      const result = applyInspectionFilter(createCheatConsoleInspection(), filter);
      assert.equal(result.activeFilter.hasError, true);
      assert.equal(result.activeFilter.isFiltering, false);
      assert.deepEqual(result.activeFilter.resultCounts, {
        files: 4,
        folders: 5,
        archives: 0,
      });
      assert.match(result.issues.at(-1)?.message || '', /full view is shown instead|cannot be combined/);
    });
  }
});

test('inherited filters are ignored with a warning and no inherited terms survive', async (t) => {
  await t.test('[mister] b behaves like b and warns', () => {
    const result = applyInspectionFilter(createFilesABCInspection(), '[mister] b');
    assert.equal(result.activeFilter.hasWarnings, true);
    assert.deepEqual(result.activeFilter.positiveTerms, ['b']);
    assert.deepEqual(result.activeFilter.negativeTerms, []);
    assert.deepEqual(listTreePaths(result.filesystemTree, 'file'), ['file_b']);
    assert.match(
      result.issues.at(-1)?.message || '',
      /Inherited filter terms \[mister\] are not supported/,
    );
  });

  await t.test('[mister] alone falls back to the full view with a warning', () => {
    const result = applyInspectionFilter(createFilesABCInspection(), '[mister]');
    assert.equal(result.activeFilter.hasWarnings, true);
    assert.equal(result.activeFilter.isFiltering, false);
    assert.deepEqual(result.activeFilter.resultCounts, {
      files: 3,
      folders: 3,
      archives: 0,
    });
    assert.equal(result.activeFilter.appliedInput, '');
  });
});

test('archive summaries are filtered with the same semantics as filesystem entries', () => {
  const result = applyInspectionFilter(createArchiveInspection(), 'a !b');

  assert.equal(result.activeFilter.hasError, false);
  assert.equal(result.archiveViews.length, 1);
  assert.deepEqual(listTreePaths(result.archiveViews[0].tree, 'file'), ['games/archives/a.cht', 'games/archives/plain.cht']);
  assert.deepEqual(listTreePaths(result.archiveViews[0].tree, 'folder'), ['games/', 'games/archives/', 'games/archives/a/', 'games/archives/plain/']);
});

function createFilesABCInspection({ prefix = '' } = {}) {
  return createInspection({
    files: [
      fileRecord(`${prefix}file_a`, ['a']),
      fileRecord(`${prefix}file_b`, ['b']),
      fileRecord(`${prefix}file_c`, ['c']),
    ],
    folders: [
      folderRecord('folder_a/', ['a']),
      folderRecord('folder_b/', ['b']),
      folderRecord('folder_c/', ['c']),
    ],
  });
}

function createCheatConsoleInspection() {
  return createInspection({
    files: [
      fileRecord('cheats/nes/nes_cheat', ['nes', 'cheats']),
      fileRecord('cheats/gb/gb_cheat', ['gb', 'cheats']),
      fileRecord('nes/nes_game', ['nes', 'console']),
      fileRecord('gb/gb_game', ['gb', 'console']),
    ],
    folders: [
      folderRecord('cheats/', ['cheats']),
      folderRecord('cheats/nes/', ['cheats', 'nes']),
      folderRecord('cheats/gb/', ['cheats', 'gb']),
      folderRecord('nes/', ['nes', 'console']),
      folderRecord('gb/', ['gb', 'console']),
    ],
  });
}

function createEssentialInspection() {
  return createInspection({
    files: [
      fileRecord('essential.bin', ['essential']),
      fileRecord('cheats/nes/nes_cheat', ['nes', 'cheats']),
      fileRecord('cheats/gb/gb_cheat', ['gb', 'cheats']),
    ],
    folders: [
      folderRecord('cheats/', ['cheats']),
      folderRecord('cheats/nes/', ['cheats', 'nes']),
      folderRecord('cheats/gb/', ['cheats', 'gb']),
    ],
  });
}

function createUntaggedInspection() {
  return createInspection({
    files: [
      fileRecord('file_a', ['a']),
      fileRecord('file_one'),
    ],
    folders: [
      folderRecord('folder_a/', ['a']),
    ],
  });
}

function createFoobarInspection() {
  return createInspection({
    files: [fileRecord('file_one', ['foobar'])],
  });
}

function createArchiveInspection() {
  return createInspection({
    archives: [
      archiveView('filter_archive', [
        fileRecord('games/archives/a.cht', ['a']),
        fileRecord('games/archives/b.cht', ['b']),
        fileRecord('games/archives/plain.cht'),
        folderRecord('games/archives/a/', ['a']),
        folderRecord('games/archives/b/', ['b']),
        folderRecord('games/archives/plain/'),
      ]),
    ],
  });
}

function createInspection({ files = [], folders = [], archives = [] } = {}) {
  const filesystemRecords = [...folders, ...files];
  return {
    issues: [],
    source: {
      sourceKind: 'test',
      sourceLabel: 'test',
      sourceUrl: 'https://example.com/test.json',
      containerType: 'json',
      extractedEntry: null,
    },
    overview: {
      dbId: 'test_db',
      version: 1,
      timestamp: 1710000000,
      timestampLabel: 'test',
      baseFilesUrl: '',
      defaultFilter: '',
      importedDatabases: [],
      tagDictionary: [],
      counts: {
        files: files.length,
        folders: folders.length,
        archives: archives.length,
      },
    },
    filesystemRecords,
    filesystemTree: { id: 'database:root', children: [] },
    archiveViews: archives,
  };
}

function archiveView(id, summaryRecords) {
  return {
    id,
    nodeId: `archive:${id}`,
    title: id,
    summarySource: 'summary_inline',
    summaryLoadedFrom: null,
    issues: [],
    primaryFields: [],
    details: [],
    summaryRecords,
    tree: { id: `archive:${id}:root`, children: [] },
  };
}

function fileRecord(path, filterTags = []) {
  return {
    id: `file:${path}`,
    kind: 'file',
    path,
    name: leafName(path),
    badge: 'FILE',
    downloadUrl: null,
    primaryFields: [],
    details: [],
    filterTags,
  };
}

function folderRecord(path, filterTags = []) {
  return {
    id: `folder:${path}`,
    kind: 'folder',
    path,
    name: leafName(path),
    badge: 'DIR',
    downloadUrl: null,
    primaryFields: [],
    details: [],
    filterTags,
  };
}

function leafName(path) {
  return String(path).replace(/\/$/, '').split('/').pop() || path;
}

function listTreePaths(tree, kind) {
  const paths = [];

  visitTreeNodes(tree?.children || [], (node) => {
    if (node.kind === kind) {
      paths.push(node.path);
    }
  });

  return paths.sort();
}

function visitTreeNodes(nodes, visitor) {
  for (const node of nodes) {
    visitor(node);
    if (Array.isArray(node.children) && node.children.length) {
      visitTreeNodes(node.children, visitor);
    }
  }
}
