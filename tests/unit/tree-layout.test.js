import assert from 'node:assert/strict';
import test from 'node:test';

import { loadDatabaseSourceFile } from '../../src/lib/database.js';
import { buildFlatNodeIndex, collectVisibleRowIds } from '../../src/lib/treeIndex.js';
import {
  buildVirtualRowLayout,
  buildVirtualRowStyle,
  buildVirtualRows,
  estimateRowHeight,
  getMeasurementScrollDelta,
  getRowMeasurementKey,
  getViewportAnchorOffsetDelta,
  mergeMeasuredHeights,
  rowOutline,
  rowTagsHidden,
  updateVirtualRowLayout,
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

test('on a narrow screen a file leaves its tags to its details, unless all of them were asked for or hold the find-in-page match; folders and archives keep theirs', async () => {
  const index = await filesystemIndex({ 'games/a.rbf': { tags: ['arcade'] } }, { games: { tags: ['arcade'] } });
  const [folder, file] = [...index.rowsById.values()];
  assert.equal(file.node.kind, 'file');
  const hidden = (row, state = {}) => rowTagsHidden(row, { narrow: true, detailsVisible: false, tagsExpanded: false, ...state });
  assert.equal(hidden(file), true);
  assert.equal(hidden(file, { narrow: false }), false);
  assert.equal(hidden(file, { detailsVisible: true }), false);
  assert.equal(hidden(file, { tagsExpanded: true }), false);
  assert.equal(hidden(folder), false);
  assert.equal(hidden({ id: 'archive:pack', type: 'archive', archive: {} }), false);
  assert.equal(hidden(undefined), false);
  // Measured apart on each screen: a height measured on one is not one measured on another.
  const keys = ['wide', 'narrow', 'phone'].map((screen) => getRowMeasurementKey(file.id, { collapsed: false, detailsVisible: false, screen }));
  assert.equal(new Set(keys).size, 3);
  assert.equal(getRowMeasurementKey(file.id, { collapsed: false, detailsVisible: false }), keys[0]);
});

test('the list places a row with the height measured on the screen it is on, and anchors the scroll with it', async () => {
  const index = await filesystemIndex({ 'games/a.rbf': { tags: ['arcade'] }, 'games/b.rbf': { tags: ['arcade'] } }, { games: { tags: ['arcade'] } });
  const rowIds = collectVisibleRowIds(index.rootIds, index.rowsById, new Set());
  const [folderId, fileId] = rowIds;
  const key = (rowId, screen, detailsVisible = false) => getRowMeasurementKey(rowId, { collapsed: false, detailsVisible, screen });
  // The folder and the first file measured on a wide screen and a narrow one; the last file on neither.
  const measuredHeights = new Map([
    [key(folderId, 'wide'), 104],
    [key(folderId, 'narrow'), 146],
    [key(fileId, 'wide'), 101],
    [key(fileId, 'narrow'), 71],
    [key(fileId, 'narrow', true), 300],
  ]);
  const layout = (screen, detailOverrides = new Map()) =>
    buildVirtualRowLayout({ rowIds, rowsById: index.rowsById, collapsedIds: new Set(), detailOverrides, defaultDetailed: false, measuredHeights, screen });
  assert.deepEqual(layout('wide').bottoms, [104, 205, 328]);
  assert.deepEqual(layout('narrow').bottoms, [146, 217, 340]);
  assert.equal(layout('narrow', new Map([[fileId, true]])).bottoms[1], 446);
  // On a phone, nothing measured yet: a folder's and a file's estimates there.
  assert.deepEqual(layout('phone').bottoms, [92, 152, 212]);

  // A file above the viewport measured again on a narrow screen moves the rows below by its change.
  const nextMeasuredHeights = new Map([...measuredHeights, [key(fileId, 'narrow'), 81]]);
  const delta = (screen) =>
    getMeasurementScrollDelta({
      rowIds,
      rowsById: index.rowsById,
      collapsedIds: new Set(),
      detailOverrides: new Map(),
      defaultDetailed: false,
      screen,
      currentMeasuredHeights: measuredHeights,
      nextMeasuredHeights,
      viewportTop: 250,
    });
  assert.equal(delta('narrow'), 10);
  assert.equal(delta('wide'), 0);
});

// What the page reads of a layout.
function layoutParts(layout) {
  const { rowIds, rowIndexById, offsets, bottoms, totalHeight } = layout;
  return { rowIds, rowIndexById: [...rowIndexById], offsets, bottoms, totalHeight };
}

// The same numbers on every run, so that a failing batch can be replayed.
function seededRandom(seed) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

test('a batch of measured heights updates the layout as building it again would, and anchors the scroll as before', async () => {
  const folders = ['games', 'games/arcade', 'docs'];
  const files = Object.fromEntries(Array.from({ length: 40 }, (_, at) => [`${folders[at % 3]}/file:${at}.rbf`, { tags: ['arcade'] }]));
  const index = await filesystemIndex(files, Object.fromEntries(folders.map((folder) => [folder, {}])));
  const allRowIds = [...index.rowsById.keys()];
  const docsId = allRowIds.find((rowId) => index.rowsById.get(rowId).node.name === 'docs');
  // docs is collapsed: heights measured for its files change nothing.
  const collapsedIds = new Set([docsId]);
  const rowIds = collectVisibleRowIds(index.rootIds, index.rowsById, collapsedIds);
  const state = {
    rowIds,
    rowsById: index.rowsById,
    collapsedIds,
    detailOverrides: new Map([[rowIds[3], true], [rowIds[5], false]]),
    defaultDetailed: false,
    expandedTagIds: new Set([rowIds[4]]),
    screen: 'narrow',
  };
  const random = seededRandom(7);
  const pick = (values) => values[Math.floor(random() * values.length)];
  // A key for a row in the state it shows, or in another one, as rows measured before a toggle.
  const keyFor = (rowId) =>
    getRowMeasurementKey(
      rowId,
      random() < 0.7
        ? {
            collapsed: collapsedIds.has(rowId),
            detailsVisible: state.detailOverrides.get(rowId) ?? state.defaultDetailed,
            tagsExpanded: state.expandedTagIds.has(rowId),
            screen: state.screen,
          }
        : { collapsed: random() < 0.5, detailsVisible: random() < 0.5, tagsExpanded: random() < 0.5, screen: pick(['wide', 'narrow', 'phone']) },
    );

  let measuredHeights = new Map();
  let layout = buildVirtualRowLayout({ ...state, measuredHeights });
  const estimated = layoutParts(layout);
  for (let batch = 0; batch < 80; batch += 1) {
    const entries = Array.from({ length: 1 + Math.floor(random() * 6) }, () => {
      const key = keyFor(pick(allRowIds));
      // Now and then the height a row already has, which changes nothing; tenths add up exactly as
      // the build adds them.
      return [key, measuredHeights.has(key) && random() < 0.2 ? measuredHeights.get(key) : 40 + Math.floor(random() * 4000) / 10];
    });
    const nextMeasuredHeights = mergeMeasuredHeights(measuredHeights, entries);
    const updated = updateVirtualRowLayout(layout, { ...state, measuredHeights: nextMeasuredHeights });
    const built = buildVirtualRowLayout({ ...state, measuredHeights: nextMeasuredHeights });
    assert.deepEqual(layoutParts(updated), layoutParts(built), `batch ${batch}`);

    const viewportTop = random() * built.totalHeight;
    assert.equal(
      getMeasurementScrollDelta({ ...state, currentMeasuredHeights: measuredHeights, nextMeasuredHeights, viewportTop, currentLayout: layout }),
      getViewportAnchorOffsetDelta({ currentLayout: buildVirtualRowLayout({ ...state, measuredHeights }), nextLayout: built, viewportTop }),
      `batch ${batch}`,
    );
    layout = updated;
    measuredHeights = nextMeasuredHeights;
  }
  assert.notDeepEqual(layoutParts(layout).bottoms, estimated.bottoms, 'the batches changed the layout');
});

test('a batch of measured heights reads only the rows it measured, however long the list', async () => {
  const files = Object.fromEntries(Array.from({ length: 500 }, (_, at) => [`games/file_${at}.rbf`, {}]));
  const index = await filesystemIndex(files, { games: {} });
  const rowIds = collectVisibleRowIds(index.rootIds, index.rowsById, new Set());
  // Counts the rows the layout reads.
  class CountedSet extends Set {
    reads = 0;

    has(value) {
      this.reads += 1;
      return super.has(value);
    }
  }
  const collapsedIds = new CountedSet();
  const state = { rowIds, rowsById: index.rowsById, collapsedIds, detailOverrides: new Map(), defaultDetailed: false, expandedTagIds: new Set(), screen: 'wide' };
  const key = (rowId) => getRowMeasurementKey(rowId, { collapsed: false, detailsVisible: false });
  const measuredHeights = new Map();
  const layout = buildVirtualRowLayout({ ...state, measuredHeights });
  assert.equal(collapsedIds.reads, rowIds.length);

  // Two files measured while scrolling, 33px and 13px shorter than their estimates.
  const nextMeasuredHeights = mergeMeasuredHeights(measuredHeights, [[key(rowIds[250]), 90], [key(rowIds[300]), 110]]);
  collapsedIds.reads = 0;
  const updated = updateVirtualRowLayout(layout, { ...state, measuredHeights: nextMeasuredHeights });
  assert.equal(collapsedIds.reads, 2);
  assert.deepEqual(layoutParts(updated), layoutParts(buildVirtualRowLayout({ ...state, measuredHeights: nextMeasuredHeights })));

  // Anchoring the scroll reads them only too, from the layout the page shows.
  collapsedIds.reads = 0;
  const delta = getMeasurementScrollDelta({ ...state, currentMeasuredHeights: measuredHeights, nextMeasuredHeights, viewportTop: 50_000, currentLayout: layout });
  assert.equal(delta, -46);
  assert.equal(collapsedIds.reads, 2);
});

test('a layout is built again when it cannot be updated from the one before', async () => {
  const index = await filesystemIndex({ 'games/a.rbf': {}, 'games/b.rbf': {}, 'games/c.rbf': {} }, { games: {} });
  const rowIds = collectVisibleRowIds(index.rootIds, index.rowsById, new Set());
  const state = { rowIds, rowsById: index.rowsById, collapsedIds: new Set(), detailOverrides: new Map(), defaultDetailed: false };
  const key = (rowId) => getRowMeasurementKey(rowId, { collapsed: false, detailsVisible: false });
  const measuredHeights = mergeMeasuredHeights(new Map(), [[key(rowIds[0]), 100]]);
  const layout = buildVirtualRowLayout({ ...state, measuredHeights });
  const assertAsBuilt = (source) =>
    assert.deepEqual(layoutParts(updateVirtualRowLayout(layout, source)), layoutParts(buildVirtualRowLayout(source)));

  // Other rows, or rows shown otherwise, with heights merged into the layout's.
  const once = mergeMeasuredHeights(measuredHeights, [[key(rowIds[1]), 90]]);
  assertAsBuilt({ ...state, rowIds: rowIds.slice(1), measuredHeights: once });
  assertAsBuilt({ ...state, detailOverrides: new Map([[rowIds[1], true]]), measuredHeights: once });
  assertAsBuilt({ ...state, defaultDetailed: true, measuredHeights: once });
  assertAsBuilt({ ...state, screen: 'phone', measuredHeights: once });
  // Heights merged twice since the layout was built: both batches apply.
  const twice = mergeMeasuredHeights(once, [[key(rowIds[2]), 80]]);
  assertAsBuilt({ ...state, measuredHeights: twice });
  // Heights that were not merged into the layout's.
  assertAsBuilt({ ...state, measuredHeights: new Map([...measuredHeights, [key(rowIds[3]), 70]]) });
  // The same arguments: the same layout.
  assert.equal(updateVirtualRowLayout(layout, { ...state, measuredHeights }), layout);
});

test('on a phone, a file or folder without its details is estimated as its name and a folder’s line of tags, in the proportions of a wide screen', async () => {
  const index = await filesystemIndex({ 'games/a.rbf': { tags: ['arcade'] } }, { games: { tags: ['arcade'] } });
  const [folder, file] = [...index.rowsById.values()];
  const estimate = (row, state = {}) => estimateRowHeight(row, { collapsed: false, detailsVisible: false, screen: 'phone', ...state });
  assert.deepEqual([estimate(folder), estimate(file), estimate(file, { collapsed: true })], [92, 60, 60]);
  // With their details, and on wider screens, as before.
  assert.equal(estimate(file, { detailsVisible: true }), estimateRowHeight(file, { collapsed: false, detailsVisible: true }));
  for (const screen of ['wide', 'narrow']) {
    assert.deepEqual([estimate(folder, { screen }), estimate(file, { screen }), estimate(file, { screen, collapsed: true })], [104, 123, 86]);
  }
  // Archives as before.
  const archive = { type: 'archive', childIds: ['x'], archive: { issues: [] } };
  assert.equal(estimate(archive), estimateRowHeight(archive, { collapsed: false, detailsVisible: false }));
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
