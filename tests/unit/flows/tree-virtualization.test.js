import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { file, openApp } from '../support/app.js';
import { collectVisibleRowIds, findCollapsibleRowIds, toggleDetailOverride } from '../../../src/lib/treeIndex.js';
import {
  buildVirtualRowLayout,
  buildVirtualRows,
  getRowMeasurementKey,
  mergeMeasuredHeights,
} from '../../../src/lib/treeLayout.js';

// Mirrors tests/tree-virtualization.spec.js.

const FILE_COUNT = 220;
const ARCHIVE_COUNT = 220;
const VIEWPORT_HEIGHT = 960;
const FILES_TOP = 1200;

let app;
afterEach(() => app?.close());

// A tree section as the page lays it out: its rows, collapsed rows, details and measured heights.
function treeSection(index) {
  return {
    index,
    collapsedIds: new Set(),
    detailOverrides: new Map(),
    measuredHeights: new Map(),
    get visibleRowIds() {
      return collectVisibleRowIds(index.rootIds, index.rowsById, this.collapsedIds);
    },
    get layout() {
      return buildVirtualRowLayout({
        rowIds: this.visibleRowIds,
        rowsById: index.rowsById,
        collapsedIds: this.collapsedIds,
        detailOverrides: this.detailOverrides,
        defaultDetailed: false,
        measuredHeights: this.measuredHeights,
      });
    },
    rendered(containerTop, scrollY) {
      return buildVirtualRows({ layout: this.layout, rowsById: index.rowsById, containerTop, scrollY, viewportHeight: VIEWPORT_HEIGHT })
        .items.map(({ rowId }) => index.rowsById.get(rowId))
        .map((row) => (row.type === 'archive' ? row.archive.title : row.node.name));
    },
    detailsVisible(rowId) {
      return this.detailOverrides.get(rowId) ?? false;
    },
    // A row reports its height after it renders, under its collapsed and details state.
    measure(rowId, height) {
      const key = getRowMeasurementKey(rowId, { collapsed: this.collapsedIds.has(rowId), detailsVisible: this.detailsVisible(rowId) });
      this.measuredHeights = mergeMeasuredHeights(this.measuredHeights, [[key, height]]);
    },
    // The space between a row and the next one.
    gapAfter(rowId, height) {
      const { offsets, rowIndexById } = this.layout;
      const index = rowIndexById.get(rowId);
      return offsets[index + 1] - offsets[index] - height;
    },
  };
}

test('virtualized filesystem and archive trees still behave correctly', async () => {
  app = await openApp('/');
  await app.upload(file('virtualization-smoke.json', buildLargeDatabase()));

  assert.equal(app.view.heading, 'virtualization_smoke');
  assert.ok(app.view.filesystemIndex, 'Files and folders');
  assert.ok(app.view.archivesIndex, 'Archives');

  const files = treeSection(app.view.filesystemIndex);
  const filesystemRows = files.rendered(FILES_TOP, FILES_TOP + 220);
  assert.ok(filesystemRows.length > 0);
  assert.ok(filesystemRows.length < FILE_COUNT);

  const firstFileRow = [...files.index.rowsById.values()].find((row) => row.node.name === 'file_000.rbf');
  // Files have no collapse button: they have no rows inside.
  assert.equal(firstFileRow.childIds.length, 0);

  // Show details shows the hash (an open row's details list), Hide details hides it, and the row
  // keeps the list's 13px gap at its measured height each time. Showing details again uses the
  // height measured with details right away.
  const showsHash = () =>
    files.detailsVisible(firstFileRow.id) &&
    !files.collapsedIds.has(firstFileRow.id) &&
    firstFileRow.node.details.some(({ label }) => label === 'MD5 HASH');
  for (const [detailsVisible, height, measuresAgain] of [
    [true, 412, true],
    [false, 151, true],
    [true, 412, false],
  ]) {
    files.detailOverrides = toggleDetailOverride(files.detailOverrides, firstFileRow.id, false);
    assert.equal(showsHash(), detailsVisible);
    if (measuresAgain) {
      files.measure(firstFileRow.id, height);
    }
    assert.equal(files.gapAfter(firstFileRow.id, height), 13);
  }

  const filesHeight = files.layout.totalHeight;
  const nearFilesBottom = FILES_TOP + filesHeight - VIEWPORT_HEIGHT * 0.75;
  assert.ok(files.rendered(FILES_TOP, nearFilesBottom).includes(`file_${pad(FILE_COUNT - 1)}.rbf`));

  const archives = treeSection(app.view.archivesIndex);
  const archivesTop = FILES_TOP + filesHeight + 200;
  const archiveSectionAtTop = archivesTop - 120;
  const archiveRows = archives.rendered(archivesTop, archiveSectionAtTop);
  assert.ok(archiveRows.includes('rom_000.bin'));
  assert.ok(archiveRows.length > 0);
  assert.ok(archiveRows.length < ARCHIVE_COUNT + 1);

  // Close all hides the archive's entries; Open all brings them back.
  archives.collapsedIds = new Set(findCollapsibleRowIds(archives.index));
  assert.ok(!archives.rendered(archivesTop, archiveSectionAtTop).includes('rom_000.bin'));
  archives.collapsedIds = new Set();
  assert.ok(archives.rendered(archivesTop, archiveSectionAtTop).includes('rom_000.bin'));

  // Closing the Files and folders section above moves the archives up under the same scroll; the
  // archive's first rows stay rendered.
  const archivesTopWithoutFiles = archivesTop - filesHeight;
  assert.ok(archives.rendered(archivesTopWithoutFiles, archiveSectionAtTop).includes('rom_000.bin'));

  const nearArchivesBottom = archivesTopWithoutFiles + archives.layout.totalHeight - VIEWPORT_HEIGHT * 0.75;
  assert.ok(archives.rendered(archivesTopWithoutFiles, nearArchivesBottom).includes(`rom_${pad(ARCHIVE_COUNT - 1)}.bin`));
});

function buildLargeDatabase() {
  const files = {};
  const archiveSummaryFiles = {};

  for (let index = 0; index < FILE_COUNT; index += 1) {
    const padded = pad(index);
    files[`games/TEST/file_${padded}.rbf`] = {
      size: 4096 + index,
      hash: `file-hash-${padded}`,
    };
  }

  for (let index = 0; index < ARCHIVE_COUNT; index += 1) {
    const padded = pad(index);
    archiveSummaryFiles[`games/TEST/archive/rom_${padded}.bin`] = {
      arc_id: 'bundle_assets',
      arc_at: `payload/rom_${padded}.bin`,
      size: 8192 + index,
      hash: `archive-hash-${padded}`,
    };
  }

  return {
    db_id: 'virtualization_smoke',
    v: 1,
    timestamp: 1710000000,
    base_files_url: 'https://example.com/base/',
    files,
    folders: {},
    archives: {
      bundle_assets: {
        description: 'Bundle assets',
        format: 'zip',
        extract: 'selective',
        target_folder: 'games/TEST/archive/',
        archive_file: {
          url: 'https://example.com/archive/bundle_assets.zip',
          size: 999999,
          hash: 'bundle-assets-hash',
        },
        summary_inline: {
          files: archiveSummaryFiles,
          folders: {},
        },
        base_files_url: 'https://example.com/archive/files/',
      },
    },
  };
}

function pad(value) {
  return String(value).padStart(3, '0');
}
