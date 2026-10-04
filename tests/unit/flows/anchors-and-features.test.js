import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import { file, openApp } from '../support/app.js';
import { findHoveredColumnDepth, findRowNearestTo, resolveGhostParent } from '../../../src/lib/ghostParent.js';
import { activateSectionAnchor, blurOnEnter } from '../../../src/lib/interactions.js';
import { collectVisibleRowIds, toggleDetailOverride } from '../../../src/lib/treeIndex.js';
import { buildVirtualRowLayout, buildVirtualRows } from '../../../src/lib/treeLayout.js';
import { buildNodeAnchor, parseNodeAnchor, readLink, writeLinkAnchor, writeLinkDetailed } from '../../../src/lib/urlState.js';

// Mirrors tests/anchors-and-features.spec.js.

const SMALL_DB = {
  db_id: 'anchor_test',
  v: 1,
  timestamp: 1710000000,
  base_files_url: 'https://example.com/base/',
  files: {
    'core_a.rbf': { size: 1024, hash: 'ha' },
    'core_b.rbf': { size: 2048, hash: 'hb' },
  },
  folders: {},
  archives: {
    test_archive: {
      description: 'Test archive',
      format: 'zip',
      extract: 'selective',
      target_folder: 'games/arc/',
      archive_file: { url: 'https://example.com/arc.zip', size: 9999, hash: 'ah' },
      summary_inline: {
        files: {
          'games/arc/rom_a.bin': { arc_id: 'test_archive', arc_at: 'rom_a.bin', size: 100, hash: 'ra' },
        },
        folders: {},
      },
      base_files_url: 'https://example.com/arc/files/',
    },
  },
};

let app;
afterEach(() => app?.close());

function rowNamed(index, name) {
  const row = [...index.rowsById.values()].find((candidate) =>
    candidate.type === 'archive' ? candidate.archive.title === name : candidate.node.name === name,
  );
  assert.ok(row, `no row named ${name}`);
  return row;
}

describe('node anchors', () => {
  test('anchor icons put file and archive rows in the URL hash, and other row clicks leave it alone', async () => {
    app = await openApp('/');
    await app.upload(file('test.json', SMALL_DB));
    assert.ok(app.view.files.includes('core_a.rbf'));

    const urlBefore = app.url;
    const fileRow = rowNamed(app.view.filesystemIndex, 'core_a.rbf');
    // Showing details only changes the row.
    assert.deepEqual([...toggleDetailOverride(new Map(), fileRow.id, false)], [[fileRow.id, true]]);
    assert.equal(app.url, urlBefore);

    const fileAnchor = buildNodeAnchor(fileRow);
    assert.equal(fileAnchor, 'files:core_a.rbf');
    writeLinkAnchor(fileAnchor);
    assert.equal(app.hash, '#at=files:core_a.rbf');
    assert.deepEqual(parseNodeAnchor(readLink().at), { section: 'filesystem', rowId: fileRow.id });

    const archiveRow = rowNamed(app.view.archivesIndex, 'test_archive');
    writeLinkAnchor(buildNodeAnchor(archiveRow));
    assert.equal(app.hash, '#at=archives:test_archive');
  });
});

describe('section anchors', () => {
  test('every section has an anchor that updates the URL hash and opens the section when collapsed', async () => {
    app = await openApp('/');
    await app.upload(file('test.json', SMALL_DB));
    assert.equal(app.view.heading, 'anchor_test');

    // The filter, files, archives and issues sections are all on the page.
    assert.ok(app.view.inspection);
    assert.ok(app.view.filesystemIndex);
    assert.ok(app.view.archivesIndex);
    assert.ok(Array.isArray(app.view.issues));

    const scrolls = [];
    const panel = (tagName, open) => ({ tagName, open, scrollIntoView: (options) => scrolls.push(options) });
    activateSectionAnchor({ anchor: 'filter', section: panel('DETAILS', true) });
    assert.equal(app.hash, '#at=filter');

    const issues = panel('DETAILS', false);
    activateSectionAnchor({ anchor: 'issues', section: issues });
    assert.equal(issues.open, true);
    assert.equal(app.hash, '#at=issues');
    assert.deepEqual(scrolls, [
      { block: 'start', behavior: 'smooth' },
      { block: 'start', behavior: 'smooth' },
    ]);
  });
});

describe('detailed in the link', () => {
  test('the detailed toggle adds and removes detailed in the link, which turns details on at load', async () => {
    app = await openApp('/');
    await app.upload(file('test.json', SMALL_DB));
    assert.equal(app.view.heading, 'anchor_test');

    assert.doesNotMatch(app.url, /detailed/);
    writeLinkDetailed(true);
    assert.equal(app.hash, '#detailed');
    assert.equal(readLink().detailed, true);

    writeLinkDetailed(false);
    assert.doesNotMatch(app.url, /detailed/);
    assert.equal(readLink().detailed, false);

    app.close();
    app = await openApp('/#detailed');
    await app.upload(file('test.json', SMALL_DB));
    assert.equal(app.view.heading, 'anchor_test');

    // Every row shows its details unless toggled, starting with the first one.
    const detailed = readLink().detailed;
    assert.equal(detailed, true);
    const firstRow = app.view.filesystemIndex.rowsById.get(app.view.filesystemIndex.rootIds[0]);
    assert.equal(new Map().get(firstRow.id) ?? detailed, true);
    assert.ok(firstRow.node.details.some(({ label }) => label === 'MD5 HASH'));
  });
});

