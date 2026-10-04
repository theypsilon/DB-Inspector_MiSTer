import { expect, test } from '@playwright/test';

// Legacy end-to-end tests: replaced by the journeys in tests/journeys/, with their behavior specced
// by tests/unit/flows/ and tests/component/. Kept for reference; LEGACY_E2E=1 runs them.
test.skip(!process.env.LEGACY_E2E, 'Replaced by the journeys in tests/journeys/; set LEGACY_E2E=1 to run it');

const ALPHA_URL = 'https://example.com/combine/alpha.json';
const BETA_URL = 'https://example.com/combine/beta.json';
const ALPHA_TWIN_URL = 'https://example.com/combine/alpha-twin.json';
const GAMMA_URL = 'https://example.com/combine/gamma.json';
const BETA_TWIN_URL = 'https://example.com/combine/beta-twin.json';

const ALPHA = database('alpha', {
  'cores/alpha.rbf': { size: 10, hash: 'a1', tags: [0] },
  'games/shared.rom': { size: 5, hash: 'same' },
});
const BETA = database(
  'beta',
  {
    'cores/beta.rbf': { size: 20, hash: 'b1', tags: [1] },
    'games/shared.rom': { size: 7, hash: 'other' },
  },
  { default_options: { filter: '!console' } },
);

test.beforeEach(async ({ page }) => {
  const sources = [
    [ALPHA_URL, ALPHA],
    [BETA_URL, BETA],
    [ALPHA_TWIN_URL, database('alpha', { 'twin.rbf': { size: 1 } })],
    [GAMMA_URL, database('gamma', { 'gamma.rbf': { size: 1, tags: [0] } })],
    [BETA_TWIN_URL, database('beta', { 'beta-twin.rbf': { size: 1 } })],
  ];
  for (const [url, body] of sources) {
    await page.route(url, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }),
    );
  }
});

test('combining shows both databases, lists the paths they share as collisions, and keeps them in the URL', async ({
  page,
}) => {
  await page.goto('/');
  await fetchDatabase(page, ALPHA_URL);
  await expect(page.getByRole('heading', { name: 'alpha', exact: true })).toBeVisible();

  await fetchDatabase(page, BETA_URL);
  await loadModeDialog(page).getByRole('button', { name: 'Combine' }).click();

  await expect(page.getByRole('heading', { name: '2 combined databases' })).toBeVisible();
  const files = page.locator('#section-files');
  await expect(
    files.locator('.tree-entry', { has: page.getByRole('heading', { name: 'alpha.rbf' }) }).locator('.db-chip'),
  ).toHaveText('alpha');
  // Beta's own default filter (!console) still applies to it.
  await expect(files.getByRole('heading', { name: 'beta.rbf' })).toHaveCount(0);
  await expect(files.getByRole('heading', { name: 'shared.rom' })).toHaveCount(0);

  const collisions = page.locator('#section-collisions');
  await expect(collisions.getByRole('heading', { name: 'shared.rom' })).toHaveCount(3);
  await expect(collisions.locator('.db-chip')).toHaveText(['alpha', 'beta']);
  await expect(page.locator('#section-issues')).toContainText(
    '1 path is claimed by more than one database: alpha, beta.',
  );
  await expect
    .poll(() => decodeURIComponent(new URL(page.url()).search))
    .toBe(`?database-url[alpha]=${ALPHA_URL}&database-url[beta]=${BETA_URL}`);

  // Collided paths can be found like any other row.
  await page.locator('.app-footer').getByText('to search').click();
  await page.getByLabel('Search text').fill('shared.rom');
  await expect(page.locator('.find-bar-count')).toHaveText('1 of 3');
});

