import { expect, test } from '@playwright/test';
import { strToU8, zipSync } from 'fflate';

// The catalog in a real browser: entries from Update All and MultiDatabases, databases fetched by
// URL joining it, approximate IDs, the Update All defaults, the db_id question, select all, when
// opening asks to combine, and reviewing the selection.

const RUNTIME_CATALOG_URL = 'https://raw.githubusercontent.com/theypsilon/Update_All_MiSTer/master/src/update_all/databases.py';
const MULTIDATABASES_CATALOG_URL = 'https://raw.githubusercontent.com/theypsilon/MultiDatabases_MiSTer/main/README.md';
const UPDATE_ALL_URL = 'https://raw.githubusercontent.com/theypsilon/Update_All_MiSTer/db/update_all_db.json';
const PINNED_URL = 'https://raw.githubusercontent.com/theypsilon/MultiDatabases_MiSTer/db/distribution-mister-pinned-linux/db.json.zip';
const JTCORES_URL = 'https://raw.githubusercontent.com/jotego/jtcores_mister/main/jtbindb.json.zip';
const COIN_OP_URL = 'https://raw.githubusercontent.com/Coin-OpCollection/Distribution-MiSTerFPGA/db/db.json.zip';
const EDGE_URL = 'https://raw.githubusercontent.com/MiSTer-devel/Distribution_MiSTer/main/db.json.zip';
const ARCADE_URL = 'https://example.com/catalog/arcade.json';
const EXTRA_URL = 'https://raw.githubusercontent.com/theypsilon/MultiDatabases_MiSTer/db/extra/db.json';
const CUSTOM_URL = 'https://example.com/custom.json';

// Edge Linux comes before the pinned Main Distribution, so "first" and "Update All default" differ.
const RUNTIME_CATALOG_SOURCE = `
self.UPDATE_ALL_MISTER = Database(db_id='update_all_mister', db_url='${UPDATE_ALL_URL}', title='Update All files')
self.MISTER_DEVEL_DISTRIBUTION_MISTER = Database(db_id='distribution_mister', db_url='${EDGE_URL}', title='Main Distribution: MiSTer-devel (Edge Linux)')
self.MISTER_PINNED_LINUX_DISTRIBUTION_MISTER = Database(db_id='distribution_mister', db_url='${PINNED_URL}', title='Main Distribution: MiSTer-devel')
self.JTCORES = Database(db_id='jtcores', db_url='${JTCORES_URL}', title='JTCORES for MiSTer')
self.ARCADE_ROMS = Database(db_id='arcade_roms_db', db_url='${ARCADE_URL}', title='Arcade ROMs Database')
self.COIN_OP_COLLECTION = Database(db_id='Coin-OpCollection/Distribution-MiSTerFPGA', db_url='${COIN_OP_URL}', title='Coin-Op Collection')
`;
const MULTIDATABASES_CATALOG_SOURCE = `
| Database | What it installs | Links |
| --- | --- | --- |
| [Main duplicate](duplicate/) | Duplicate | [Inspect](https://theypsilon.github.io/DB-Inspector_MiSTer/?database-url=${encodeURIComponent(PINNED_URL)}) |
| [Extra](extra/) | Extra files | [Inspect](https://theypsilon.github.io/DB-Inspector_MiSTer/?database-url=${encodeURIComponent(EXTRA_URL)}) |
`;

const DATABASES = [
  [UPDATE_ALL_URL, 'update_all_mister'],
  [EDGE_URL, 'distribution_mister'],
  [PINNED_URL, 'distribution_mister'],
  [JTCORES_URL, 'jtcores'],
  [ARCADE_URL, 'arcade_roms_db'],
  [COIN_OP_URL, 'Coin-OpCollection/Distribution-MiSTerFPGA'],
  [EXTRA_URL, 'extra_db'],
  [CUSTOM_URL, 'distribution_mister'],
];
const UPDATE_ALL_DEFAULTS = [
  'Update All files (update_all_mister)',
  'Main Distribution: MiSTer-devel (distribution_mister)',
  'JTCORES for MiSTer (jtcores)',
  'Coin-Op Collection (Coin-OpCollection/Distribution-MiSTerFPGA)',
];
const EDGE = 'Main Distribution: MiSTer-devel (Edge Linux) (distribution_mister)';

