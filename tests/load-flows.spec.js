import { expect, test } from '@playwright/test';

// Legacy end-to-end tests: replaced by the journeys in tests/journeys/, with their behavior specced
// by tests/unit/flows/ and tests/component/. Kept for reference; LEGACY_E2E=1 runs them.
test.skip(!process.env.LEGACY_E2E, 'Replaced by the journeys in tests/journeys/; set LEGACY_E2E=1 to run it');

// Opening a database while another is loaded asks whether to combine them; these flows replace it.
function loadAlone(page) {
  return page
    .getByRole('dialog', { name: 'Combine with the loaded databases?' })
    .getByRole('button', { name: 'Load alone' })
    .click();
}

// A database list's picker starts with every database selected; these flows open just one.
async function chooseOnly(page, dbId) {
  await page.getByRole('button', { name: 'Select none' }).click();
  await page.getByRole('checkbox', { name: dbId, exact: true }).check();
}

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

test.beforeEach(async ({ page }) => {
  await page.route(ENTRY_WITH_FILTER_URL, (route) => fulfillJson(route, buildDatabase('with_filter_db')));
  await page.route(ENTRY_WITHOUT_FILTER_URL, (route) =>
    fulfillJson(route, buildDatabase('without_filter_db')),
  );
});

test.describe('INI list picker', () => {
  test('asks before replacing a non-empty FILTER and applies the entry filter when accepted', async ({
    page,
  }) => {
    await page.goto('/');
    await uploadDatabaseWithFilter(page, 'manual !keep');
    await uploadText(page, 'downloader.ini', MULTI_ENTRY_INI);

    // The list's picker opens first; combining is asked once its databases are chosen.
    await expect(page.getByRole('heading', { name: 'Choose databases from this list' })).toBeVisible();
    await chooseOnly(page, 'WithFilter');
    await page.getByRole('button', { name: 'Open selected database' }).click();
    await loadAlone(page);

    await expect(page.getByRole('heading', { name: 'Replace the current filter?' })).toBeVisible();
    await expect(page.locator('.filter-override-grid')).toContainText('manual !keep');
    await expect(page.locator('.filter-override-grid')).toContainText('arcade ini-list-default');
    await page.getByRole('button', { name: 'Replace filter' }).click();

    await expect(page.getByRole('heading', { name: 'with_filter_db' })).toBeVisible();
    await expect(page.getByLabel('FILTER')).toHaveValue('arcade ini-list-default');
    await expect.poll(() => page.url()).toContain(`database-url=${encodeURIComponent(ENTRY_WITH_FILTER_URL)}`);
    await expect.poll(() => page.url()).not.toContain('filter=');
  });

  test('keeps the current FILTER when the replacement is declined', async ({ page }) => {
    await page.goto('/');
    await uploadDatabaseWithFilter(page, 'manual !keep');
    await uploadText(page, 'downloader.ini', MULTI_ENTRY_INI);

    await chooseOnly(page, 'WithFilter');
    await page.getByRole('button', { name: 'Open selected database' }).click();
    await loadAlone(page);
    await expect(page.getByRole('heading', { name: 'Replace the current filter?' })).toBeVisible();
    await page.getByRole('button', { name: 'Keep current' }).click();

    await expect(page.getByRole('heading', { name: 'with_filter_db' })).toBeVisible();
    await expect(page.getByLabel('FILTER')).toHaveValue('manual !keep');
    await expect.poll(() => page.url()).toContain(`filter=${encodeURIComponent('manual !keep')}`);
  });

  test('opens entries without their own filter while keeping the current FILTER without asking', async ({
    page,
  }) => {
    await page.goto('/');
    await uploadDatabaseWithFilter(page, 'manual !keep');
    await uploadText(page, 'downloader.ini', MULTI_ENTRY_INI);

    await chooseOnly(page, 'WithoutFilter');
    await page.getByRole('button', { name: 'Open selected database' }).click();
    await loadAlone(page);

    await expect(page.getByRole('heading', { name: 'without_filter_db' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Replace the current filter?' })).toHaveCount(0);
    await expect(page.getByLabel('FILTER')).toHaveValue('manual !keep');
  });

  test('remote lists keep the list in the shared URL until an entry is opened', async ({ page }) => {
    const listUrl = 'https://example.com/flows-list.ini';
    await page.route(listUrl, (route) =>
      route.fulfill({ status: 200, contentType: 'text/plain', body: MULTI_ENTRY_INI }),
    );

    await page.goto('/');
    await page.getByLabel('URL').fill(listUrl);
    await page.getByRole('button', { name: 'Fetch database' }).click();

    await expect(page.getByRole('heading', { name: 'Choose databases from this list' })).toBeVisible();
    await expect(page.getByText(`${listUrl} contains 2 entries.`)).toBeVisible();
    await expect.poll(() => page.url()).toContain(`database-url=${encodeURIComponent(listUrl)}`);

    await chooseOnly(page, 'WithoutFilter');
    await page.getByRole('button', { name: 'Open selected database' }).click();

    await expect(page.getByRole('heading', { name: 'without_filter_db' })).toBeVisible();
    await expect(page.getByLabel('FILTER')).toHaveValue('ini-list-default');
    await expect.poll(() => page.url()).toContain(
      `database-url=${encodeURIComponent(ENTRY_WITHOUT_FILTER_URL)}`,
    );
    await expect.poll(() => page.url()).not.toContain('filter=');
  });
});

test.describe('remote loading', () => {
  test('reports a loop when a single-entry list links back to itself', async ({ page }) => {
    const loopUrl = 'https://example.com/flows-loop.ini';
    await page.route(loopUrl, (route) =>
      route.fulfill({ status: 200, contentType: 'text/plain', body: `[Loop]\ndb_url=${loopUrl}\n` }),
    );

    await page.goto('/');
    await page.getByLabel('URL').fill(loopUrl);
    await page.getByRole('button', { name: 'Fetch database' }).click();

    await expect(
      page.getByText(`Detected a loop while following linked databases from ${loopUrl}.`),
    ).toBeVisible();
  });

  test('browser history navigation reloads the previously shared database', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('URL').fill(ENTRY_WITH_FILTER_URL);
    await page.getByRole('button', { name: 'Fetch database' }).click();
    await expect(page.getByRole('heading', { name: 'with_filter_db' })).toBeVisible();

    await page.getByLabel('URL').fill(ENTRY_WITHOUT_FILTER_URL);
    await page.getByRole('button', { name: 'Fetch database' }).click();
    await loadAlone(page);
    await expect(page.getByRole('heading', { name: 'without_filter_db' })).toBeVisible();

    await page.goBack();
    await expect(page.getByRole('heading', { name: 'with_filter_db' })).toBeVisible();
    await expect(page.getByLabel('URL')).toHaveValue(ENTRY_WITH_FILTER_URL);

    await page.goForward();
    await expect(page.getByRole('heading', { name: 'without_filter_db' })).toBeVisible();
    await expect(page.getByLabel('URL')).toHaveValue(ENTRY_WITHOUT_FILTER_URL);
  });

  test('GitHub-hosted databases link to their source repository', async ({ page }) => {
    const githubUrl = 'https://raw.githubusercontent.com/example-owner/example-repo/main/db.json';
    await page.route(githubUrl, (route) => fulfillJson(route, buildDatabase('github_db')));

    await page.goto(`/?database-url=${encodeURIComponent(githubUrl)}`);

    await expect(page.getByRole('heading', { name: 'github_db' })).toBeVisible();
    const repoLink = page.locator('.github-repo-link');
    await expect(repoLink).toHaveText('example-owner/example-repo');
    await expect(repoLink).toHaveAttribute('href', 'https://github.com/example-owner/example-repo');
  });
});

test.describe('filter panel', () => {
  test('size hints open on click and close when the pointer leaves or focus moves away', async ({ page }) => {
    await page.goto('/');
    await uploadJson(page, 'sizes.json', buildDatabase('sizes_db'));
    await expect(page.getByRole('heading', { name: 'sizes_db' })).toBeVisible();

    const sizeHint = page.locator('.disk-usage-value');
    await expect(sizeHint).toContainText('384 KB');
    await expect(sizeHint.locator('.info-tip')).toHaveText(/^Raw file sizes: 3\.1 KB\s+3,172 bytes$/);

    await sizeHint.click();
    await expect(sizeHint).toHaveAttribute('data-open', '');
    await page.mouse.move(0, 0);
    await expect(sizeHint).not.toHaveAttribute('data-open', '');

    await sizeHint.click();
    await expect(sizeHint).toHaveAttribute('data-open', '');
    await page.getByLabel('FILTER').focus();
    await expect(sizeHint).not.toHaveAttribute('data-open', '');

    await page.getByLabel('Cluster size', { exact: true }).selectOption(String(4096));
    await expect(sizeHint).toContainText('12.0 KB');

    const clusterInfo = page.getByLabel('Cluster size info');
    await clusterInfo.click();
    await expect(clusterInfo).toHaveAttribute('data-open', '');
    await expect(clusterInfo.locator('.info-tip')).toHaveText(
      'SD cards over 32 GB are usually formatted with 128 KB clusters (exFAT default). Cards of 32 GB or smaller typically use 32 KB clusters (FAT32 default).',
    );
  });

  test('help text adapts to essential and untagged content', async ({ page }) => {
    await page.goto('/');
    await uploadJson(page, 'essential.json', buildDatabase('essential_db'));
    await expect(page.getByRole('heading', { name: 'essential_db' })).toBeVisible();

    await expect(page.locator('.filter-panel .helper-copy').first()).toHaveText(
      'Filter content with terms (a.k.a. tags) like console, arcade, or !cheats. Positive terms keep matching tagged items, negative terms remove them, untagged items remain visible, and essential stays included unless you exclude it. Read the official guide.',
    );

    await uploadJson(page, 'untagged.json', {
      ...buildDatabase('untagged_db'),
      tag_dictionary: {},
    });
    await loadAlone(page);
    await expect(page.getByRole('heading', { name: 'untagged_db' })).toBeVisible();
    await expect(page.locator('.filter-panel .helper-copy').first()).toHaveText(
      'Filter content with terms (a.k.a. tags) like console, arcade, or !cheats. Positive terms keep matching tagged items, negative terms remove them, and untagged items remain visible. Read the official guide.',
    );
  });
});

test.describe('find in page', () => {
  test('the essential hint opens search and highlights matches across sections', async ({ page }) => {
    await page.goto('/');
    await uploadJson(page, 'essential.json', buildDatabase('essential_db'));
    await expect(page.getByRole('heading', { name: 'essential_db' })).toBeVisible();

    await page.locator('#filter-essential-hint').click();

    const findInput = page.getByLabel('Search text');
    await expect(findInput).toHaveValue('essential');
    await expect(page.locator('.find-bar-count')).toHaveText('1 of 3');
    await expect.poll(() => readHighlight(page, 'search-match')).toEqual(['essential']);

    await findInput.press('Enter');
    await expect(page.locator('.find-bar-count')).toHaveText('2 of 3');
    // The current-match highlight moves to the tree row once that row has been brought into view.
    await expect
      .poll(async () => [...new Set(await readHighlightOwners(page, 'search-match'))])
      .toEqual(['row-database:file:cores/essential.rbf']);
    await expect.poll(() => readHighlight(page, 'search-match-all-filter')).toEqual(['essential']);
    await expect.poll(() => readHighlight(page, 'search-match-all-tags')).toEqual(['essential']);

    await findInput.press('Escape');
    await expect(page.getByRole('search')).toHaveCount(0);
    await expect.poll(() => readHighlight(page, 'search-match')).toBeNull();
    await expect(page.locator('.tree-entry-highlighted')).toHaveCount(0);
  });

  test('a tree match flashes its row for three seconds while its text stays highlighted', async ({ page }) => {
    // The page clock runs normally, but the test can skip ahead instead of waiting out the flash.
    await page.clock.install();
    await page.goto('/');
    await uploadJson(page, 'essential.json', buildDatabase('essential_db'));
    await expect(page.getByRole('heading', { name: 'essential_db' })).toBeVisible();

    await page.locator('#filter-essential-hint').click();
    await page.getByLabel('Search text').press('Enter');

    const row = page.locator('[id="row-database:file:cores/essential.rbf"]');
    await expect(row).toHaveClass(/tree-entry-highlighted/);
    await page.clock.fastForward(1_500);
    await expect(row).toHaveClass(/tree-entry-highlighted/);
    await page.clock.fastForward(2_000);
    // A short timeout, because the page clock keeps running while the assertion retries.
    await expect(row).not.toHaveClass(/tree-entry-highlighted/, { timeout: 1_000 });
    await expect
      .poll(async () => [...new Set(await readHighlightOwners(page, 'search-match'))])
      .toEqual(['row-database:file:cores/essential.rbf']);
  });

  test('closing search right after jumping to a tree match leaves no highlight behind', async ({ page }) => {
    await page.goto('/');
    await uploadJson(page, 'essential.json', buildDatabase('essential_db'));
    await expect(page.getByRole('heading', { name: 'essential_db' })).toBeVisible();

    await page.locator('#filter-essential-hint').click();
    const findInput = page.getByLabel('Search text');
    await findInput.press('Enter');
    await findInput.press('Escape');

    // Longer than the deferred scroll-and-highlight that follows a jump.
    await page.waitForTimeout(1500);
    expect(await readHighlight(page, 'search-match')).toBeNull();
    await expect(page.locator('.tree-entry-highlighted')).toHaveCount(0);
  });
});

test.describe('navigation in large trees', () => {
  const FAR_FILE_PATH = 'games/folder_14/file_00599.rbf';

  test('find-in-page jumps to a row far outside the rendered rows', async ({ page }) => {
    await page.goto('/');
    await uploadJson(page, 'large.json', buildLargeDatabase());
    await expect(page.getByRole('heading', { name: 'large_db' })).toBeVisible();

    // The footer link, unlike Ctrl+F, works even before the shortcut listener is attached.
    await page.locator('.app-footer').getByText('to search').click();
    await expect(page.getByRole('search')).toBeVisible();
    await page.getByLabel('Search text').fill('file_00599.rbf');

    await expect(page.locator(`[id="row-database:file:${FAR_FILE_PATH}"]`)).toBeInViewport();
  });

  test('URL anchors open a row far outside the rendered rows', async ({ page }) => {
    await page.goto(`/#files:${encodeURIComponent(FAR_FILE_PATH)}`);
    await uploadJson(page, 'large.json', buildLargeDatabase());
    await expect(page.getByRole('heading', { name: 'large_db' })).toBeVisible();

    await expect(page.locator(`[id="row-database:file:${FAR_FILE_PATH}"]`)).toBeInViewport();
  });
});

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

function fulfillJson(route, body) {
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

function uploadJson(page, name, body) {
  return uploadText(page, name, JSON.stringify(body), 'application/json');
}

function uploadText(page, name, text, mimeType = 'text/plain') {
  return page.locator('#database-file-input').setInputFiles({
    name,
    mimeType,
    buffer: Buffer.from(text, 'utf8'),
  });
}

async function uploadDatabaseWithFilter(page, filter) {
  await uploadJson(page, 'current.json', buildDatabase('current_db'));
  await expect(page.getByRole('heading', { name: 'current_db' })).toBeVisible();
  await page.getByLabel('FILTER').fill(filter);
  await expect(page.getByLabel('FILTER')).toHaveValue(filter);
}

function readHighlight(page, name) {
  return page.evaluate((highlightName) => {
    const highlight = CSS.highlights.get(highlightName);
    return highlight ? [...highlight].map((range) => range.toString()) : null;
  }, name);
}

function readHighlightOwners(page, name) {
  return page.evaluate((highlightName) => {
    const highlight = CSS.highlights.get(highlightName);
    return highlight
      ? [...highlight].map((range) => range.startContainer.parentElement?.closest('[id]')?.id ?? null)
      : [];
  }, name);
}
