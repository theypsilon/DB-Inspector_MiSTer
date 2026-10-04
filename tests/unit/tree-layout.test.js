import assert from 'node:assert/strict';
import test from 'node:test';

import { loadDatabaseSourceFile } from '../../src/lib/database.js';
import { buildFlatNodeIndex, collectVisibleRowIds } from '../../src/lib/treeIndex.js';
import {
  buildVirtualRowLayout,
  buildVirtualRowStyle,
  buildVirtualRows,
  getRowMeasurementKey,
  rowOutline,
} from '../../src/lib/treeLayout.js';

async function filesystemIndex(files, folders) {
  const loadedSource = await loadDatabaseSourceFile(
    new File([JSON.stringify({ db_id: 'tree_layout', timestamp: 1, files, folders })], 'db.json', { type: 'application/json' }),
  );
  return buildFlatNodeIndex(loadedSource.inspection.filesystemTree.children);
}

// Each visible row's name and outline, top to bottom.
function outlines(index, collapsedIds = new Set()) {
  const rowIds = collectVisibleRowIds(index.rootIds, index.rowsById, collapsedIds);
  return rowIds.map((rowId, at) => ({ name: index.rowsById.get(rowId).node.name, ...rowOutline(rowIds, index.rowsById, at) }));
}

// Every line between two rows is drawn by exactly one of them, and the list is closed at both ends.
function assertEachLineDrawnOnce(rows) {
  assert.equal(rows[0].topLine, true, 'the first row draws the top of the list');
  assert.equal(rows.at(-1).bottomLine, true, 'the last row draws the bottom of the list');
  for (let at = 1; at < rows.length; at += 1) {
    assert.equal(
      Number(rows[at - 1].bottomLine) + Number(rows[at].topLine),
      1,
      `the line between ${rows[at - 1].name} and ${rows[at].name} is drawn once`,
    );
  }
}

// A tree that steps in twice, then back out two levels at once:
// a/ (depth 0), a/b/ (1), a/b/y.rbf (2), a/x.rbf (1), z.txt (0).
const STEPPED = {
  files: { 'a/x.rbf': {}, 'a/b/y.rbf': {}, 'z.txt': {} },
  folders: { a: {}, 'a/b': {} },
};

test('the wider of two rows draws the line between them, and the outline rounds its outer corners', async () => {
  const index = await filesystemIndex(STEPPED.files, STEPPED.folders);
  const rows = outlines(index);
  assert.deepEqual(rows, [
    // The list's top corners; the line under it, where its first row steps in, with a rounded step.
    { name: 'a', topLine: true, bottomLine: true, corners: 'outer outer none step' },
    // A row one level deeper than the row above it leaves that line to the wider row.
    { name: 'b', topLine: false, bottomLine: true, corners: 'none none none step' },
    { name: 'y.rbf', topLine: false, bottomLine: false, corners: 'none none none none' },
    // Back out a level: the wider row below draws the line, and rounds its step.
    { name: 'x.rbf', topLine: true, bottomLine: false, corners: 'step none none none' },
    // The last row closes the list, with its bottom corners.
    { name: 'z.txt', topLine: true, bottomLine: true, corners: 'step none outer outer' },
  ]);
  assertEachLineDrawnOnce(rows);
});

test('a collapsed folder is drawn as wide as the rows around it, with no step', async () => {
  const index = await filesystemIndex(STEPPED.files, STEPPED.folders);
  const rows = outlines(index, new Set(['database:folder:a/b']));
  assert.deepEqual(rows, [
    { name: 'a', topLine: true, bottomLine: true, corners: 'outer outer none step' },
    { name: 'b', topLine: false, bottomLine: false, corners: 'none none none none' },
    // As wide as the row above: the lower row draws the line between them.
    { name: 'x.rbf', topLine: true, bottomLine: false, corners: 'none none none none' },
    { name: 'z.txt', topLine: true, bottomLine: true, corners: 'step none outer outer' },
  ]);
  assertEachLineDrawnOnce(rows);

  // One row alone draws all of its outline.
  assert.deepEqual(outlines(await filesystemIndex({ 'only.txt': {} }, {})), [
    { name: 'only.txt', topLine: true, bottomLine: true, corners: 'outer outer outer outer' },
  ]);
});

