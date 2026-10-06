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
import { parseNodeAnchor, readLink } from '../../../src/lib/urlState.js';
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

// The catalog, where a fork shares a db_id with the database before it.
const RUNTIME_CATALOG_URL =
  'https://raw.githubusercontent.com/theypsilon/Update_All_MiSTer/master/src/update_all/databases.py';
const MULTIDATABASES_CATALOG_URL = 'https://raw.githubusercontent.com/theypsilon/MultiDatabases_MiSTer/main/README.md';
const FORK_URL = 'https://example.com/flows-fork.json';
const BROKEN_URL = 'https://example.com/flows-broken.json';
const README_ONLY_URL = 'https://raw.githubusercontent.com/theypsilon/MultiDatabases_MiSTer/db/readme-only/db.json';
const CATALOG_ROUTES = {
  ...ROUTES,
  [FORK_URL]: { body: buildDatabase('with_filter_db') },
  [RUNTIME_CATALOG_URL]: {
    body: `
self.with_filter = Database(db_id='with_filter_db', db_url='${ENTRY_WITH_FILTER_URL}', title='With filter')
self.fork = Database(db_id='with_filter_db', db_url='${FORK_URL}', title='With filter: fork')
self.without_filter = Database(db_id='Without_Filter_DB', db_url='${ENTRY_WITHOUT_FILTER_URL}', title='Without filter')
self.broken = Database(db_id='broken_db', db_url='${BROKEN_URL}', title='Broken')
`,
    contentType: 'text/plain; charset=utf-8',
  },
  [MULTIDATABASES_CATALOG_URL]: {
    body: `| [README only](readme-only/) | Only here | [Inspect](https://theypsilon.github.io/DB-Inspector_MiSTer/#db=${README_ONLY_URL}) |`,
    contentType: 'text/markdown; charset=utf-8',
  },
};

// The catalog's routes, with the answers to `urls` held back until `answer(url)`.
function heldBack(...urls) {
  const held = new Map(urls.map((url) => [url, Promise.withResolvers()]));
  return {
    routes: (url) => (held.has(url) ? held.get(url).promise.then(() => CATALOG_ROUTES[url]) : CATALOG_ROUTES[url]),
    answer: (url) => held.get(url).resolve(),
  };
}

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
    assert.equal(app.hash, `#db=${ENTRY_WITH_FILTER_URL}`);
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
    assert.equal(app.hash, `#db=${ENTRY_WITH_FILTER_URL}&filter=manual+!keep`);
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

    // Its picker opens by itself.
    assert.equal(app.state.choicePickerOpen, true);
    assert.equal(app.view.choice.title, 'Choose databases from this list');
    assert.equal(app.view.choice.description, `${listUrl} contains 2 entries.`);
    assert.equal(app.hash, `#db=${listUrl}`);

    await openOnly('WithoutFilter');

    assert.equal(app.view.heading, 'without_filter_db');
    assert.equal(app.filter, 'ini-list-default');
    await app.pause();
    assert.equal(app.hash, `#db=${ENTRY_WITHOUT_FILTER_URL}`);
  });

  test('an entry that is the loaded database asks only before replacing FILTER', async () => {
    const listUrl = 'https://example.com/flows-list.ini';
    app = await openApp('/', {
      routes: { ...ROUTES, [listUrl]: { body: MULTI_ENTRY_INI, contentType: 'text/plain' } },
    });
    await app.fetch(ENTRY_WITH_FILTER_URL);
    await app.typeFilter('manual !keep');
    await app.fetch(listUrl);
    await openOnly('WithFilter');

    // Opening it closes no other database, so there is no question about combining.
    assert.equal(app.prompt.kind, 'filterOverride');
    await app.answer('filterOverride', true);
    assert.equal(app.prompt, null);
    assert.equal(app.view.heading, 'with_filter_db');
    assert.equal(app.filter, 'arcade ini-list-default');
  });
});

