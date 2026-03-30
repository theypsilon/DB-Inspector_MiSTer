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

test('missing FILTER param uses the database default, while explicit empty FILTER overrides it', async ({
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

  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.getByLabel('FILTER')).toHaveValue('');
  await expect(page.getByText('Showing the full database: 7 files, 7 folders, 1 archives.')).toBeVisible();
  await expect.poll(() => page.url()).toContain('filter=');
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