test('every line between two rows is drawn once, however deep the tree goes and whatever is collapsed', async () => {
  const files = {};
  const folders = {};
  // Folders nested up to four levels, with files at every level, and a few files at the root.
  for (const top of ['alpha', 'beta']) {
    folders[top] = {};
    files[`${top}/top.rbf`] = {};
    for (const middle of ['one', 'two']) {
      folders[`${top}/${middle}`] = {};
      folders[`${top}/${middle}/deep`] = {};
      folders[`${top}/${middle}/deep/deeper`] = {};
      files[`${top}/${middle}/m.rbf`] = {};
      files[`${top}/${middle}/deep/deeper/d.rbf`] = {};
    }
  }
  files['root_a.txt'] = {};
  files['root_b.txt'] = {};
  const index = await filesystemIndex(files, folders);
  const folderIds = [...index.rowsById.values()].filter((row) => row.node.kind === 'folder').map((row) => row.id);

  assertEachLineDrawnOnce(outlines(index));
  for (const collapsedId of folderIds) {
    assertEachLineDrawnOnce(outlines(index, new Set([collapsedId])));
  }
  assertEachLineDrawnOnce(outlines(index, new Set(folderIds.filter((_, at) => at % 2 === 0))));
});

test('rendered rows fill their place in the list, and draw their lines from the rows around them, rendered or not', async () => {
  const files = Object.fromEntries(Array.from({ length: 60 }, (_, at) => [`games/file_${String(at).padStart(2, '0')}.rbf`, {}]));
  const index = await filesystemIndex(files, { games: {} });
  const rowIds = collectVisibleRowIds(index.rootIds, index.rowsById, new Set());
  const collapsed = false;
  const detailsVisible = false;
  const measuredHeights = new Map(
    rowIds.map((rowId, at) => [getRowMeasurementKey(rowId, { collapsed, detailsVisible }), 100 + (at % 3)]),
  );
  const layout = buildVirtualRowLayout({
    rowIds,
    rowsById: index.rowsById,
    collapsedIds: new Set(),
    detailOverrides: new Map(),
    defaultDetailed: false,
    measuredHeights,
  });

  // Rows touch: each starts where the one above ends, and the list is their heights added up.
  assert.equal(layout.totalHeight, layout.bottoms.at(-1));
  for (let at = 1; at < rowIds.length; at += 1) {
    assert.equal(layout.offsets[at], layout.bottoms[at - 1]);
  }

  // Scrolled far down a short viewport: the folder stays rendered above a window of its files.
  const { items } = buildVirtualRows({ layout, rowsById: index.rowsById, containerTop: 0, scrollY: 4500, viewportHeight: 300 });
  const at = (item) => rowIds.indexOf(item.rowId);
  assert.equal(at(items[0]), 0);
  const windowStart = items.find((item, position) => position > 0 && at(item) !== at(items[position - 1]) + 1);
  assert.ok(windowStart && at(windowStart) > 1, 'the window starts after rows that are not rendered');

  for (const item of items) {
    assert.equal(item.height, layout.bottoms[at(item)] - layout.offsets[at(item)]);
    assert.deepEqual(
      { topLine: item.topLine, bottomLine: item.bottomLine, corners: item.corners },
      rowOutline(rowIds, index.rowsById, at(item)),
    );
  }
  // The folder draws the line under it although its first file is not rendered; the first file
  // of the window draws its own top line, under a file that is not rendered either.
  assert.deepEqual([items[0].bottomLine, items[0].corners], [true, 'outer outer none step']);
  assert.deepEqual([windowStart.topLine, windowStart.bottomLine, windowStart.corners], [true, false, 'none none none none']);
});

test('a row is drawn over its place in the list with its lines and corners, or as a card on its own outside the list', () => {
  const style = buildVirtualRowStyle(240, { height: 101, topLine: false, bottomLine: true, corners: 'outer none step none' });
  assert.equal(style.top, '240px');
  assert.equal(style['--tree-row-height'], '101px');
  assert.equal(style['--tree-row-top-line'], '0px');
  assert.equal(style['--tree-row-bottom-line'], '1px');
  assert.equal(style['--tree-row-corners'], 'var(--tree-corner-outer) 0px var(--tree-corner-step) 0px');

  // Without its place in the list, the stylesheet draws the whole card: its own height, all four
  // lines and the card's corners.
  const alone = buildVirtualRowStyle(0);
  assert.equal(alone['--tree-row-height'], undefined);
  assert.equal(alone['--tree-row-corners'], undefined);
  assert.deepEqual([alone['--tree-row-top-line'], alone['--tree-row-bottom-line']], ['1px', '1px']);
});