test.beforeEach(async ({ page }) => {
  await page.route(RUNTIME_CATALOG_URL, (route) => route.fulfill({ status: 200, contentType: 'text/plain', body: RUNTIME_CATALOG_SOURCE }));
  await page.route(MULTIDATABASES_CATALOG_URL, (route) => route.fulfill({ status: 200, contentType: 'text/markdown', body: MULTIDATABASES_CATALOG_SOURCE }));
  for (const [url, dbId] of DATABASES) {
    const json = JSON.stringify({
      db_id: dbId,
      v: 1,
      timestamp: 1710000000,
      base_files_url: 'https://example.com/files/',
      tag_dictionary: { arcade: 0, console: 1 },
      files: { [`cores/${dbId.replaceAll('/', '_')}.rbf`]: { size: 1, hash: dbId, tags: [0] }, 'cores/console.rbf': { size: 2, hash: dbId, tags: [1] } },
      folders: {},
    });
    const zipped = url.endsWith('.zip');
    await page.route(url, (route) =>
      route.fulfill({
        status: 200,
        contentType: zipped ? 'application/zip' : 'application/json',
        body: zipped ? Buffer.from(zipSync({ 'db.json': strToU8(json) })) : json,
      }),
    );
  }
});

test('the catalog lists known databases and opens them alone or together', async ({ page }) => {
  const loadMode = page.getByRole('dialog', { name: 'Combine with the loaded databases?' });
  await page.goto('/');
  await expect(page.getByText('7 entries available')).toBeVisible();

  await test.step('a database fetched from a catalog URL is that catalog entry', async () => {
    await fetchDatabase(page, ARCADE_URL);
    await expect(page.getByRole('heading', { name: 'arcade_roms_db', exact: true })).toBeVisible();
    await expect(page.getByText('7 entries available')).toBeVisible();
    const catalog = await openCatalog(page, 7);
    await expect(catalog.locator('.catalog-loaded-badge')).toHaveCount(1);
    await expect(catalog.locator('.catalog-option').filter({ hasText: 'Arcade ROMs Database' })).toContainText('Loaded');
    await catalog.getByRole('button', { name: 'Close', exact: true }).click();
  });

  await test.step('a database fetched from another URL joins the catalog, next to those that share its db_id', async () => {
    await fetchDatabase(page, CUSTOM_URL);
    await loadMode.getByRole('button', { name: 'Load alone' }).click();
    await expect(page.getByText('8 entries available')).toBeVisible();
    const catalog = await openCatalog(page, 8);
    await expect(catalog.locator('.catalog-option').filter({ hasText: 'example.com / custom.json' })).toHaveCount(1);
    await expect(catalog.locator('.catalog-option').filter({ hasText: 'Main Distribution: MiSTer-devel' })).toHaveCount(2);
    await catalog.getByRole('button', { name: 'Close', exact: true }).click();
  });

  await test.step('an approximate ID says so until its database is opened', async () => {
    let catalog = await openCatalog(page, 8);
    const extra = catalog.locator('.catalog-option').filter({ hasText: 'Extra' });
    await expect(extra).toContainText('MultiDatabases/extra');
    const approximation = extra.locator('.catalog-id-approximation');
    await approximation.hover();
    await expect(approximation.getByRole('tooltip')).toBeVisible();
    await expect(approximation.getByRole('tooltip')).toHaveText('The real database ID will be determined when the database is opened.');
    await expect(catalog.locator('.catalog-option').filter({ hasText: 'Main duplicate' })).toHaveCount(0);

    await extra.click();
    await catalog.getByRole('button', { name: 'Open selected database' }).click();
    await loadMode.getByRole('button', { name: 'Load alone' }).click();
    await expect(page.getByRole('heading', { name: 'extra_db', exact: true })).toBeVisible();

    catalog = await openCatalog(page, 8);
    const opened = catalog.locator('.catalog-option').filter({ hasText: 'Extra' });
    await expect(opened).toContainText('extra_db');
    await expect(opened).not.toContainText('Approximate ID');
    await expect(opened.locator('.catalog-loaded-badge')).toHaveText('Loaded');
    await catalog.getByRole('button', { name: 'Close', exact: true }).click();
  });

  await test.step('the Update All defaults, the db_id question, and select all', async () => {
    const catalog = await openCatalog(page, 8);
    await catalog.getByRole('button', { name: 'Select Update All defaults' }).click();
    await expect.poll(() => selectedNames(page)).toEqual(UPDATE_ALL_DEFAULTS);

    const edge = catalog.getByRole('checkbox', { name: EDGE, exact: true });
    const question = page.getByRole('dialog', { name: 'Replace the selected database?' });
    await edge.click();
    await expect(question).toContainText('Another selected database has the db_id distribution_mister.');
    // Escape answers the question, not the catalog.
    await page.keyboard.press('Escape');
    await expect(question).toHaveCount(0);
    await expect(catalog).toBeVisible();
    await expect(edge).not.toBeChecked();
    await edge.click();
    await question.getByRole('button', { name: 'Replace' }).click();
    await expect(edge).toBeChecked();

    // Select all keeps the database chosen for a db_id.
    await catalog.getByRole('button', { name: 'Select all' }).click();
    await expect(edge).toBeChecked();
    await expect(catalog.getByRole('button', { name: 'Open 6 selected databases' })).toBeVisible();
    await catalog.getByRole('button', { name: 'Select none' }).click();
    await expect.poll(() => selectedNames(page)).toEqual([]);
    await catalog.getByRole('button', { name: 'Select Update All defaults' }).click();
  });

  await test.step('opening asks to combine only when it would close a loaded database', async () => {
    const catalog = page.getByRole('dialog', { name: 'Browse database catalog' });
    await catalog.getByRole('button', { name: 'Open 4 selected databases' }).click();
    await expect(loadMode).toContainText('Load the 4 selected databases alone to replace it');
    await loadMode.getByRole('button', { name: 'Combine' }).click();
    await expect(page.getByRole('heading', { name: '5 combined databases' })).toBeVisible();
    await expect(page.locator('.combined-database-card h3')).toHaveText([
      'extra_db',
      'update_all_mister',
      'distribution_mister',
      'jtcores',
      'Coin-OpCollection/Distribution-MiSTerFPGA',
    ]);

    // Every loaded database is part of this selection, so it opens afresh without a question.
    const again = await openCatalog(page, 8);
    await again.getByRole('button', { name: 'Select all' }).click();
    await again.getByRole('button', { name: 'Open 6 selected databases' }).click();
    await expect(page.getByRole('heading', { name: '6 combined databases' })).toBeVisible();
    await expect(loadMode).toHaveCount(0);
    await expect.poll(() => new URLSearchParams(new URL(page.url()).hash.slice(1)).getAll('db')).toContain(JTCORES_URL);
  });

  await test.step('more than three databases list compactly, each opening on its own, in a section that collapses', async () => {
    const section = page.locator('#section-database');
    const rows = section.locator('.combined-database-row');
    await expect(rows).toHaveCount(6);
    const row = (dbId) => rows.filter({ has: page.getByRole('heading', { name: dbId, exact: true }) });
    await expect(row('jtcores').getByText('Loaded from')).toBeHidden();
    await row('jtcores').locator('summary').click();
    await expect(row('jtcores').getByText('Loaded from')).toBeVisible();
    await expect(row('jtcores').getByRole('button', { name: 'Install' })).toBeVisible();
    await expect(row('update_all_mister').getByText('Loaded from')).toBeHidden();

    // The Detailed toggle sits in the section's summary, and clicking it does not collapse it.
    const toggle = section.getByRole('button', { name: 'Detailed toggle' });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(row('jtcores').getByText('Default filter')).toBeVisible();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');

    const indicator = section.locator('summary.section-summary .summary-indicator');
    await indicator.click();
    await expect(rows.first()).toBeHidden();
    await expect(toggle).toBeVisible();
    await indicator.click();
    await expect(rows.first()).toBeVisible();
  });

  await test.step('on a phone, nothing on the page or in the catalog is wider than the screen', async () => {
    // A long db_id in the compact list (one row open), on rows and in path collisions, in issues and
    // tags, and in the filters, with a filter of its own.
    const viewport = page.viewportSize();
    const link = new URL(page.url()).hash;
    const dbId = 'Coin-OpCollection/Distribution-MiSTerFPGA';
    await page.setViewportSize({ width: 360, height: 800 });
    await page.getByLabel('Give a database its own filter').selectOption(dbId);
    await expect(page.getByLabel(`FILTER for ${dbId}`)).toBeVisible();
    await expect.poll(() => page.evaluate(findWiderThanScreen)).toEqual([]);
    await page.locator('.database-filter-row').getByRole('button', { name: 'Remove' }).click();
    await expect.poll(() => new URL(page.url()).hash).toBe(link);

    // The catalog's selection names it too, and the catalog scrolls only up and down.
    const catalog = await openCatalog(page, 8);
    await catalog.getByRole('button', { name: 'Select all' }).click();
    await expect(catalog.getByRole('button', { name: 'Open 6 selected databases' })).toBeVisible();
    expect(await catalog.locator('.modal-body').evaluate((body) => body.scrollWidth - body.clientWidth)).toBe(0);
    await catalog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.setViewportSize(viewport);
  });

  await test.step('reviewing the selection lists only the selected databases', async () => {
    const catalog = await openCatalog(page, 8);
    await catalog.getByRole('button', { name: 'Select all' }).click();
    await catalog.getByRole('button', { name: 'Review selected' }).click();
    await expect(catalog.getByText('6 of 8 entries')).toBeVisible();
    await catalog.getByRole('checkbox', { name: UPDATE_ALL_DEFAULTS[0], exact: true }).uncheck();
    await expect(catalog.locator('.catalog-option')).toHaveCount(6);
    await catalog.getByRole('button', { name: 'Show all entries' }).click();
    await expect(catalog.getByText('8 of 8 entries')).toBeVisible();

    await catalog.getByRole('button', { name: 'Select all' }).click();
    await catalog.getByRole('button', { name: 'Select none' }).click();
    await catalog.getByRole('checkbox', { name: UPDATE_ALL_DEFAULTS[2], exact: true }).check();
    await catalog.getByRole('button', { name: 'Open selected database' }).click();
    await loadMode.getByRole('button', { name: 'Load alone' }).click();
    await expect(page.getByRole('heading', { name: 'jtcores', exact: true })).toBeVisible();
    await expect.poll(() => new URL(page.url()).hash).toBe(`#db=${JTCORES_URL}`);
  });
});

