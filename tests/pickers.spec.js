import { expect, test } from '@playwright/test';
import { strToU8, zipSync } from 'fflate';

const RUNTIME_CATALOG_URL =
  'https://raw.githubusercontent.com/theypsilon/Update_All_MiSTer/master/src/update_all/databases.py';
const MULTIDATABASES_CATALOG_URL =
  'https://raw.githubusercontent.com/theypsilon/MultiDatabases_MiSTer/main/README.md';

// The four databases Update All installs by default, as its catalog lists them.
const UPDATE_ALL_URL = 'https://raw.githubusercontent.com/theypsilon/Update_All_MiSTer/db/update_all_db.json';
const PINNED_URL =
  'https://raw.githubusercontent.com/theypsilon/MultiDatabases_MiSTer/db/distribution-mister-pinned-linux/db.json.zip';
const JTCORES_URL = 'https://raw.githubusercontent.com/jotego/jtcores_mister/main/jtbindb.json.zip';
const COIN_OP_URL = 'https://raw.githubusercontent.com/Coin-OpCollection/Distribution-MiSTerFPGA/db/db.json.zip';
const EDGE_URL = 'https://raw.githubusercontent.com/MiSTer-devel/Distribution_MiSTer/main/db.json.zip';
const ARCADE_URL = 'https://example.com/pickers/arcade.json';
const EXTRA_URL = 'https://raw.githubusercontent.com/theypsilon/MultiDatabases_MiSTer/db/extra/db.json';

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
];
const UPDATE_ALL_DEFAULTS = [
  'Update All files (update_all_mister)',
  'Main Distribution: MiSTer-devel (distribution_mister)',
  'JTCORES for MiSTer (jtcores)',
  'Coin-Op Collection (Coin-OpCollection/Distribution-MiSTerFPGA)',
];
const EDGE = 'Main Distribution: MiSTer-devel (Edge Linux) (distribution_mister)';

const LIST_INI = `[mister]
filter=arcade

[jtcores]
db_url=${JTCORES_URL}
filter=[mister] console

[arcade_roms_db]
db_url=${ARCADE_URL}
`;

