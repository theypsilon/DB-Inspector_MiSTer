import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import { file, openApp } from '../support/app.js';
import { createRowFlash } from '../../../src/lib/rowFlash.js';
import { formatBytes } from '../../../src/lib/database.js';
import { filterHelpClauses } from '../../../src/lib/filterHelp.js';
import { nextInfoHintOpen } from '../../../src/lib/interactions.js';
import { findSearchMatches, nextMatchIndex } from '../../../src/lib/search.js';
import { collectVisibleRowIds, findAncestorIds } from '../../../src/lib/treeIndex.js';
import {
  buildVirtualRowLayout,
  buildVirtualRows,
  estimateRowHeight,
  getMeasurementScrollDelta,
  getRemainingScrollAnchorDelta,
  getRowJumpScrollTop,
  getRowMeasurementKey,
  mergeMeasuredHeights,
  shouldApplyScrollAnchor,
} from '../../../src/lib/treeLayout.js';
import { parseNodeAnchor } from '../../../src/lib/urlState.js';
import {
  CLUSTER_SIZE_OPTIONS,
  CLUSTER_SIZE_TIP,
  DEFAULT_CLUSTER_SIZE_BYTES,
  buildRawByteHoverCopy,
  extractGitHubRepo,
} from '../../../src/lib/utils.js';
import { buildStorageSummary } from '../../../src/model/views.js';

// Mirrors tests/load-flows.spec.js.

const ENTRY_WITH_FILTER_URL = 'https://example.com/flows-entry-with-filter.json';
const ENTRY_WITHOUT_FILTER_URL = 'https://example.com/flows-entry-without-filter.json';

const MULTI_ENTRY_INI = `[MiSTer]
filter=ini-list-default

[WithFilter]
db_url=${ENTRY_WITH_FILTER_URL}
filter=arcade [mister]

[WithoutFilter]
db_url=${ENTRY_WITHOUT_FILTER_URL}
`;

const ROUTES = {
  [ENTRY_WITH_FILTER_URL]: { body: buildDatabase('with_filter_db') },
  [ENTRY_WITHOUT_FILTER_URL]: { body: buildDatabase('without_filter_db') },
};

let app;
afterEach(() => app?.close());

async function uploadDatabaseWithFilter(filter) {
  await app.upload(file('current.json', buildDatabase('current_db')));
  assert.equal(app.view.heading, 'current_db');
  await app.typeFilter(filter);
  assert.equal(app.filter, filter);
}

// A database list's picker starts with every database selected; these flows open just one.
async function openOnly(dbId) {
  const picker = app.openChoice();
  assert.equal(picker.toggleAllLabel, 'Select none');
  picker.toggleAll();
  picker.check(dbId);
  assert.equal(picker.openLabel, 'Open selected database');
  await picker.open();
}

