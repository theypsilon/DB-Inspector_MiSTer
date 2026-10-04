import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import { file, openApp } from '../support/app.js';
import { collectVisibleRowIds } from '../../../src/lib/treeIndex.js';
import {
  buildVirtualRowLayout,
  buildVirtualRows,
  estimateRowHeight,
  getMeasurementScrollDelta,
  getRowMeasurementKey,
  mergeMeasuredHeights,
  shouldApplyScrollAnchor,
  shouldDeferRowMeasurement,
} from '../../../src/lib/treeLayout.js';

// Mirrors tests/real-db-scroll.spec.js, which scrolls the live Distribution_MiSTer database in
// Chrome. Here a database shaped like it (thousands of pixels of detailed rows, with riscos.rom
// followed by the Astrocade and ATARI folders) is scrolled through the steps the virtual tree takes
// (useVirtualRowWindow): rendered rows report their real heights, which apply on the next frame,
// or once the page has stopped scrolling for 120ms when a row that had a height changes it while
// scrolling; each batch of heights scrolls the page so that the row at the top of the viewport
// stays put. Real heights differ from the estimates, as they do in the browser.

const VIEWPORT_HEIGHT = 960;
const TREE_TOP = 1500;
const FRAME_MS = 16;
const SCROLL_IDLE_MS = 120;
const BEYOND_RISCOS_MARGIN = 300;
const NO_ROWS = new Set();
const NO_DETAILS = new Map();

let app;
afterEach(() => app?.close());

// A row's height in the page: its estimate give or take up to a fifth, depending on its content.
function realHeight(row) {
  const estimate = estimateRowHeight(row, { collapsed: false, detailsVisible: true });
  const text = row.node.path ?? row.node.name;
  const spread = [...text].reduce((sum, character) => (sum * 31 + character.charCodeAt(0)) % 997, 7) % 81;
  return estimate + Math.round(((spread - 40) / 200) * estimate);
}

// The detailed filesystem tree (every folder open, details shown) under a scrolling viewport.
function createDetailedTree(index) {
  const { rowsById } = index;
  const rowIds = collectVisibleRowIds(index.rootIds, rowsById, NO_ROWS);
  const tree = {
    scrollY: 0,
    // How far the wheel has scrolled, apart from the page's own scrolling.
    wheelY: 0,
    measured: new Map(),
    pending: new Map(),
    scrolling: false,
    idleAt: null,
    flushRequested: false,
    time: 0,
  };
  const layoutFor = (measuredHeights) =>
    buildVirtualRowLayout({
      rowIds,
      rowsById,
      collapsedIds: NO_ROWS,
      detailOverrides: NO_DETAILS,
      defaultDetailed: true,
      measuredHeights,
    });

  function scrollTo(y) {
    const next = Math.max(0, y);
    if (next !== tree.scrollY) {
      tree.scrollY = next;
      tree.scrolling = true;
      tree.idleAt = tree.time + SCROLL_IDLE_MS;
    }
  }

  function flush() {
    tree.flushRequested = false;
    const entries = [...tree.pending];
    tree.pending.clear();
    const next = mergeMeasuredHeights(tree.measured, entries);
    if (next === tree.measured) {
      return;
    }

    const delta = getMeasurementScrollDelta({
      rowIds,
      rowsById,
      collapsedIds: NO_ROWS,
      detailOverrides: NO_DETAILS,
      defaultDetailed: true,
      currentMeasuredHeights: tree.measured,
      nextMeasuredHeights: next,
      viewportTop: Math.max(0, tree.scrollY - TREE_TOP),
    });
    tree.measured = next;
    if (shouldApplyScrollAnchor(delta, { touchDevice: false, suppressed: false })) {
      scrollTo(tree.scrollY + delta);
    }
  }

  function renderedRows() {
    const layout = layoutFor(tree.measured);
    return buildVirtualRows({ layout, rowsById, containerTop: TREE_TOP, scrollY: tree.scrollY, viewportHeight: VIEWPORT_HEIGHT })
      .items.map(({ rowId, top }) => ({ rowId, name: rowsById.get(rowId).node.name, top: TREE_TOP + top - tree.scrollY }));
  }

  // One animation frame: the heights reported last frame apply, then the rows rendered at the
  // current scroll report theirs.
  function frame(heightOf) {
    if (tree.flushRequested) {
      flush();
    }

    for (const { rowId } of renderedRows()) {
      const key = getRowMeasurementKey(rowId, { collapsed: false, detailsVisible: true });
      const height = heightOf(rowsById.get(rowId));
      if (tree.measured.get(key) === height || tree.pending.get(key) === height) {
        continue;
      }

      const hadMeasuredHeight = tree.measured.has(key);
      tree.pending.set(key, height);
      if (!shouldDeferRowMeasurement({ scrolling: tree.scrolling, hadMeasuredHeight })) {
        tree.flushRequested = true;
      }
    }
  }

  return {
    get scrollY() {
      return tree.scrollY;
    },
    get wheelY() {
      return tree.wheelY;
    },
    scrollTo,
    wheel(deltaY) {
      tree.wheelY += deltaY;
      scrollTo(tree.scrollY + deltaY);
    },
    // Lets `ms` pass, frame by frame, calling `onFrame` after each. `heightOf` gives the rows' real
    // heights at that time.
    advance(ms, { onFrame, heightOf = realHeight } = {}) {
      const end = tree.time + ms;
      while (tree.time < end) {
        tree.time = Math.min(end, tree.time + FRAME_MS);
        if (tree.idleAt !== null && tree.time >= tree.idleAt) {
          tree.idleAt = null;
          tree.scrolling = false;
          flush();
        }
        frame(heightOf);
        onFrame?.();
      }
    },
    // The rows whose top is inside the viewport, top first.
    visibleRows: () => renderedRows().filter(({ top }) => top >= 0 && top < VIEWPORT_HEIGHT),
    rendered: (name) => renderedRows().some((row) => row.name === name),
    rowTop: (name) => renderedRows().find((row) => row.name === name)?.top ?? null,
    estimatedOffset(name) {
      const layout = layoutFor(tree.measured);
      const rowId = rowIds.find((id) => rowsById.get(id).node.name === name);
      return layout.offsets[layout.rowIndexById.get(rowId)];
    },
  };
}