test('the load prompt can be cancelled, asks which database stays when its db_id is loaded, and can load alone', async ({
  page,
}) => {
  await page.goto('/');
  await fetchDatabase(page, ALPHA_URL);
  await expect(page.getByRole('heading', { name: 'alpha', exact: true })).toBeVisible();

  await fetchDatabase(page, BETA_URL);
  await loadModeDialog(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(loadModeDialog(page)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'alpha', exact: true })).toBeVisible();

  await fetchDatabase(page, BETA_URL);
  await loadModeDialog(page).getByRole('button', { name: 'Combine' }).click();
  await expect(page.getByRole('heading', { name: '2 combined databases' })).toBeVisible();
  const combinedUrl = page.url();

  // Only one database per db_id can be loaded: the user chooses which one stays.
  await fetchDatabase(page, ALPHA_TWIN_URL);
  await loadModeDialog(page).getByRole('button', { name: 'Combine' }).click();
  const replaceDialog = page.getByRole('dialog', { name: 'Replace the loaded database?' });
  await expect(replaceDialog).toContainText('A database with the db_id alpha is already loaded.');
  await expect(replaceDialog.locator('.filter-override-grid')).toHaveText(`Loaded${ALPHA_URL}New${ALPHA_TWIN_URL}`);
  await replaceDialog.getByRole('button', { name: 'Keep the loaded one' }).click();
  await expect(replaceDialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '2 combined databases' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'twin.rbf' })).toHaveCount(0);
  expect(page.url()).toBe(combinedUrl);

  // Escape keeps the loaded one too.
  await fetchDatabase(page, ALPHA_TWIN_URL);
  await loadModeDialog(page).getByRole('button', { name: 'Combine' }).click();
  await expect(replaceDialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(replaceDialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'twin.rbf' })).toHaveCount(0);
  expect(page.url()).toBe(combinedUrl);

  await fetchDatabase(page, ALPHA_TWIN_URL);
  await loadModeDialog(page).getByRole('button', { name: 'Combine' }).click();
  await replaceDialog.getByRole('button', { name: 'Replace it' }).click();
  await expect(page.locator('.combined-database-card h3')).toHaveText(['alpha', 'beta']);
  await expect(page.getByRole('heading', { name: 'twin.rbf' })).toBeVisible();
  await expect(page.locator('#section-files').getByRole('heading', { name: 'alpha.rbf' })).toHaveCount(0);
  await expect
    .poll(() => decodeURIComponent(new URL(page.url()).search))
    .toBe(`?database-url[alpha]=${ALPHA_TWIN_URL}&database-url[beta]=${BETA_URL}`);

  await fetchDatabase(page, ALPHA_TWIN_URL);
  await loadModeDialog(page).getByRole('button', { name: 'Load alone' }).click();
  await expect(page.getByRole('heading', { name: 'twin.rbf' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '2 combined databases' })).toHaveCount(0);
  await expect.poll(() => decodeURIComponent(new URL(page.url()).search)).toBe(`?database-url=${ALPHA_TWIN_URL}`);
});

test('combined databases share a [mister] filter and can have their own, kept in the URL and in history', async ({
  page,
}) => {
  await page.goto('/');
  await fetchDatabase(page, ALPHA_URL);
  await expect(page.getByRole('heading', { name: 'alpha', exact: true })).toBeVisible();
  await fetchDatabase(page, BETA_URL);
  await loadModeDialog(page).getByRole('button', { name: 'Combine' }).click();

  const applied = page.getByRole('list', { name: 'Filter applied to each database' }).getByRole('listitem');
  await expect(applied).toHaveText(['alphaEverythingno filter', 'beta!consoledatabase default']);

  // Beta's default does not include [mister], so the shared filter replaces it, as in Downloader.
  await page.getByLabel('FILTER', { exact: true }).fill('arcade');
  await expect(applied).toHaveText(['alphaarcadeshared filter', 'betaarcadeshared filter']);

  await page.getByLabel('Give a database its own filter').selectOption('beta');
  await page.getByLabel('FILTER for beta').fill('[mister] console');
  await expect(applied).toHaveText(['alphaarcadeshared filter', 'betaarcade consoleits own filter']);
  await expect(page.locator('#section-files').getByRole('heading', { name: 'beta.rbf' })).toBeVisible();
  await expect
    .poll(() => decodeURIComponent(new URL(page.url()).search))
    .toBe(`?database-url[alpha]=${ALPHA_URL}&database-url[beta]=${BETA_URL}&filter=arcade&filter[beta]=[mister] console`);

  await page.reload();
  await expect(page.getByRole('heading', { name: '2 combined databases' })).toBeVisible();
  await expect(page.getByLabel('FILTER', { exact: true })).toHaveValue('arcade');
  await expect(page.getByLabel('FILTER for beta')).toHaveValue('[mister] console');

  await page.goBack();
  await expect(page.getByRole('heading', { name: 'alpha', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '2 combined databases' })).toHaveCount(0);
  await page.goForward();
  await expect(page.getByRole('heading', { name: '2 combined databases' })).toBeVisible();
  await expect(applied).toHaveText(['alphaarcadeshared filter', 'betaarcade consoleits own filter']);
});