describe('remote loading', () => {
  test('reports a loop when a single-entry list links back to itself', async () => {
    const loopUrl = 'https://example.com/flows-loop.ini';
    app = await openApp('/', {
      routes: { ...ROUTES, [loopUrl]: { body: `[Loop]\ndb_url=${loopUrl}\n`, contentType: 'text/plain' } },
    });
    await app.fetch(loopUrl);

    assert.equal(app.errorMessage, `Detected a loop while following linked databases from ${loopUrl}.`);

    // With a database loaded, the list is read first, then whether to combine is asked, then the
    // loop is found.
    await app.fetch(ENTRY_WITH_FILTER_URL);
    assert.equal(app.errorMessage, '');
    await app.fetch(loopUrl);
    await app.loadAlone();
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
    app = await openApp(`/#db=${releaseUrl}`, { routes: ROUTES });
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
    app = await openApp(`/#db=${githubUrl}`, {
      routes: { [githubUrl]: { body: buildDatabase('github_db') } },
    });

    assert.equal(app.view.heading, 'github_db');
    assert.equal(extractGitHubRepo(app.view.inspection.source), 'example-owner/example-repo');
  });
});

describe('links', () => {
  test('old links open their database as #db=, and nothing else they named', async () => {
    app = await openApp(`/?database-url=${encodeURIComponent(ENTRY_WITH_FILTER_URL)}&filter=arcade&detailed#files:cores/arcade.rbf`, {
      routes: ROUTES,
    });

    assert.equal(app.url, `http://localhost/#db=${ENTRY_WITH_FILTER_URL}`);
    assert.equal(app.historyLength, 1);
    assert.equal(app.view.heading, 'with_filter_db');
    assert.equal(app.databaseUrl, ENTRY_WITH_FILTER_URL);
    assert.equal(app.filter, '');
  });

  test('a link typed in the address bar of the open page opens what it names, and back returns', async () => {
    app = await openApp(`/#db=${ENTRY_WITH_FILTER_URL}`, { routes: ROUTES });
    assert.equal(app.view.heading, 'with_filter_db');

    await app.openLink(`#db=${ENTRY_WITHOUT_FILTER_URL}&filter=arcade`);
    // In the page, without loading it again.
    assert.deepEqual(app.pageLoads, []);
    assert.equal(app.view.heading, 'without_filter_db');
    assert.equal(app.databaseUrl, ENTRY_WITHOUT_FILTER_URL);
    assert.equal(app.filter, 'arcade');

    await app.back();
    assert.equal(app.view.heading, 'with_filter_db');
    assert.equal(app.filter, '');
  });

  test('a link written by hand can name a database of the catalog by its db_id, which the link then names by its URL', async () => {
    app = await openApp('/#db=With_Filter_DB&filter=arcade', { routes: CATALOG_ROUTES });

    // The first database of the catalog with that db_id, letter case aside, fetched once found.
    assert.equal(app.view.heading, 'with_filter_db');
    assert.deepEqual(
      app.browser.requests.map(({ url }) => url),
      [RUNTIME_CATALOG_URL, MULTIDATABASES_CATALOG_URL, ENTRY_WITH_FILTER_URL],
    );
    assert.equal(app.hash, `#db=${ENTRY_WITH_FILTER_URL}&filter=arcade`);
    assert.equal(app.historyLength, 1);
    assert.equal(app.databaseUrl, ENTRY_WITH_FILTER_URL);
    assert.equal(app.filter, 'arcade');
    assert.equal(app.state.loadingMessage, '');
    assert.equal(app.errorMessage, '');

    // The page writes its URL from then on.
    await app.typeFilter('arcade !cheats');
    assert.equal(app.hash, `#db=${ENTRY_WITH_FILTER_URL}&filter=arcade+!cheats`);
    await app.reload();
    assert.equal(app.view.heading, 'with_filter_db');
    assert.equal(app.filter, 'arcade !cheats');

    // A database the catalog lists only from MultiDatabases has the db_id the catalog shows.
    app.close();
    app = await openApp('/#db=MultiDatabases/readme-only', {
      routes: { ...CATALOG_ROUTES, [README_ONLY_URL]: { body: buildDatabase('MultiDatabases/readme-only') } },
    });
    assert.equal(app.view.heading, 'MultiDatabases/readme-only');
    assert.equal(app.hash, `#db=${README_ONLY_URL}`);

    // A link naming URLs alone fetches its database before the catalog, as it always has.
    app.close();
    app = await openApp(`/#db=${ENTRY_WITH_FILTER_URL}`, { routes: CATALOG_ROUTES });
    assert.deepEqual(
      app.browser.requests.map(({ url }) => url),
      [ENTRY_WITH_FILTER_URL, RUNTIME_CATALOG_URL, MULTIDATABASES_CATALOG_URL],
    );
  });

  test('combined databases can be named by db_id among URLs, keeping their own filters', async () => {
    app = await openApp(
      `/#db=without_filter_db&db=${ENTRY_WITH_FILTER_URL}&filter=arcade&filter.without_filter_db=!arcade`,
      { routes: CATALOG_ROUTES },
    );

    assert.equal(app.view.heading, '2 combined databases');
    assert.deepEqual(app.view.cards, ['without_filter_db', 'with_filter_db']);
    assert.equal(app.sharedFilter, 'arcade');
    assert.equal(app.ownFilter('without_filter_db'), '!arcade');
    assert.equal(
      app.hash,
      `#db=${ENTRY_WITHOUT_FILTER_URL}&db=${ENTRY_WITH_FILTER_URL}&filter=arcade&filter.without_filter_db=!arcade`,
    );
    assert.equal(app.historyLength, 1);
    assert.equal(app.state.loadingMessage, '');
  });

  test('a db_id the catalog does not have fails to open, as a database that cannot be loaded does', async () => {
    app = await openApp('/#db=missing_db', { routes: CATALOG_ROUTES });
    assert.equal(app.errorMessage, 'The catalog has no database with db_id missing_db.');
    assert.equal(app.view.heading, null);
    assert.equal(app.hash, '#db=missing_db');
    assert.equal(app.state.loadingMessage, '');
    assert.deepEqual(app.browser.requests.map(({ url }) => url), [RUNTIME_CATALOG_URL, MULTIDATABASES_CATALOG_URL]);

    // Among others, the others open.
    app.close();
    app = await openApp(`/#db=without_filter_db&db=missing_db&db=${ENTRY_WITH_FILTER_URL}`, { routes: CATALOG_ROUTES });
    assert.equal(app.view.heading, '2 combined databases');
    assert.deepEqual(app.view.cards, ['without_filter_db', 'with_filter_db']);
    assert.equal(app.errorMessage, 'The catalog has no database with db_id missing_db.');
    assert.equal(app.hash, `#db=${ENTRY_WITHOUT_FILTER_URL}&db=${ENTRY_WITH_FILTER_URL}`);

    // One the catalog has, whose database cannot be loaded, fails as its URL does, which the Fetch
    // box then holds.
    app.close();
    app = await openApp(`/#db=${BROKEN_URL}`, { routes: CATALOG_ROUTES });
    const brokenError = app.errorMessage;
    assert.ok(brokenError);
    app.close();
    app = await openApp('/#db=broken_db', { routes: CATALOG_ROUTES });
    assert.equal(app.errorMessage, brokenError);
    assert.equal(app.databaseUrl, BROKEN_URL);
    assert.equal(app.hash, `#db=${BROKEN_URL}`);

    // Without the catalog, no db_id is found.
    app.close();
    app = await openApp('/#db=without_filter_db', { routes: ROUTES });
    assert.equal(app.catalog.status, 'error');
    assert.equal(
      app.errorMessage,
      'The catalog could not be loaded, so the database with db_id without_filter_db could not be found.',
    );
    assert.equal(app.view.heading, null);
    assert.equal(app.hash, '#db=without_filter_db');
  });

  test('a db_id typed in the address bar of the open page opens its database, and back returns', async () => {
    app = await openApp(`/#db=${ENTRY_WITH_FILTER_URL}`, { routes: CATALOG_ROUTES });
    assert.equal(app.view.heading, 'with_filter_db');

    await app.openLink('#db=without_filter_db&filter=arcade');
    assert.equal(app.view.heading, 'without_filter_db');
    assert.equal(app.hash, `#db=${ENTRY_WITHOUT_FILTER_URL}&filter=arcade`);
    assert.equal(app.historyLength, 2);
    assert.equal(app.databaseUrl, ENTRY_WITHOUT_FILTER_URL);
    assert.equal(app.filter, 'arcade');

    await app.back();
    assert.equal(app.view.heading, 'with_filter_db');
    assert.equal(app.filter, '');
    await app.forward();
    assert.equal(app.view.heading, 'without_filter_db');
    assert.equal(app.hash, `#db=${ENTRY_WITHOUT_FILTER_URL}&filter=arcade`);

    // One the catalog does not have takes the loaded database away, as a failed load does.
    await app.openLink('#db=missing_db');
    assert.equal(app.view.heading, null);
    assert.equal(app.errorMessage, 'The catalog has no database with db_id missing_db.');
    assert.equal(app.hash, '#db=missing_db');
  });

  test('a link waiting for the catalog says so, and gives way to a link opened meanwhile', async () => {
    let catalog = heldBack(RUNTIME_CATALOG_URL);
    app = await openApp('/', { routes: catalog.routes });
    await app.openLink('#db=without_filter_db');
    assert.equal(app.state.loadingMessage, 'Finding without_filter_db in the catalog...');
    assert.equal(app.view.heading, null);

    // Back on the start page, it no longer waits, and once the catalog arrives nothing opens.
    await app.back();
    assert.equal(app.state.loadingMessage, '');
    catalog.answer(RUNTIME_CATALOG_URL);
    await app.settle();
    assert.equal(app.state.loadingMessage, '');
    assert.equal(app.view.heading, null);
    assert.equal(app.hash, '');
    assert.ok(!app.browser.requests.some(({ url }) => url === ENTRY_WITHOUT_FILTER_URL));

    // Forward finds it in the catalog, fetched once, and its history entry names its URL.
    await app.forward();
    assert.equal(app.view.heading, 'without_filter_db');
    assert.equal(app.hash, `#db=${ENTRY_WITHOUT_FILTER_URL}`);
    assert.equal(app.historyLength, 2);
    assert.equal(app.browser.requests.filter(({ url }) => url === RUNTIME_CATALOG_URL).length, 1);

    // A shared link waiting for it gives way to a database opened meanwhile, which stays as it is.
    app.close();
    catalog = heldBack(RUNTIME_CATALOG_URL);
    app = await openApp('/#db=without_filter_db&db=with_filter_db', { routes: catalog.routes });
    assert.equal(app.state.loadingMessage, 'Finding 2 databases in the catalog...');
    await app.fetch(ENTRY_WITH_FILTER_URL);
    assert.equal(app.view.heading, 'with_filter_db');
    catalog.answer(RUNTIME_CATALOG_URL);
    await app.settle();
    assert.equal(app.view.heading, 'with_filter_db');
    assert.equal(app.hash, `#db=${ENTRY_WITH_FILTER_URL}`);
    assert.equal(app.state.loadingMessage, '');
    assert.deepEqual(
      app.browser.requests.map(({ url }) => url).filter((url) => url.startsWith('https://example.com/')),
      [ENTRY_WITH_FILTER_URL],
    );

    // Leaving it for another link takes its message away, but not the message of a database the
    // page is loading meanwhile.
    app.close();
    catalog = heldBack(RUNTIME_CATALOG_URL, ENTRY_WITH_FILTER_URL);
    app = await openApp('/#db=without_filter_db', { routes: catalog.routes });
    await app.fetch(ENTRY_WITH_FILTER_URL);
    assert.equal(app.state.loadingMessage, `Fetching ${ENTRY_WITH_FILTER_URL}...`);
    await app.openLink('#');
    assert.equal(app.state.loadingMessage, `Fetching ${ENTRY_WITH_FILTER_URL}...`);
    catalog.answer(ENTRY_WITH_FILTER_URL);
    catalog.answer(RUNTIME_CATALOG_URL);
    await app.settle();
    assert.equal(app.view.heading, 'with_filter_db');
    assert.equal(app.state.loadingMessage, '');
  });

  test('Clear asks first, then loads the start page: the address without its link', async () => {
    app = await openApp(`/inspector/?from=forum#db=${ENTRY_WITH_FILTER_URL}&filter=arcade`, { routes: ROUTES });
    assert.equal(app.view.heading, 'with_filter_db');

    // Escape and Cancel leave everything as it was.
    await app.clearDatabases();
    assert.equal(app.prompt.kind, 'clearDatabases');
    await app.escape();
    assert.equal(app.prompt, null);
    await app.clearDatabases();
    await app.answer('clearDatabases', false);
    assert.equal(app.view.heading, 'with_filter_db');
    assert.deepEqual(app.pageLoads, []);

    await app.clearDatabases();
    await app.answer('clearDatabases', true);
    assert.deepEqual(app.pageLoads, ['http://localhost/inspector/?from=forum']);
    // In a new history entry, so Back opens the link again.
    assert.equal(app.historyLength, 2);

    // Uploaded databases are not in the link: the page loads again where it is.
    await app.close();
    app = await openApp('/', { routes: ROUTES });
    await app.upload(file('current.json', buildDatabase('current_db')));
    assert.equal(app.view.heading, 'current_db');
    await app.clearDatabases();
    await app.answer('clearDatabases', true);
    assert.deepEqual(app.pageLoads, ['http://localhost/']);
    assert.equal(app.historyLength, 1);
  });

  test('a damaged link says so, and the page works as usual', async () => {
    app = await openApp('/#z=damaged!&at=issues', { routes: ROUTES });
    assert.equal(app.errorMessage, 'This link is damaged, so what it names could not be opened.');
    assert.equal(app.view.heading, null);

    await app.fetch(ENTRY_WITH_FILTER_URL);
    assert.equal(app.view.heading, 'with_filter_db');
    assert.equal(app.errorMessage, '');
    assert.equal(app.hash, `#db=${ENTRY_WITH_FILTER_URL}&at=issues`);

    // Back at the damaged link, it says so again.
    await app.back();
    assert.equal(app.errorMessage, 'This link is damaged, so what it names could not be opened.');
    assert.equal(app.view.heading, null);
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
    const { filesystemIndex, archivesIndex, collisionsIndex, hasEssentialHint } = app.view;
    return findSearchMatches({ query, filesystemIndex, archivesIndex, collisionsIndex, hasEssentialHint });
  }

  test('the essential hint opens search and highlights matches across sections', async () => {
    app = await openApp('/');
    await app.upload(file('essential.json', buildDatabase('essential_db')));

    const matches = searchMatches('essential');
    assert.deepEqual(
      matches.map(({ section, rowId }) => `${section}:${rowId}`),
      ['filter:filter-essential-hint', 'filesystem:database:file:cores/essential.rbf'],
    );
    // 1 of 2 is the hint itself; Enter moves to the tree row, while the hint stays highlighted as the
    // other match. The terms are in their dialog, out of the page, so they are not matches.
    assert.ok(!matches.some(({ section }) => section === 'tags'));
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

    const { filesystemIndex, archivesIndex, collisionsIndex, hasEssentialHint } = app.view;
    const matches = findSearchMatches({
      query: 'file_00599.rbf',
      filesystemIndex,
      archivesIndex,
      collisionsIndex,
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
    app = await openApp(`/#at=files:${FAR_FILE_PATH}`);
    await app.upload(file('large.json', buildLargeDatabase()));
    assert.equal(app.view.heading, 'large_db');

    const anchor = parseNodeAnchor(readLink().at);
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
