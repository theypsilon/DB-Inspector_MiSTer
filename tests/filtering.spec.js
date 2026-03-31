import { expect, test } from '@playwright/test';

test('FILTER applies downloader-style positive and negative terms across files and archive summaries', async ({
  page,
}) => {
  await page.goto('/');

  await page.locator('#database-file-input').setInputFiles({
    name: 'filter-smoke.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(buildFilterDatabase()), 'utf8'),
  });

  await expect(page.getByRole('heading', { name: 'filter_smoke' })).toBeVisible();

  const filterInput = page.getByLabel('FILTER');
  await filterInput.fill('a !b');

  await expect(page.getByText('Showing 5 files, 5 folders, and 1 archives for this filter.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'file_a.rbf' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'plain.rbf' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'essential.rbf' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'file_b.rbf' })).toHaveCount(0);

  await expect(page.getByRole('heading', { name: 'a.cht' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'plain.cht' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'b.cht' })).toHaveCount(0);
});

test('FILTER ignores inherited terms with a warning and keeps the remaining filter logic', async ({
  page,
}) => {
  await page.goto('/');

  await page.locator('#database-file-input').setInputFiles({
    name: 'filter-smoke.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(buildFilterDatabase()), 'utf8'),
  });

  await expect(page.getByRole('heading', { name: 'filter_smoke' })).toBeVisible();

  const filterInput = page.getByLabel('FILTER');
  await filterInput.fill('[mister] b');

  await expect(page.getByText('Showing 5 files, 5 folders, and 1 archives for this filter.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'file_b.rbf' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'file_a.rbf' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'plain.rbf' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'essential.rbf' })).toBeVisible();
  await expect(page.getByText('Inherited filter terms [mister] are not supported in this inspector and were ignored.')).toBeVisible();
});

test('Archives section disappears when filtering removes every archive entry', async ({ page }) => {
  await page.goto('/');

  await page.locator('#database-file-input').setInputFiles({
    name: 'filter-smoke.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(buildFilterDatabase()), 'utf8'),
  });

  await expect(page.getByRole('heading', { name: 'filter_smoke' })).toBeVisible();

  const filterInput = page.getByLabel('FILTER');
  await filterInput.fill('!all');

  await expect(page.getByRole('heading', { name: 'Archives' })).toHaveCount(0);
});

test('FILTER syncs with the URL for shared remote databases', async ({ page }) => {
  const remoteUrl = 'https://example.com/filter-shared.json';

  await page.route(remoteUrl, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildFilterDatabase()),
    });
  });

  await page.goto(`/?database-url=${encodeURIComponent(remoteUrl)}&filter=${encodeURIComponent('a !b')}`);

  await expect(page.getByRole('heading', { name: 'filter_smoke' })).toBeVisible();
  await expect(page.getByLabel('FILTER')).toHaveValue('a !b');
  await expect(page.getByText('Showing 5 files, 5 folders, and 1 archives for this filter.')).toBeVisible();

  await page.getByLabel('FILTER').fill('b');
  await expect(page.getByText('Showing 5 files, 5 folders, and 1 archives for this filter.')).toBeVisible();
  await expect.poll(() => page.url()).toContain(`filter=${encodeURIComponent('b')}`);
});

test('missing FILTER param uses the database default, clear returns to that default, and explicit empty FILTER still overrides it', async ({
  page,
}) => {
  const remoteUrl = 'https://example.com/filter-default.json';

  await page.route(remoteUrl, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildFilterDatabase({ defaultFilter: 'a' })),
    });
  });

  await page.goto(`/?database-url=${encodeURIComponent(remoteUrl)}`);

  await expect(page.getByRole('heading', { name: 'filter_smoke' })).toBeVisible();
  await expect(page.getByLabel('FILTER')).toHaveValue('a');
  await expect.poll(() => page.url()).not.toContain('filter=');

  await page.getByLabel('FILTER').fill('b');
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.getByLabel('FILTER')).toHaveValue('a');
  await expect.poll(() => page.url()).not.toContain('filter=');

  await page.getByLabel('FILTER').fill('');
  await expect(page.getByLabel('FILTER')).toHaveValue('');
  await expect(page.getByText('Showing the full database: 7 files, 7 folders, 1 archives.')).toBeVisible();
  await expect.poll(() => page.url()).toContain('filter=');
});

test('manual FILTER survives direct URL fetches until it is cleared', async ({ page }) => {
  const remoteUrl = 'https://example.com/filter-preserve-remote.json';

  await page.route(remoteUrl, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildFilterDatabase({ defaultFilter: 'catalog-default' })),
    });
  });

  await page.goto('/');

  await page.locator('#database-file-input').setInputFiles({
    name: 'filter-smoke.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(buildFilterDatabase()), 'utf8'),
  });

  const filterInput = page.getByLabel('FILTER');
  await filterInput.fill('manual !keep');
  await expect(filterInput).toHaveValue('manual !keep');

  await page.getByLabel('URL').fill(remoteUrl);
  await page.getByRole('button', { name: 'Fetch database' }).click();

  await expect(page.getByRole('heading', { name: 'filter_smoke' })).toBeVisible();
  await expect(filterInput).toHaveValue('manual !keep');
  await expect.poll(() => page.url()).toContain(`filter=${encodeURIComponent('manual !keep')}`);
});