describe('INI list picker', () => {
  test('asks before replacing a non-empty FILTER and applies the entry filter when accepted', async () => {
    app = await openApp('/', { routes: ROUTES });
    await uploadDatabaseWithFilter('manual !keep');
    await app.upload(file('downloader.ini', MULTI_ENTRY_INI));

    // The list's picker opens first; combining is asked once its databases are chosen.
    assert.equal(app.state.choicePickerOpen, true);
    assert.equal(app.view.choice.title, 'Choose databases from this list');
    await openOnly('WithFilter');
    await app.loadAlone();

    assert.equal(app.prompt.kind, 'filterOverride');
    assert.equal(app.prompt.currentFilter, 'manual !keep');
    assert.equal(app.prompt.nextFilter, 'arcade ini-list-default');
    await app.answer('filterOverride', true);

    assert.equal(app.view.heading, 'with_filter_db');
    assert.equal(app.filter, 'arcade ini-list-default');
    await app.pause();
    assert.ok(app.url.includes(`database-url=${encodeURIComponent(ENTRY_WITH_FILTER_URL)}`), app.url);
    assert.doesNotMatch(app.url, /filter=/);
  });

  test('keeps the current FILTER when the replacement is declined', async () => {
    app = await openApp('/', { routes: ROUTES });
    await uploadDatabaseWithFilter('manual !keep');
    await app.upload(file('downloader.ini', MULTI_ENTRY_INI));

    await openOnly('WithFilter');
    await app.loadAlone();
    assert.equal(app.prompt.kind, 'filterOverride');
    await app.answer('filterOverride', false);

    assert.equal(app.view.heading, 'with_filter_db');
    assert.equal(app.filter, 'manual !keep');
    await app.pause();
    assert.ok(app.url.includes(`filter=${encodeURIComponent('manual !keep')}`), app.url);
  });

  test('opens entries without their own filter while keeping the current FILTER without asking', async () => {
    app = await openApp('/', { routes: ROUTES });
    await uploadDatabaseWithFilter('manual !keep');
    await app.upload(file('downloader.ini', MULTI_ENTRY_INI));

    await openOnly('WithoutFilter');
    await app.loadAlone();

    assert.equal(app.view.heading, 'without_filter_db');
    assert.equal(app.prompt, null);
    assert.equal(app.filter, 'manual !keep');
  });

  test('remote lists keep the list in the shared URL until an entry is opened', async () => {
    const listUrl = 'https://example.com/flows-list.ini';
    app = await openApp('/', {
      routes: { ...ROUTES, [listUrl]: { body: MULTI_ENTRY_INI, contentType: 'text/plain' } },
    });
    await app.fetch(listUrl);

    assert.equal(app.view.choice.title, 'Choose databases from this list');
    assert.equal(app.view.choice.description, `${listUrl} contains 2 entries.`);
    assert.ok(app.url.includes(`database-url=${encodeURIComponent(listUrl)}`), app.url);

    await openOnly('WithoutFilter');

    assert.equal(app.view.heading, 'without_filter_db');
    assert.equal(app.filter, 'ini-list-default');
    await app.pause();
    assert.ok(app.url.includes(`database-url=${encodeURIComponent(ENTRY_WITHOUT_FILTER_URL)}`), app.url);
    assert.doesNotMatch(app.url, /filter=/);
  });
});

describe('remote loading', () => {
  test('reports a loop when a single-entry list links back to itself', async () => {
    const loopUrl = 'https://example.com/flows-loop.ini';
    app = await openApp('/', {
      routes: { [loopUrl]: { body: `[Loop]\ndb_url=${loopUrl}\n`, contentType: 'text/plain' } },
    });
    await app.fetch(loopUrl);

    assert.equal(app.errorMessage, `Detected a loop while following linked databases from ${loopUrl}.`);
  });

  test('browser history navigation reloads the previously shared database', async () => {
    app = await openApp('/', { routes: ROUTES });
    await app.fetch(ENTRY_WITH_FILTER_URL);
    assert.equal(app.view.heading, 'with_filter_db');

    await app.fetch(ENTRY_WITHOUT_FILTER_URL);
    await app.loadAlone();
    assert.equal(app.view.heading, 'without_filter_db');

    await app.back();
    assert.equal(app.view.heading, 'with_filter_db');
    assert.equal(app.databaseUrl, ENTRY_WITH_FILTER_URL);

    await app.forward();
    assert.equal(app.view.heading, 'without_filter_db');
    assert.equal(app.databaseUrl, ENTRY_WITHOUT_FILTER_URL);
  });

  test('GitHub release downloads, which browsers cannot read, say how to inspect them anyway', async () => {
    const releaseUrl = 'https://github.com/example-owner/example-repo/releases/latest/download/db.json.zip';
    const guidance = `GitHub does not let websites read release downloads, so ${releaseUrl} cannot be opened in the browser. Download db.json.zip and drag it into Upload to inspect it.`;
    // GitHub sends no CORS headers for them, so the browser blocks them: there is no route.
    app = await openApp(`/?database-url=${encodeURIComponent(releaseUrl)}`, { routes: ROUTES });
    assert.equal(app.view.heading, null);
    assert.equal(app.errorMessage, guidance);

    await app.fetch(ENTRY_WITH_FILTER_URL);
    await app.fetch(releaseUrl);
    assert.equal(app.prompt, null);
    assert.equal(app.view.heading, 'with_filter_db');
    assert.equal(app.errorMessage, guidance);
  });

  test('GitHub-hosted databases link to their source repository', async () => {
    const githubUrl = 'https://raw.githubusercontent.com/example-owner/example-repo/main/db.json';
    app = await openApp(`/?database-url=${encodeURIComponent(githubUrl)}`, {
      routes: { [githubUrl]: { body: buildDatabase('github_db') } },
    });

    assert.equal(app.view.heading, 'github_db');
    assert.equal(extractGitHubRepo(app.view.inspection.source), 'example-owner/example-repo');
  });
});

