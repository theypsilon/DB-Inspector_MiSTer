import assert from 'node:assert/strict';
import test from 'node:test';

import { loadDatabaseSourceFile } from '../../src/lib/database.js';
import {
  buildFlatArchiveIndex,
  buildFlatNodeIndex,
  collectVisibleRowIds,
  getRowBadge,
} from '../../src/lib/treeIndex.js';

async function inspect(database) {
  const loadedSource = await loadDatabaseSourceFile(
    new File([JSON.stringify(database)], 'db.json', { type: 'application/json' }),
  );
  return loadedSource.inspection;
}

function summarizeRows(index) {
  return [...index.rowsById.values()].map((row) => ({
    id: row.id,
    parentId: row.parentId,
    depth: row.depth,
    isLastSibling: row.isLastSibling,
    ancestorContinuationDepths: row.ancestorContinuationDepths,
    canCollapse: row.canCollapse,
    childIds: row.childIds,
  }));
}

test('filesystem rows are indexed depth-first with tree guide metadata', async () => {
  const inspection = await inspect({
    db_id: 'tree_index',
    timestamp: 1,
    base_files_url: 'https://example.com/',
    files: { 'a/x.rbf': {}, 'a/y.rbf': {}, 'b/z.rbf': {}, 'root.txt': {} },
    folders: { a: {}, b: {} },
  });

  const index = buildFlatNodeIndex(inspection.filesystemTree.children);

  assert.deepEqual(index.rootIds, ['database:folder:a', 'database:folder:b', 'database:file:root.txt']);
  assert.deepEqual(summarizeRows(index), [
    { id: 'database:folder:a', parentId: null, depth: 0, isLastSibling: false, ancestorContinuationDepths: [], canCollapse: true, childIds: ['database:file:a/x.rbf', 'database:file:a/y.rbf'] },
    { id: 'database:file:a/x.rbf', parentId: 'database:folder:a', depth: 1, isLastSibling: false, ancestorContinuationDepths: [0], canCollapse: true, childIds: [] },
    { id: 'database:file:a/y.rbf', parentId: 'database:folder:a', depth: 1, isLastSibling: true, ancestorContinuationDepths: [0], canCollapse: true, childIds: [] },
    { id: 'database:folder:b', parentId: null, depth: 0, isLastSibling: false, ancestorContinuationDepths: [], canCollapse: true, childIds: ['database:file:b/z.rbf'] },
    { id: 'database:file:b/z.rbf', parentId: 'database:folder:b', depth: 1, isLastSibling: true, ancestorContinuationDepths: [0], canCollapse: true, childIds: [] },
    { id: 'database:file:root.txt', parentId: null, depth: 0, isLastSibling: true, ancestorContinuationDepths: [], canCollapse: true, childIds: [] },
  ]);
  assert.deepEqual(index.collapsibleIds, [...index.rowsById.keys()]);

  assert.deepEqual(
    collectVisibleRowIds(index.rootIds, index.rowsById, new Set(['database:folder:a'])),
    ['database:folder:a', 'database:folder:b', 'database:file:b/z.rbf', 'database:file:root.txt'],
  );
});

test('archive rows are roots whose summary entries continue the guide unless last', async () => {
  const summary = (archiveId) => ({
    files: {
      'one.bin': { arc_id: archiveId, arc_at: 'one.bin' },
      'two.bin': { arc_id: archiveId, arc_at: 'two.bin' },
    },
    folders: {},
  });
  const inspection = await inspect({
    db_id: 'archive_index',
    timestamp: 1,
    files: {},
    folders: {},
    archives: {
      first: { extract: 'selective', archive_file: {}, summary_inline: summary('first') },
      second: { extract: 'selective', archive_file: {}, summary_inline: summary('second') },
    },
  });

  const index = buildFlatArchiveIndex(inspection.archiveViews);

  assert.deepEqual(index.rootIds, ['archive:first', 'archive:second']);
  assert.deepEqual(index.collapsibleIds, [...index.rowsById.keys()]);
  assert.deepEqual(
    summarizeRows(index).map(({ id, parentId, depth, isLastSibling, ancestorContinuationDepths }) => [
      id,
      parentId,
      depth,
      isLastSibling,
      ancestorContinuationDepths,
    ]),
    [
      ['archive:first', null, 0, false, []],
      ['archive:first:file:one.bin', 'archive:first', 1, false, [0]],
      ['archive:first:file:two.bin', 'archive:first', 1, true, [0]],
      ['archive:second', null, 0, true, []],
      ['archive:second:file:one.bin', 'archive:second', 1, false, []],
      ['archive:second:file:two.bin', 'archive:second', 1, true, []],
    ],
  );
  assert.equal(index.rowsById.get('archive:first').type, 'archive');
});

test('row badges distinguish archives, folders, and files', async () => {
  const inspection = await inspect({
    db_id: 'badges',
    timestamp: 1,
    base_files_url: 'https://example.com/',
    files: { 'a/x.rbf': {} },
    folders: { a: {} },
    archives: {
      arc: { extract: 'selective', archive_file: {}, summary_inline: { files: {}, folders: {} } },
    },
  });
  const nodeIndex = buildFlatNodeIndex(inspection.filesystemTree.children);
  const archiveIndex = buildFlatArchiveIndex(inspection.archiveViews);

  assert.deepEqual(getRowBadge(archiveIndex.rowsById.get('archive:arc')), {
    badge: 'ZIP',
    badgeClassName: 'node-badge archive-badge',
  });
  assert.deepEqual(getRowBadge(nodeIndex.rowsById.get('database:folder:a')), {
    badge: 'DIR',
    badgeClassName: 'node-badge folder-badge',
  });
  assert.deepEqual(getRowBadge(nodeIndex.rowsById.get('database:file:a/x.rbf')), {
    badge: 'FILE',
    badgeClassName: 'node-badge file-badge',
  });
});