test.beforeEach(async ({ page }) => {
  await page.route(RUNTIME_CATALOG_URL, (route) =>
    route.fulfill({ status: 200, contentType: 'text/plain', body: RUNTIME_CATALOG_SOURCE }),
  );
  await page.route(MULTIDATABASES_CATALOG_URL, (route) =>
    route.fulfill({ status: 200, contentType: 'text/markdown', body: MULTIDATABASES_CATALOG_SOURCE }),
  );
  for (const [url, dbId] of DATABASES) {
    const json = JSON.stringify({
      db_id: dbId,
      v: 1,
      timestamp: 1710000000,
      base_files_url: 'https://example.com/files/',
      tag_dictionary: { arcade: 0, console: 1 },
      files: {
        [`cores/${dbId.replaceAll('/', '_')}.rbf`]: { size: 1, hash: dbId, tags: [0] },
        'cores/console.rbf': { size: 2, hash: dbId, tags: [1] },
      },
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

test('the catalog starts with nothing selected and selects the Update All defaults', async ({ page }) => {
  await page.goto('/');
  const catalog = await openCatalog(page);
  await expect(catalog.locator('.modal-selected')).toContainText('No databases selected.');
  await expect(catalog.getByRole('button', { name: 'Open selected databases' })).toBeDisabled();

  await catalog.getByRole('button', { name: 'Select Update All defaults' }).click();
  await expect.poll(() => selectedNames(page)).toEqual(UPDATE_ALL_DEFAULTS);
  await expect(catalog.locator('.modal-selected')).toContainText('4 databases');
  await expect(catalog.locator('.selection-chips .db-chip')).toHaveText([
    'update_all_mister',
    'distribution_mister',
    'jtcores',
    'Coin-OpCollection/Distribution-MiSTerFPGA',
  ]);

  await catalog.getByRole('button', { name: 'Open 4 selected databases' }).click();
  await expect(page.getByRole('heading', { name: '4 combined databases' })).toBeVisible();
  await expect(page.locator('.combined-database-card h3')).toHaveText([
    'update_all_mister',
    'distribution_mister',
    'jtcores',
    'Coin-OpCollection/Distribution-MiSTerFPGA',
  ]);
  await expect
    .poll(() => decodeURIComponent(new URL(page.url()).search))
    .toBe(
      `?database-url[update_all_mister]=${UPDATE_ALL_URL}&database-url[distribution_mister]=${PINNED_URL}` +
        `&database-url[jtcores]=${JTCORES_URL}&database-url[Coin-OpCollection/Distribution-MiSTerFPGA]=${COIN_OP_URL}`,
    );
});

test('choosing a database whose db_id is selected asks whether to replace it', async ({ page }) => {
  await page.goto('/');
  const catalog = await openCatalog(page);
  await catalog.getByRole('button', { name: 'Select Update All defaults' }).click();
  const pinned = catalog.getByRole('checkbox', { name: UPDATE_ALL_DEFAULTS[1], exact: true });
  const edge = catalog.getByRole('checkbox', { name: EDGE, exact: true });
  const conflict = page.getByRole('dialog', { name: 'Replace the selected database?' });

  await edge.click();
  await expect(conflict).toContainText('Another selected database has the db_id distribution_mister.');
  // Escape cancels the question, not the catalog.
  await page.keyboard.press('Escape');
  await expect(conflict).toHaveCount(0);
  await expect(catalog).toBeVisible();
  await expect(edge).not.toBeChecked();

  await edge.click();
  await conflict.getByRole('button', { name: 'Cancel' }).click();
  await expect(edge).not.toBeChecked();
  await expect(pinned).toBeChecked();

  await edge.click();
  await conflict.getByRole('button', { name: 'Replace' }).click();
  await expect(edge).toBeChecked();
  await expect(pinned).not.toBeChecked();
  await expect.poll(() => selectedNames(page)).toEqual([
    UPDATE_ALL_DEFAULTS[0],
    EDGE,
    UPDATE_ALL_DEFAULTS[2],
    UPDATE_ALL_DEFAULTS[3],
  ]);
});

test('select all picks one database per db_id: the one chosen, else the Update All default', async ({ page }) => {
  await page.goto('/');
  const catalog = await openCatalog(page);
  const allDatabases = [
    UPDATE_ALL_DEFAULTS[0],
    UPDATE_ALL_DEFAULTS[1],
    UPDATE_ALL_DEFAULTS[2],
    'Arcade ROMs Database (arcade_roms_db)',
    UPDATE_ALL_DEFAULTS[3],
    'Extra (MultiDatabases/extra)',
  ];

  await catalog.getByRole('button', { name: 'Select all' }).click();
  await expect.poll(() => selectedNames(page)).toEqual(allDatabases);

  await catalog.getByRole('button', { name: 'Select none' }).click();
  await expect.poll(() => selectedNames(page)).toEqual([]);

  await catalog.getByRole('checkbox', { name: EDGE, exact: true }).check();
  await catalog.getByRole('button', { name: 'Select all' }).click();
  await expect.poll(() => selectedNames(page)).toEqual(allDatabases.with(1, EDGE));
});

test('opening a selection asks first only when it would close a loaded database', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('URL').fill(ARCADE_URL);
  await page.getByRole('button', { name: 'Fetch database' }).click();
  await expect(page.getByRole('heading', { name: 'arcade_roms_db', exact: true })).toBeVisible();
  const prompt = page.getByRole('dialog', { name: 'Combine with the loaded databases?' });

  let catalog = await openCatalog(page);
  await expect(catalog.locator('.catalog-option').filter({ hasText: 'Arcade ROMs Database' })).toContainText('Loaded');
  await catalog.getByRole('button', { name: 'Select Update All defaults' }).click();
  await catalog.getByRole('button', { name: 'Open 4 selected databases' }).click();
  await expect(prompt).toContainText('Load the 4 selected databases alone to replace it');
  await prompt.getByRole('button', { name: 'Combine' }).click();
  await expect(page.getByRole('heading', { name: '5 combined databases' })).toBeVisible();
  await expect(page.locator('.combined-database-card h3')).toHaveText([
    'arcade_roms_db',
    'update_all_mister',
    'distribution_mister',
    'jtcores',
    'Coin-OpCollection/Distribution-MiSTerFPGA',
  ]);

  // Every loaded database is part of this selection, so nothing would close and nothing is asked.
  catalog = await openCatalog(page);
  await expect(catalog.locator('.catalog-loaded-badge')).toHaveCount(5);
  await catalog.getByRole('button', { name: 'Select all' }).click();
  await catalog.getByRole('button', { name: 'Open 6 selected databases' }).click();
  await expect(page.getByRole('heading', { name: '6 combined databases' })).toBeVisible();
  await expect(prompt).toHaveCount(0);
  // The selection is opened afresh, in catalog order, and the approximate catalog ID is replaced
  // by the real one once that database is opened.
  await expect(page.locator('.combined-database-card h3')).toHaveText([
    'update_all_mister',
    'distribution_mister',
    'jtcores',
    'arcade_roms_db',
    'Coin-OpCollection/Distribution-MiSTerFPGA',
    'extra_db',
  ]);

  catalog = await openCatalog(page);
  await catalog.getByRole('checkbox', { name: UPDATE_ALL_DEFAULTS[2], exact: true }).check();
  await catalog.getByRole('button', { name: 'Open selected database' }).click();
  await prompt.getByRole('button', { name: 'Load alone' }).click();
  await expect(page.getByRole('heading', { name: 'jtcores', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: /combined databases/ })).toHaveCount(0);
  await expect.poll(() => decodeURIComponent(new URL(page.url()).search)).toBe(`?database-url=${JTCORES_URL}`);
});

test('databases opened together from the catalog share the current FILTER', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('URL').fill(ARCADE_URL);
  await page.getByRole('button', { name: 'Fetch database' }).click();
  await page.getByLabel('FILTER').fill('console');
  await expect(page.getByLabel('FILTER')).toHaveValue('console');

  const catalog = await openCatalog(page);
  await catalog.getByRole('checkbox', { name: UPDATE_ALL_DEFAULTS[0], exact: true }).check();
  await catalog.getByRole('checkbox', { name: UPDATE_ALL_DEFAULTS[2], exact: true }).check();
  await catalog.getByRole('button', { name: 'Open 2 selected databases' }).click();
  await page.getByRole('dialog', { name: 'Combine with the loaded databases?' }).getByRole('button', { name: 'Load alone' }).click();

  await expect(page.getByRole('heading', { name: '2 combined databases' })).toBeVisible();
  await expect(page.getByLabel('FILTER', { exact: true })).toHaveValue('console');
  await expect(appliedFilters(page)).toHaveText(['update_all_misterconsoleshared filter', 'jtcoresconsoleshared filter']);
  await expect
    .poll(() => decodeURIComponent(new URL(page.url()).search))
    .toBe(`?database-url[update_all_mister]=${UPDATE_ALL_URL}&database-url[jtcores]=${JTCORES_URL}&filter=console`);
});

test('a database list opens with all its databases selected and its [mister] filter applied', async ({ page }) => {
  await page.goto('/');
  await upload(page, 'downloader.ini', LIST_INI);

  const picker = page.getByRole('dialog', { name: 'Choose databases from this list' });
  await expect(picker.getByLabel('Apply the [mister] filter')).toBeChecked();
  await expect(picker.locator('.mister-option code')).toHaveText('arcade');
  await expect(picker.locator('.catalog-option').first()).toContainText('Own filter: [mister] console');
  await expect.poll(() => selectedNames(page)).toEqual(['jtcores', 'arcade_roms_db']);

  await picker.getByRole('button', { name: 'Select none' }).click();
  await expect(picker.locator('.modal-selected')).toContainText('No databases selected.');
  await expect(picker.getByRole('button', { name: 'Open selected databases' })).toBeDisabled();
  await picker.getByRole('button', { name: 'Select all' }).click();

  await picker.getByRole('button', { name: 'Open 2 selected databases' }).click();
  await expect(page.getByRole('heading', { name: '2 combined databases' })).toBeVisible();
  // As in downloader.ini: [mister] is the shared filter and each section's filter is its own.
  await expect(appliedFilters(page)).toHaveText(['jtcoresarcade consoleits own filter', 'arcade_roms_dbarcadeshared filter']);
  await expect(page.getByLabel('FILTER', { exact: true })).toHaveValue('arcade');
  await expect(page.getByLabel('FILTER for jtcores')).toHaveValue('[mister] console');
  await expect
    .poll(() => decodeURIComponent(new URL(page.url()).search))
    .toBe(
      `?database-url[jtcores]=${JTCORES_URL}&database-url[arcade_roms_db]=${ARCADE_URL}` +
        '&filter=arcade&filter[jtcores]=[mister] console',
    );
});

test('a database list can be opened without its [mister] filter', async ({ page }) => {
  await page.goto('/');
  await upload(page, 'downloader.ini', LIST_INI);

  const picker = page.getByRole('dialog', { name: 'Choose databases from this list' });
  await picker.getByLabel('Apply the [mister] filter').uncheck();
  await picker.getByRole('button', { name: 'Open 2 selected databases' }).click();

  await expect(page.getByRole('heading', { name: '2 combined databases' })).toBeVisible();
  await expect(appliedFilters(page)).toHaveText(['jtcoresconsoleits own filter', 'arcade_roms_dbEverythingno filter']);
  await expect
    .poll(() => decodeURIComponent(new URL(page.url()).search))
    .toBe(`?database-url[jtcores]=${JTCORES_URL}&database-url[arcade_roms_db]=${ARCADE_URL}&filter[jtcores]=[mister] console`);
});

test('a database list read while databases are loaded asks to combine only once its databases are chosen', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('URL').fill(UPDATE_ALL_URL);
  await page.getByRole('button', { name: 'Fetch database' }).click();
  await expect(page.getByRole('heading', { name: 'update_all_mister', exact: true })).toBeVisible();

  await upload(page, 'downloader.ini', LIST_INI);
  const picker = page.getByRole('dialog', { name: 'Choose databases from this list' });
  const prompt = page.getByRole('dialog', { name: 'Combine with the loaded databases?' });
  await expect(picker).toBeVisible();
  await expect(prompt).toHaveCount(0);

  await picker.getByRole('button', { name: 'Open 2 selected databases' }).click();
  await expect(prompt).toContainText('Load the 2 selected databases alone to replace it');
  await prompt.getByRole('button', { name: 'Combine' }).click();

  await expect(page.getByRole('heading', { name: '3 combined databases' })).toBeVisible();
  // Joining databases keep what their list gives them, resolved against the list's [mister].
  await expect(appliedFilters(page)).toHaveText([
    'update_all_misterEverythingno filter',
    'jtcoresarcade consoleits own filter',
    'arcade_roms_dbarcadeits own filter',
  ]);
});

test('uploaded databases open again from the catalog, alone or combined', async ({ page }) => {
  const uploaded = (dbId) =>
    JSON.stringify({ db_id: dbId, v: 1, timestamp: 1710000000, files: { [`${dbId}.rbf`]: { size: 1 } }, folders: {} });
  const prompt = page.getByRole('dialog', { name: 'Combine with the loaded databases?' });
  await page.goto('/');
  await upload(page, 'mine.json', uploaded('mine_db'));
  await expect(page.getByRole('heading', { name: 'mine_db', exact: true })).toBeVisible();
  await upload(page, 'other.json', uploaded('other_db'));
  await prompt.getByRole('button', { name: 'Load alone' }).click();
  await expect(page.getByRole('heading', { name: 'other_db', exact: true })).toBeVisible();

  let catalog = await openCatalog(page, 9);
  await catalog.getByRole('checkbox', { name: 'Uploaded: mine.json (mine_db)', exact: true }).check();
  await catalog.getByRole('button', { name: 'Open selected database' }).click();
  await prompt.getByRole('button', { name: 'Load alone' }).click();
  await expect(page.getByRole('heading', { name: 'mine_db', exact: true })).toBeVisible();
  await expect(page.locator('.status.error')).toHaveCount(0);
  expect(new URL(page.url()).searchParams.has('database-url')).toBe(false);

  catalog = await openCatalog(page, 9);
  await expect(catalog.locator('.catalog-option').filter({ hasText: 'Uploaded: mine.json' })).toContainText('Loaded');
  await catalog.getByRole('checkbox', { name: 'Uploaded: other.json (other_db)', exact: true }).check();
  await catalog.getByRole('button', { name: 'Open selected database' }).click();
  await prompt.getByRole('button', { name: 'Combine' }).click();
  await expect(page.locator('.combined-database-card h3')).toHaveText(['mine_db', 'other_db']);

  // Both uploads are part of this selection, so they open again without a question.
  catalog = await openCatalog(page, 9);
  await catalog.getByRole('checkbox', { name: 'Uploaded: mine.json (mine_db)', exact: true }).check();
  await catalog.getByRole('checkbox', { name: 'Uploaded: other.json (other_db)', exact: true }).check();
  await catalog.getByRole('button', { name: 'Open 2 selected databases' }).click();
  await expect(page.getByRole('heading', { name: '2 combined databases' })).toBeVisible();
  await expect(prompt).toHaveCount(0);
  await expect(page.locator('.status.error')).toHaveCount(0);
});

async function openCatalog(page, entryCount = 7) {
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

function appliedFilters(page) {
  return page.getByRole('list', { name: 'Filter applied to each database' }).getByRole('listitem');
}

function upload(page, name, text) {
  return page.locator('#database-file-input').setInputFiles({
    name,
    mimeType: 'text/plain',
    buffer: Buffer.from(text, 'utf8'),
  });
}