describe('filter panel', () => {
  test('size hints open on click and close when the pointer leaves or focus moves away', async () => {
    app = await openApp('/');
    await app.upload(file('sizes.json', buildDatabase('sizes_db')));
    assert.equal(app.view.heading, 'sizes_db');

    const summary = (clusterSizeBytes) =>
      buildStorageSummary({ combinedView: null, displayedInspection: app.view.inspection, clusterSizeBytes });
    assert.equal(formatBytes(summary(DEFAULT_CLUSTER_SIZE_BYTES).clusteredBytes), '384 KB');
    assert.equal(buildRawByteHoverCopy(summary(DEFAULT_CLUSTER_SIZE_BYTES)), 'Raw file sizes: 3.1 KB\n3,172 bytes');

    let open = nextInfoHintOpen(false, 'click');
    assert.equal(open, true);
    open = nextInfoHintOpen(open, 'mouseleave');
    assert.equal(open, false);
    open = nextInfoHintOpen(open, 'click');
    assert.equal(nextInfoHintOpen(open, 'blur'), false);

    assert.ok(CLUSTER_SIZE_OPTIONS.includes(4096));
    assert.equal(formatBytes(summary(4096).clusteredBytes), '12.0 KB');
    assert.equal(
      CLUSTER_SIZE_TIP,
      'SD cards over 32 GB are usually formatted with 128 KB clusters (exFAT default). Cards of 32 GB or smaller typically use 32 KB clusters (FAT32 default).',
    );
  });

  test('help text adapts to essential and untagged content', async () => {
    app = await openApp('/');
    await app.upload(file('essential.json', buildDatabase('essential_db')));
    assert.equal(app.view.heading, 'essential_db');
    assert.deepEqual(filterHelpClauses(app.view), { essential: true, untagged: 'middle' });

    await app.upload(file('untagged.json', { ...buildDatabase('untagged_db'), tag_dictionary: {} }));
    await app.loadAlone();
    assert.equal(app.view.heading, 'untagged_db');
    assert.deepEqual(filterHelpClauses(app.view), { essential: false, untagged: 'end' });
  });
});

describe('find in page', () => {
  function searchMatches(query) {
    const { filesystemIndex, archivesIndex, collisionsIndex, tagGroups, hasEssentialHint } = app.view;
    return findSearchMatches({ query, filesystemIndex, archivesIndex, collisionsIndex, tagGroups, hasEssentialHint });
  }

  test('the essential hint opens search and highlights matches across sections', async () => {
    app = await openApp('/');
    await app.upload(file('essential.json', buildDatabase('essential_db')));

    const matches = searchMatches('essential');
    assert.deepEqual(
      matches.map(({ section, rowId }) => `${section}:${rowId}`),
      ['filter:filter-essential-hint', 'filesystem:database:file:cores/essential.rbf', 'tags:tagdict-essential-0'],
    );
    // 1 of 3 is the hint itself; Enter moves to the tree row, while the hint and the tag stay
    // highlighted as other matches.
    const second = matches[nextMatchIndex(0, matches.length)];
    assert.deepEqual(second, { rowId: 'database:file:cores/essential.rbf', section: 'filesystem', matchPart: 'name' });
    assert.deepEqual(searchMatches(''), []);
  });

  test('a tree match flashes its row for three seconds while its text stays highlighted', () => {
    const timers = fakeTimers();
    let highlighted = null;
    const flash = createRowFlash({
      ...timers,
      onChange: (rowId, flashing) => {
        highlighted = flashing ? rowId : highlighted === rowId ? null : highlighted;
      },
    });

    flash.start('database:file:cores/essential.rbf');
    assert.equal(highlighted, 'database:file:cores/essential.rbf');
    timers.advance(1_500);
    assert.equal(highlighted, 'database:file:cores/essential.rbf');
    timers.advance(2_000);
    assert.equal(highlighted, null);
  });

  test('closing search right after jumping to a tree match leaves no highlight behind', () => {
    const timers = fakeTimers();
    let highlighted = null;
    const flash = createRowFlash({ ...timers, onChange: (rowId, flashing) => (highlighted = flashing ? rowId : null) });

    flash.start('database:file:cores/essential.rbf');
    // Closing the search ends the flash at once, and nothing comes back afterwards.
    flash.end();
    assert.equal(highlighted, null);
    timers.advance(1_500);
    assert.equal(highlighted, null);
  });
});