test('uploads and database list entries can be combined too, and uploads stay out of the URL', async ({ page }) => {
  await page.goto('/');
  await fetchDatabase(page, ALPHA_URL);
  await expect(page.getByRole('heading', { name: 'alpha', exact: true })).toBeVisible();

  await upload(page, 'beta.json', JSON.stringify(BETA));
  await loadModeDialog(page).getByRole('button', { name: 'Combine' }).click();
  await expect(page.getByRole('heading', { name: '2 combined databases' })).toBeVisible();

  await upload(page, 'downloader.ini', `[mister]\nfilter=arcade\n\n[gamma]\ndb_url=${GAMMA_URL}\n\n[other]\ndb_url=${BETA_URL}\n`);
  // The list's picker opens first; combining is asked once its databases are chosen.
  await page.getByRole('button', { name: 'Select none' }).click();
  await page.getByRole('checkbox', { name: 'gamma', exact: true }).check();
  await page.getByRole('button', { name: 'Open selected database' }).click();
  await loadModeDialog(page).getByRole('button', { name: 'Combine' }).click();

  await expect(page.getByRole('heading', { name: '3 combined databases' })).toBeVisible();
  // Gamma keeps the filter its list gives it ([mister] = arcade) as its own.
  await expect(
    page.getByRole('list', { name: 'Filter applied to each database' }).getByRole('listitem').nth(2),
  ).toHaveText('gammaarcadeits own filter');
  await expect
    .poll(() => decodeURIComponent(new URL(page.url()).search))
    .toBe(`?database-url[alpha]=${ALPHA_URL}&database-url[gamma]=${GAMMA_URL}&filter[gamma]=arcade`);
});