async function fetchDatabase(page, url) {
  await page.getByLabel('URL').fill(url);
  await page.getByRole('button', { name: 'Fetch database' }).click();
}

// Runs in the page. Nothing when the page fits the screen; otherwise by how much it does not, and
// each element that sticks out past the screen's edge while its parent does not.
function findWiderThanScreen() {
  const overflow = document.documentElement.scrollWidth - window.innerWidth;
  if (overflow <= 0) {
    return [];
  }
  const sticksOut = (element) => element.getBoundingClientRect().right > window.innerWidth;
  const culprits = [...document.body.querySelectorAll('*')]
    .filter((element) => sticksOut(element) && !sticksOut(element.parentElement))
    .map((element) => `<${element.localName} class="${element.getAttribute('class') ?? ''}"> ${element.textContent.slice(0, 60)}`);
  return [`${overflow}px wider than the screen`, ...culprits];
}

async function openCatalog(page, entryCount) {
  await page.getByRole('button', { name: 'Browse catalog' }).click();
  const catalog = page.getByRole('dialog', { name: 'Browse database catalog' });
  await expect(catalog.getByText(`${entryCount} of ${entryCount} entries`)).toBeVisible();
  return catalog;
}

function selectedNames(page) {
  return page
    .getByRole('checkbox', { checked: true })
    .evaluateAll((boxes) => boxes.map((box) => box.getAttribute('aria-label')).filter(Boolean));
}