describe('navigation in large trees', () => {
  const FAR_FILE_PATH = 'games/folder_14/file_00599.rbf';
  const FAR_ROW_ID = `database:file:${FAR_FILE_PATH}`;
  const VIEWPORT_HEIGHT = 960;

  // The rows rendered once the page jumps to a row, from its estimated offset, and where the row
  // then is in the viewport.
  function rowsAfterJumpTo(rowId) {
    const { rootIds, rowsById } = app.view.filesystemIndex;
    // Every row starts expanded.
    const rowIds = collectVisibleRowIds(rootIds, rowsById, new Set());
    const layout = buildVirtualRowLayout({
      rowIds,
      rowsById,
      collapsedIds: new Set(),
      detailOverrides: new Map(),
      defaultDetailed: false,
      measuredHeights: new Map(),
    });
    const rendered = (scrollY) =>
      buildVirtualRows({ layout, rowsById, containerTop: 0, scrollY, viewportHeight: VIEWPORT_HEIGHT }).items.map(
        (item) => item.rowId,
      );
    const offset = layout.offsets[layout.rowIndexById.get(rowId)];
    const jumpScrollY = getRowJumpScrollTop({ containerTop: 0, offset, viewportHeight: VIEWPORT_HEIGHT });
    return {
      atTop: rendered(0),
      afterJump: rendered(jumpScrollY),
      topAfterJump: offset - jumpScrollY,
    };
  }

  function assertInViewport(top) {
    assert.ok(top >= 0 && top < VIEWPORT_HEIGHT, `row top ${top} is outside the viewport`);
  }

  test('find-in-page jumps to a row far outside the rendered rows', async () => {
    app = await openApp('/');
    await app.upload(file('large.json', buildLargeDatabase()));
    assert.equal(app.view.heading, 'large_db');

    const { filesystemIndex, archivesIndex, collisionsIndex, tagGroups, hasEssentialHint } = app.view;
    const matches = findSearchMatches({
      query: 'file_00599.rbf',
      filesystemIndex,
      archivesIndex,
      collisionsIndex,
      tagGroups,
      hasEssentialHint,
    });
    assert.deepEqual(matches.map(({ rowId }) => rowId), [FAR_ROW_ID]);
    const { atTop, afterJump, topAfterJump } = rowsAfterJumpTo(FAR_ROW_ID);
    assert.ok(!atTop.includes(FAR_ROW_ID));
    assert.ok(afterJump.includes(FAR_ROW_ID));
    assertInViewport(topAfterJump);
  });

  // Opening search from the footer leaves the page at its bottom, where the last row already shows.
  // The rows rendered there then report heights shorter than their estimates, so the page gets
  // shorter and the browser pulls its scroll position back; the measurement's scroll anchoring
  // scrolls only what is left (useVirtualRowWindow), and the row stays on screen.
  test('a row on screen at the bottom of the page stays there when the rows around it measure shorter', async () => {
    app = await openApp('/');
    await app.upload(file('large.json', buildLargeDatabase()));
    const { rootIds, rowsById } = app.view.filesystemIndex;
    const rowIds = collectVisibleRowIds(rootIds, rowsById, new Set());
    const layoutFor = (measuredHeights) =>
      buildVirtualRowLayout({ rowIds, rowsById, collapsedIds: new Set(), detailOverrides: new Map(), defaultDetailed: false, measuredHeights });
    // The tree's place in the page, and what follows it (the issues and the footer).
    const treeTop = 1500;
    const belowTree = 250;
    const maxScrollY = (layout) => treeTop + layout.totalHeight + belowTree - VIEWPORT_HEIGHT;
    const rowTop = (layout, scrollY) => treeTop + layout.offsets[layout.rowIndexById.get(FAR_ROW_ID)] - scrollY;

    const estimated = layoutFor(new Map());
    const scrollY = maxScrollY(estimated);
    assertInViewport(rowTop(estimated, scrollY));

    const rendered = buildVirtualRows({ layout: estimated, rowsById, containerTop: treeTop, scrollY, viewportHeight: VIEWPORT_HEIGHT }).items;
    const measured = mergeMeasuredHeights(
      new Map(),
      rendered.map(({ rowId }) => {
        const row = rowsById.get(rowId);
        const estimate = estimateRowHeight(row, { collapsed: false, detailsVisible: false });
        return [getRowMeasurementKey(rowId, { collapsed: false, detailsVisible: false }), Math.round(estimate * 0.6)];
      }),
    );
    const next = layoutFor(measured);
    const delta = getMeasurementScrollDelta({
      rowIds,
      rowsById,
      collapsedIds: new Set(),
      detailOverrides: new Map(),
      defaultDetailed: false,
      currentMeasuredHeights: new Map(),
      nextMeasuredHeights: measured,
      viewportTop: scrollY - treeTop,
    });
    // The page got shorter than its scroll position allows: the browser pulls it back.
    const scrollYAfter = Math.min(scrollY, maxScrollY(next));
    assert.ok(scrollYAfter < scrollY);
    const remaining = getRemainingScrollAnchorDelta({ delta, scrollYBefore: scrollY, scrollYAfter });
    const finalScrollY = shouldApplyScrollAnchor(remaining, { touchDevice: false, suppressed: false })
      ? Math.max(0, Math.min(maxScrollY(next), scrollYAfter + remaining))
      : scrollYAfter;
    assertInViewport(rowTop(next, finalScrollY));
  });

  test('URL anchors open a row far outside the rendered rows', async () => {
    app = await openApp(`/#files:${encodeURIComponent(FAR_FILE_PATH)}`);
    await app.upload(file('large.json', buildLargeDatabase()));
    assert.equal(app.view.heading, 'large_db');

    const anchor = parseNodeAnchor();
    assert.equal(anchor.section, 'filesystem');
    assert.equal(anchor.rowId, FAR_ROW_ID);
    // The row's folders open (games is not listed among the folders, so it shows as missing), and
    // the jump brings the row into view.
    assert.deepEqual(findAncestorIds(app.view.filesystemIndex.rowsById, FAR_ROW_ID), [
      'database:folder:games/folder_14',
      'database:missingfolder:games',
    ]);
    const { afterJump, topAfterJump } = rowsAfterJumpTo(FAR_ROW_ID);
    assert.ok(afterJump.includes(FAR_ROW_ID));
    assertInViewport(topAfterJump);
  });
});