test('manual FILTER survives uploaded databases until it is cleared', async ({ page }) => {
  await page.goto('/');

  await page.locator('#database-file-input').setInputFiles({
    name: 'filter-smoke.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(buildFilterDatabase()), 'utf8'),
  });

  const filterInput = page.getByLabel('FILTER');
  await filterInput.fill('manual !keep');
  await expect(filterInput).toHaveValue('manual !keep');

  await page.locator('#database-file-input').setInputFiles({
    name: 'next-filter-smoke.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(buildFilterDatabase({ defaultFilter: 'upload-default' })), 'utf8'),
  });

  await expect(page.getByRole('heading', { name: 'filter_smoke' })).toBeVisible();
  await expect(filterInput).toHaveValue('manual !keep');
});

test('single-entry INI lists apply their resolved section filter to FILTER', async ({ page }) => {
  const iniRemoteUrl = 'https://example.com/filter-preserve-ini.json';

  await page.route(iniRemoteUrl, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildFilterDatabase({ defaultFilter: 'ini-default' })),
    });
  });

  await page.goto('/');

  await page.locator('#database-file-input').setInputFiles({
    name: 'filter-smoke.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(buildFilterDatabase()), 'utf8'),
  });

  const filterInput = page.getByLabel('FILTER');
  await filterInput.fill('manual !keep');
  await expect(filterInput).toHaveValue('manual !keep');

  await page.locator('#database-file-input').setInputFiles({
    name: 'downloader.ini',
    mimeType: 'text/plain',
    buffer: Buffer.from(
      `[MiSTer]
filter=ini-list-default

[Preserved]
db_url=${iniRemoteUrl}
filter=arcade [mister]
`,
      'utf8',
    ),
  });

  await expect(page.getByRole('heading', { name: 'Replace the current filter?' })).toBeVisible();
  await expect(page.getByText('manual !keep')).toBeVisible();
  await expect(page.getByText('arcade ini-list-default')).toBeVisible();
  await page.getByRole('button', { name: 'Replace filter' }).click();

  await expect(page.getByRole('heading', { name: 'filter_smoke' })).toBeVisible();
  await expect(filterInput).toHaveValue('arcade ini-list-default');
});

test('INI filter override confirmation can keep the current FILTER instead', async ({ page }) => {
  const iniRemoteUrl = 'https://example.com/filter-preserve-ini-keep.json';

  await page.route(iniRemoteUrl, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildFilterDatabase({ defaultFilter: 'ini-default' })),
    });
  });

  await page.goto('/');

  await page.locator('#database-file-input').setInputFiles({
    name: 'filter-smoke.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(buildFilterDatabase()), 'utf8'),
  });

  const filterInput = page.getByLabel('FILTER');
  await filterInput.fill('manual !keep');

  await page.locator('#database-file-input').setInputFiles({
    name: 'downloader.ini',
    mimeType: 'text/plain',
    buffer: Buffer.from(
      `[MiSTer]
filter=ini-list-default

[Preserved]
db_url=${iniRemoteUrl}
filter=arcade [mister]
`,
      'utf8',
    ),
  });

  await expect(page.getByRole('heading', { name: 'Replace the current filter?' })).toBeVisible();
  await page.getByRole('button', { name: 'Keep current' }).click();

  await expect(page.getByRole('heading', { name: 'filter_smoke' })).toBeVisible();
  await expect(filterInput).toHaveValue('manual !keep');
});

test('database default FILTER takes precedence over [mister] when the INI entry has no filter', async ({
  page,
}) => {
  const iniRemoteUrl = 'https://example.com/filter-db-precedence.json';

  await page.route(iniRemoteUrl, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildFilterDatabase({ defaultFilter: 'arcade [mister]' })),
    });
  });

  await page.goto('/');

  await page.locator('#database-file-input').setInputFiles({
    name: 'downloader.ini',
    mimeType: 'text/plain',
    buffer: Buffer.from(
      `[MiSTer]
filter=console !cheats

[Preserved]
db_url=${iniRemoteUrl}
`,
      'utf8',
    ),
  });

  await expect(page.getByRole('heading', { name: 'filter_smoke' })).toBeVisible();
  await expect(page.getByLabel('FILTER')).toHaveValue('arcade console !cheats');
});

function buildFilterDatabase({ defaultFilter = '' } = {}) {
  return {
    db_id: 'filter_smoke',
    v: 1,
    timestamp: 1710000000,
    default_options: defaultFilter
      ? {
          filter: defaultFilter,
        }
      : undefined,
    files: {
      'games/A/file_a.rbf': { tags: ['a'] },
      'games/B/file_b.rbf': { tags: ['b'] },
      'games/plain/plain.rbf': {},
      'games/essential/essential.rbf': { tags: ['essential'] },
    },
    folders: {
      'games/A': { tags: ['a'] },
      'games/B': { tags: ['b'] },
      'games/plain': {},
      'games/essential': { tags: ['essential'] },
    },
    archives: {
      filter_archive: {
        description: 'Filter archive',
        format: 'zip',
        extract: 'selective',
        target_folder: 'games/archives/',
        archive_file: {
          url: 'https://example.com/filter-archive.zip',
        },
        summary_inline: {
          files: {
            'games/archives/a.cht': { arc_id: 'filter_archive', arc_at: 'a.cht', tags: ['a'] },
            'games/archives/b.cht': { arc_id: 'filter_archive', arc_at: 'b.cht', tags: ['b'] },
            'games/archives/plain.cht': { arc_id: 'filter_archive', arc_at: 'plain.cht' },
          },
          folders: {
            'games/archives/a': { tags: ['a'] },
            'games/archives/b': { tags: ['b'] },
            'games/archives/plain': {},
          },
        },
      },
    },
  };
}