describe('filter enter key', () => {
  test('pressing Enter in FILTER blurs it without inserting a newline', async () => {
    app = await openApp('/');
    await app.upload(file('test.json', SMALL_DB));
    await app.typeFilter('hello');

    const calls = [];
    const keyDown = (key) => ({
      key,
      preventDefault: () => calls.push(`${key}: preventDefault`),
      target: { blur: () => calls.push(`${key}: blur`) },
    });
    assert.equal(blurOnEnter(keyDown('a')), false);
    assert.equal(blurOnEnter(keyDown('Enter')), true);
    assert.deepEqual(calls, ['Enter: preventDefault', 'Enter: blur']);
    assert.equal(app.filter, 'hello');
  });
});

describe('ghost parent', () => {
  const VIEWPORT_HEIGHT = 960;
  const ROOT_FONT_SIZE = 16;
  const TREE_TOP = 300;

  function buildDeepDatabase() {
    const files = {};
    for (let i = 0; i < 100; i++) {
      files[`games/deep/folder/file_${String(i).padStart(3, '0')}.rbf`] = {
        size: 1024 + i,
        hash: `h${i}`,
      };
    }
    return {
      db_id: 'ghost_test',
      v: 1,
      timestamp: 1,
      base_files_url: 'https://example.com/',
      files,
      folders: { 'games/': {}, 'games/deep/': {}, 'games/deep/folder/': {} },
    };
  }

  // The tree as the page lays it out, and what hovering it at (x, y) in the viewport shows.
  function hoverTree(scrollY, pointer) {
    const { rootIds, rowsById } = app.view.filesystemIndex;
    const visibleRowIds = collectVisibleRowIds(rootIds, rowsById, new Set());
    const layout = buildVirtualRowLayout({
      rowIds: visibleRowIds,
      rowsById,
      collapsedIds: new Set(),
      detailOverrides: new Map(),
      defaultDetailed: false,
      measuredHeights: new Map(),
    });
    const rendered = buildVirtualRows({ layout, rowsById, containerTop: TREE_TOP, scrollY, viewportHeight: VIEWPORT_HEIGHT });
    const renderedIds = rendered.items.map(({ rowId }) => rowId);
    const measureRow = (rowId) => {
      if (!renderedIds.includes(rowId)) {
        return null;
      }
      const index = layout.rowIndexById.get(rowId);
      return { top: TREE_TOP + layout.offsets[index] - scrollY, bottom: TREE_TOP + layout.bottoms[index] - scrollY };
    };
    const hoveredDepth = findHoveredColumnDepth(pointer.x, ROOT_FONT_SIZE);
    const targetRowId = hoveredDepth < 0 ? null : findRowNearestTo(renderedIds, pointer.y, measureRow);
    const ghost = resolveGhostParent({
      hoveredDepth,
      targetRow: targetRowId === null ? null : rowsById.get(targetRowId),
      rowsById,
      visibleRowIds,
      bottoms: layout.bottoms,
      ancestorTopOf: (ancestor) => measureRow(ancestor.id)?.top ?? -100,
    });
    return { ghost, layout, renderedIds, measureRow, rowsById };
  }

  test('ghost does not appear when parent is visible', async () => {
    app = await openApp('/');
    await app.upload(file('ghost.json', buildDeepDatabase()));
    assert.equal(app.view.heading, 'ghost_test');

    const { ghost } = hoverTree(0, { x: 10, y: TREE_TOP + 50 });
    assert.deepEqual(ghost, { ghostParentId: null, hoveredColumnDepth: -1, columnLineBottom: null });
  });

  test('ghost click jumps to the parent row without changing the URL hash', async () => {
    app = await openApp('/');
    await app.upload(file('ghost.json', buildDeepDatabase()));
    assert.equal(app.view.heading, 'ghost_test');

    // Scrolled to the bottom, hovering the outermost indentation column shows its folder (games),
    // scrolled out of view, as a ghost row.
    const { layout } = hoverTree(0, { x: 10, y: 0 });
    const bottom = TREE_TOP + layout.totalHeight - VIEWPORT_HEIGHT;
    const { ghost, renderedIds, measureRow, rowsById } = hoverTree(bottom, { x: 10, y: VIEWPORT_HEIGHT / 2 });
    assert.equal(rowsById.get(ghost.ghostParentId)?.node.name, 'games');
    assert.equal(ghost.hoveredColumnDepth, 0);
    assert.equal(ghost.columnLineBottom, layout.totalHeight);

    // The ghost row's folder stays rendered above the window, so the click scrolls it into view at
    // the top of the viewport; it does not touch the address.
    const urlBefore = app.url;
    assert.ok(renderedIds.includes(ghost.ghostParentId));
    const gamesTop = measureRow(ghost.ghostParentId).top;
    const afterClick = hoverTree(bottom + gamesTop, { x: 10, y: 0 });
    assert.equal(afterClick.measureRow(ghost.ghostParentId).top, 0);
    assert.equal(app.url, urlBefore);
  });
});