function fakeTimers() {
  let now = 0;
  const timers = new Map();
  let nextId = 1;
  return {
    setTimeout(callback, delay) {
      timers.set(nextId, { at: now + delay, callback });
      return nextId++;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(id);
          timer.callback();
        }
      }
    },
  };
}

function buildLargeDatabase() {
  const files = {};
  const folders = {};
  for (let index = 0; index < 600; index += 1) {
    const folder = `games/folder_${String(Math.floor(index / 40)).padStart(2, '0')}`;
    folders[folder] = {};
    files[`${folder}/file_${String(index).padStart(5, '0')}.rbf`] = { size: 1000 + index, hash: `h${index}` };
  }
  return { db_id: 'large_db', v: 1, timestamp: 1710000000, base_files_url: 'https://example.com/', files, folders };
}

function buildDatabase(dbId) {
  return {
    db_id: dbId,
    v: 1,
    timestamp: 1710000000,
    base_files_url: 'https://example.com/base/',
    tag_dictionary: { essential: 0, arcade: 1 },
    files: {
      'cores/essential.rbf': { size: 1024, hash: 'h1', tags: [0] },
      'cores/arcade.rbf': { size: 2048, hash: 'h2', tags: [1] },
    },
    folders: { 'cores/': {} },
    archives: {
      flows_archive: {
        description: 'Flows archive',
        format: 'zip',
        extract: 'selective',
        target_folder: 'games/flows/',
        archive_file: { url: 'https://example.com/flows.zip', size: 4096, hash: 'ah' },
        summary_inline: {
          files: {
            'games/flows/untagged.bin': { arc_id: 'flows_archive', arc_at: 'untagged.bin', size: 100 },
          },
          folders: {},
        },
      },
    },
  };
}
