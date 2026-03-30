import { expect, test } from '@playwright/test';

const RUNTIME_CATALOG_URL =
  'https://raw.githubusercontent.com/theypsilon/Update_All_MiSTer/master/src/update_all/databases.py';

const RUNTIME_CATALOG_SOURCE = `
PRIMARY_URL = "https://example.com/primary.json"
ALTERNATE_URL = "https://example.com/alternate.json"
OTHER_URL = "https://example.com/other.json"
self.primary = Database(db_id='distribution_mister', db_url=PRIMARY_URL, title='Primary Distribution')
self.alternate = Database(db_id='distribution_mister', db_url=ALTERNATE_URL, title='Alternate Distribution')
self.other = Database(db_id='other_db', db_url=OTHER_URL, title='Other Database')
`;

test.beforeEach(async ({ page }) => {
  await page.route(RUNTIME_CATALOG_URL, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/plain; charset=utf-8',
      body: RUNTIME_CATALOG_SOURCE,
    });
  });

  await page.route('https://example.com/**', async (route) => {
    const url = route.request().url();
    const pathname = new URL(url).pathname;

    if (pathname === '/alias-alternate.json') {
      await route.fulfill({
        status: 302,
        headers: {
          location: 'https://example.com/alternate.json',
        },
      });
      return;
    }

    const dbId = pathname === '/other.json' ? 'other_db' : 'distribution_mister';
    const defaultFilter =
      pathname === '/primary.json'
        ? 'catalog-default'
        : pathname === '/alternate.json'
          ? 'alternate-default'
          : '';
    await route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(buildDatabase(dbId, { defaultFilter })),
    });
  });
});

test('loading a new shared-db_id URL keeps sibling catalog entries available', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByText('3 entries available')).toBeVisible();

  await page.getByLabel('URL').fill('https://example.com/custom.json');
  await page.getByRole('button', { name: 'Fetch database' }).click();

  await expect(page.getByRole('heading', { name: 'distribution_mister' })).toBeVisible();
  await expect(page.getByText('4 entries available')).toBeVisible();

  await page.getByRole('button', { name: 'Browse catalog' }).click();

  await expect(page.getByText('4 of 4 entries')).toBeVisible();
  await expect(page.locator('.catalog-option').filter({ hasText: 'Primary Distribution' })).toHaveCount(1);
  await expect(page.locator('.catalog-option').filter({ hasText: 'Alternate Distribution' })).toHaveCount(1);
  await expect(page.locator('.catalog-option').filter({ hasText: 'example.com / custom.json' })).toHaveCount(1);
});

test('loading an alternate URL that redirects to a catalog entry preserves its title', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByText('3 entries available')).toBeVisible();

  await page.getByLabel('URL').fill('https://example.com/alias-alternate.json');
  await page.getByRole('button', { name: 'Fetch database' }).click();

  await expect(page.getByRole('heading', { name: 'distribution_mister' })).toBeVisible();
  await expect(page.getByText('3 entries available')).toBeVisible();

  await page.getByRole('button', { name: 'Browse catalog' }).click();

  await expect(page.getByText('3 of 3 entries')).toBeVisible();
  await expect(page.locator('.modal-selected')).toContainText('Alternate Distribution');
  await expect(page.locator('.catalog-option').filter({ hasText: 'Primary Distribution' })).toHaveCount(1);
  await expect(page.locator('.catalog-option').filter({ hasText: 'Alternate Distribution' })).toHaveCount(1);
});

test('catalog selections keep the active filter until the user clears it', async ({ page }) => {
  await page.goto('/');

  await page.getByLabel('URL').fill('https://example.com/other.json');
  await page.getByRole('button', { name: 'Fetch database' }).click();

  const filterInput = page.getByLabel('FILTER');
  await filterInput.fill('manual !keep');
  await expect(filterInput).toHaveValue('manual !keep');

  await page.getByRole('button', { name: 'Browse catalog' }).click();
  await page.locator('.catalog-option').filter({ hasText: 'Primary Distribution' }).click();
  await page.getByRole('button', { name: 'Open selected database' }).click();

  await expect(page.getByRole('heading', { name: 'distribution_mister' })).toBeVisible();
  await expect(filterInput).toHaveValue('manual !keep');
  await expect.poll(() => page.url()).toContain(`filter=${encodeURIComponent('manual !keep')}`);
});

function buildDatabase(dbId, { defaultFilter = '' } = {}) {
  return {
    db_id: dbId,
    v: 1,
    timestamp: 1710000000,
    default_options: defaultFilter
      ? {
          filter: defaultFilter,
        }
      : undefined,
    files: {},
    folders: {},
    archives: {},
  };
}