test('databases chosen together leave out those whose db_id is taken, and report what failed', async ({ page }) => {
  const missingUrl = 'https://example.com/combine/missing.json';
  await page.route(missingUrl, (route) => route.fulfill({ status: 404, contentType: 'text/plain', body: 'missing' }));
  await page.goto('/');

  // Opened alone: within the selection, the first database with a db_id wins.
  await upload(page, 'downloader.ini', `[twin]\ndb_url=${ALPHA_TWIN_URL}\n\n[gamma]\ndb_url=${GAMMA_URL}\n\n[alpha]\ndb_url=${ALPHA_URL}\n`);
  await page.getByRole('button', { name: 'Open 3 selected databases' }).click();
  await expect(page.getByRole('heading', { name: '2 combined databases' })).toBeVisible();
  await expect(page.locator('.combined-database-card h3')).toHaveText(['alpha', 'gamma']);
  await expect(page.getByRole('heading', { name: 'twin.rbf' })).toBeVisible();
  await expect(
    page.getByText(`Another selected database has the db_id alpha, so ${ALPHA_URL} was not opened.`),
  ).toBeVisible();

  // Combined with the loaded ones: a database whose db_id is loaded replaces it only when the user
  // says so, and a selected database that is itself loaded (gamma) just stays.
  await upload(
    page,
    'downloader.ini',
    `[beta]\ndb_url=${BETA_URL}\n\n[alpha]\ndb_url=${ALPHA_URL}\n\n[gamma]\ndb_url=${GAMMA_URL}\n`,
  );
  await page.getByRole('button', { name: 'Open 3 selected databases' }).click();
  await loadModeDialog(page).getByRole('button', { name: 'Combine' }).click();
  await page
    .getByRole('dialog', { name: 'Replace the loaded database?' })
    .getByRole('button', { name: 'Keep the loaded one' })
    .click();
  await expect(page.getByRole('heading', { name: '3 combined databases' })).toBeVisible();
  await expect(page.locator('.combined-database-card h3')).toHaveText(['alpha', 'gamma', 'beta']);
  await expect(page.getByRole('heading', { name: 'twin.rbf' })).toBeVisible();
  await expect(page.locator('.status.error')).toHaveCount(0);
  await expectOneDatabasePerDbId(page);

  // Several databases with loaded db_ids: each one replaces the loaded one or stays out.
  const replaceDialog = page.getByRole('dialog', { name: 'Replace loaded databases?' });
  const replacing = `[alpha]\ndb_url=${ALPHA_URL}\n\n[other]\ndb_url=${BETA_TWIN_URL}\n`;
  await upload(page, 'replacing.ini', replacing);
  await page.getByRole('button', { name: 'Open 2 selected databases' }).click();
  await loadModeDialog(page).getByRole('button', { name: 'Combine' }).click();
  await expect(replaceDialog.getByRole('checkbox')).toHaveCount(2);
  await replaceDialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('.combined-database-card h3')).toHaveText(['alpha', 'gamma', 'beta']);
  await expect(page.getByRole('heading', { name: 'twin.rbf' })).toBeVisible();

  await upload(page, 'replacing.ini', replacing);
  await page.getByRole('button', { name: 'Open 2 selected databases' }).click();
  await loadModeDialog(page).getByRole('button', { name: 'Combine' }).click();
  await replaceDialog.getByRole('checkbox', { name: 'Replace beta' }).uncheck();
  await replaceDialog.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('.combined-database-card h3')).toHaveText(['alpha', 'gamma', 'beta']);
  await expect(page.locator('#section-files').getByRole('heading', { name: 'alpha.rbf' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'twin.rbf' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'beta-twin.rbf' })).toHaveCount(0);
  await expectOneDatabasePerDbId(page);

  // When only one of them opens, it is shown alone.
  await upload(page, 'downloader.ini', `[missing]\ndb_url=${missingUrl}\n\n[gamma]\ndb_url=${GAMMA_URL}\n`);
  await page.getByRole('button', { name: 'Open 2 selected databases' }).click();
  await loadModeDialog(page).getByRole('button', { name: 'Load alone' }).click();
  await expect(page.getByRole('heading', { name: 'gamma', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: /combined databases/ })).toHaveCount(0);
  await expect(page.getByText(`${missingUrl}: Request failed with 404 Not Found.`)).toBeVisible();
  await expect.poll(() => decodeURIComponent(new URL(page.url()).search)).toBe(`?database-url=${GAMMA_URL}`);
});

// No two loaded databases ever share a db_id.
async function expectOneDatabasePerDbId(page) {
  const dbIds = await page.locator('.combined-database-card h3').allTextContents();
  expect(new Set(dbIds).size).toBe(dbIds.length);
}

function database(dbId, files, extra = {}) {
  return {
    db_id: dbId,
    v: 1,
    timestamp: 1710000000,
    base_files_url: `https://example.com/${dbId}/`,
    tag_dictionary: { arcade: 0, console: 1 },
    files,
    folders: {},
    ...extra,
  };
}

async function fetchDatabase(page, url) {
  await page.getByLabel('URL').fill(url);
  await page.getByRole('button', { name: 'Fetch database' }).click();
}

function upload(page, name, text) {
  return page.locator('#database-file-input').setInputFiles({
    name,
    mimeType: name.endsWith('.json') ? 'application/json' : 'text/plain',
    buffer: Buffer.from(text, 'utf8'),
  });
}

function loadModeDialog(page) {
  return page.getByRole('dialog', { name: 'Combine with the loaded databases?' });
}