// Opens the filesystem section scrolled to its top, with details shown and every folder open.
async function openDetailedFilesystem() {
  app = await openApp('/');
  await app.upload(file('distribution.json', buildDistributionLikeDatabase()));
  assert.equal(app.view.heading, 'distribution_like');
  const tree = createDetailedTree(app.view.filesystemIndex);
  tree.scrollTo(TREE_TOP - 120);
  tree.advance(300 + 300 + 1_200);
  return tree;
}

// Samples the first of `names` that is rendered on every frame, as the end-to-end trace does.
function traceAnchor(tree, names) {
  const samples = [];
  const onFrame = () => {
    const name = names.find((candidate) => tree.rendered(candidate)) ?? null;
    samples.push({ y: tree.scrollY, wheelY: tree.wheelY, name, top: name === null ? null : tree.rowTop(name) });
  };
  return { samples, onFrame };
}

// Whether a row seen on two consecutive frames jumped: it moved on screen by more than 40px while
// the page did not scroll, as the end-to-end trace flags, or by more than 40px beyond what the
// wheel scrolled, as when the page scrolls the wrong way to keep rows in place.
function jumped(previous, sample, previousTop, sampleTop) {
  const scrollDelta = sample.y - previous.y;
  const layoutDrift = sampleTop - previousTop + scrollDelta;
  const screenMove = sampleTop - previousTop + (sample.wheelY - previous.wheelY);
  return (Math.abs(scrollDelta) <= 2 && Math.abs(layoutDrift) > 40) || Math.abs(screenMove) > 40;
}

// The frames where the traced row jumped.
function findJumps(samples) {
  const jumps = [];
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const sample = samples[index];
    if (previous.name === null || previous.name !== sample.name || previous.top === null || sample.top === null) {
      continue;
    }

    if (jumped(previous, sample, previous.top, sample.top)) {
      jumps.push({ index, name: sample.name, from: previous, to: sample });
    }
  }
  return jumps;
}

describe('real database upward scroll regression', () => {
  test('detailed filesystem wheel-up scrolling does not snap back', async () => {
    const tree = await openDetailedFilesystem();
    tree.scrollTo(TREE_TOP + 9000);
    tree.advance(800);

    const anchorNames = tree.visibleRows().slice(0, 3).map(({ name }) => name);
    assert.equal(anchorNames.length, 3);
    const { samples, onFrame } = traceAnchor(tree, anchorNames);
    for (let step = 0; step < 8; step += 1) {
      tree.wheel(-220);
      tree.advance(60, { onFrame });
    }
    tree.advance(1_400 - 8 * 60, { onFrame });

    assert.ok(samples.some(({ name }) => name !== null));
    assert.deepEqual(findJumps(samples), []);
  });

  test('detailed filesystem wheel-up scrolling responds promptly after jumping beyond riscos.rom', async () => {
    const riscosOffset = (await openDetailedFilesystem()).estimatedOffset('riscos.rom');
    app.close();

    const tree = await openDetailedFilesystem();
    tree.scrollTo(TREE_TOP + riscosOffset + BEYOND_RISCOS_MARGIN);
    tree.advance(30);
    assert.ok(tree.rendered('riscos.rom'));

    for (const delta of [-80, -140, -260, -120, -320, -90, -220, -160]) {
      const before = tree.scrollY;
      tree.wheel(delta);
      tree.advance(16);
      tree.advance(48);
      const after64 = tree.scrollY;
      tree.advance(120);
      const after184 = tree.scrollY;
      assert.ok(after64 < before - 20, `step ${delta}: ${before} -> ${after64} after 64ms`);
      assert.ok(after184 < before - 20, `step ${delta}: ${before} -> ${after184} after 184ms`);
    }
  });

  test('detailed filesystem wheel-up scrolling does not reposition visible rows after jumping beyond riscos.rom', async () => {
    const riscosOffset = (await openDetailedFilesystem()).estimatedOffset('riscos.rom');
    app.close();

    const tree = await openDetailedFilesystem();
    tree.scrollTo(TREE_TOP + riscosOffset + BEYOND_RISCOS_MARGIN);
    tree.advance(30);
    assert.ok(tree.rendered('riscos.rom'));
    assert.ok(tree.rendered('Astrocade'));

    const { samples, onFrame } = traceAnchor(tree, ['Astrocade', 'ATARI5200', 'Atari2600']);
    const deltas = [-80, -140, -260, -120, -320, -90, -220, -160, -280, -110];
    const waits = [80, 70, 60, 70, 60, 90, 70, 90, 60, 100];
    deltas.forEach((delta, step) => {
      tree.wheel(delta);
      tree.advance(waits[step], { onFrame });
    });
    tree.advance(2_200 - waits.reduce((sum, wait) => sum + wait, 0), { onFrame });

    assert.ok(samples.some(({ name }) => name !== null));
    assert.deepEqual(findJumps(samples), []);
  });

  test('detailed filesystem wheel-down scrolling does not leave deferred visible-row jumps', async () => {
    const tree = await openDetailedFilesystem();

    // Rows that come into view while scrolling down are measured right away, not when the scroll
    // stops, so none of them moves once it is on screen.
    const samples = [];
    const onFrame = () => samples.push({ y: tree.scrollY, wheelY: tree.wheelY, rows: tree.visibleRows().slice(0, 4) });
    for (let step = 0; step < 10; step += 1) {
      tree.wheel(220);
      tree.advance(60, { onFrame });
    }
    tree.advance(2_200 - 10 * 60, { onFrame });

    const jumps = [];
    for (let index = 1; index < samples.length; index += 1) {
      const previous = samples[index - 1];
      const sample = samples[index];
      for (const previousRow of previous.rows) {
        const nextRow = sample.rows.find((row) => row.name === previousRow.name);
        if (!nextRow) {
          continue;
        }

        if (jumped(previous, sample, previousRow.top, nextRow.top)) {
          jumps.push({ index, name: previousRow.name, from: previousRow.top, to: nextRow.top });
        }
      }
    }
    assert.ok(samples.some(({ rows }) => rows.length));
    assert.deepEqual(jumps, []);
  });
});

// Folders and detailed files in the order Distribution_MiSTer has them: plenty of rows before
// games/Archie/riscos.rom, then the Astrocade and ATARI folders.
function buildDistributionLikeDatabase() {
  const files = {};
  const folders = {};
  const add = (folder, names) => {
    folders[folder] = {};
    names.forEach((name, index) => {
      files[`${folder}/${name}`] = { size: 1000 + index, hash: `${folder}/${name}`.padEnd(32, '0').slice(0, 32), tags: [0] };
    });
  };
  const numbered = (prefix, count, extension) =>
    Array.from({ length: count }, (_, index) => `${prefix}_${String(index).padStart(3, '0')}.${extension}`);

  add('_Arcade', numbered('Arcade', 40, 'mra'));
  add('_Arcade/cores', numbered('arcade_core', 30, 'rbf'));
  add('_Computer', numbered('Computer', 30, 'rbf'));
  add('_Console', numbered('Console', 30, 'rbf'));
  add('games', []);
  add('games/Archie', ['riscos.rom', 'boot.rom']);
  add('games/Astrocade', numbered('astrocade', 12, 'bin'));
  add('games/Atari2600', numbered('a2600', 12, 'bin'));
  add('games/ATARI5200', numbered('a5200', 12, 'bin'));
  add('games/NES', numbered('nes', 40, 'nes'));
  return {
    db_id: 'distribution_like',
    v: 1,
    timestamp: 1710000000,
    base_files_url: 'https://example.com/distribution/',
    tag_dictionary: { cores: 0 },
    files,
    folders,
  };
}
