import { inflateRawSync } from 'node:zlib';
import { expect, test } from '@playwright/test';

// Database lists and combined databases in a real browser: collisions, combined filters and their
// links across reload and history, the questions about loaded db_ids, selections that fail or repeat
// a db_id, the question before a list entry replaces FILTER, single-entry lists, loops, and the
// packed link of a long session.

const ALPHA_URL = 'https://example.com/combine/alpha.json';
const BETA_URL = 'https://example.com/combine/beta.json';
const ALPHA_TWIN_URL = 'https://example.com/combine/alpha-twin.json';
const GAMMA_URL = 'https://example.com/combine/gamma.json';
const BETA_TWIN_URL = 'https://example.com/combine/beta-twin.json';
const MISSING_URL = 'https://example.com/combine/missing.json';
const LIST_URL = 'https://example.com/lists/list.ini';
const LOOP_URL = 'https://example.com/lists/loop.ini';
const WITH_FILTER_URL = 'https://example.com/lists/with-filter.json';
const WITHOUT_FILTER_URL = 'https://example.com/lists/without-filter.json';
const PRESERVED_URL = 'https://example.com/lists/preserved.json';
const MANY_URLS = Array.from({ length: 40 }, (_, index) => `https://example.com/combine/many/database_${index}.json`);

function database(dbId, files, extra = {}) {
  return { db_id: dbId, v: 1, timestamp: 1710000000, base_files_url: `https://example.com/${dbId}/`, tag_dictionary: { arcade: 0, console: 1 }, files, folders: {}, ...extra };
}

const LIST_INI = `[MiSTer]
filter=ini-list-default

[WithFilter]
db_url=${WITH_FILTER_URL}
filter=arcade [mister]

[WithoutFilter]
db_url=${WITHOUT_FILTER_URL}
`;

test.beforeEach(async ({ page }) => {
  const sources = [
    [ALPHA_URL, database('alpha', { 'cores/alpha.rbf': { size: 10, hash: 'a1', tags: [0] }, 'games/shared.rom': { size: 5, hash: 'same' } })],
    [BETA_URL, database('beta', { 'cores/beta.rbf': { size: 20, hash: 'b1', tags: [1] }, 'games/shared.rom': { size: 7, hash: 'other' } }, { default_options: { filter: '!console' } })],
    [ALPHA_TWIN_URL, database('alpha', { 'twin.rbf': { size: 1 } })],
    [GAMMA_URL, database('gamma', { 'gamma.rbf': { size: 1, tags: [0] } })],
    [BETA_TWIN_URL, database('beta', { 'beta-twin.rbf': { size: 1 } })],
    [WITH_FILTER_URL, database('with_filter_db', { 'cores/arcade.rbf': { size: 1, tags: [0] } })],
    [WITHOUT_FILTER_URL, database('without_filter_db', { 'cores/arcade.rbf': { size: 1, tags: [0] } })],
    [PRESERVED_URL, database('preserved_db', { 'cores/arcade.rbf': { size: 1, tags: [0] } }, { default_options: { filter: 'arcade [mister]' } })],
  ];
  for (const [url, body] of sources) {
    await page.route(url, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }));
  }
  await page.route(MISSING_URL, (route) => route.fulfill({ status: 404, contentType: 'text/plain', body: 'missing' }));
  await page.route(LIST_URL, (route) => route.fulfill({ status: 200, contentType: 'text/plain', body: LIST_INI }));
  await page.route('https://example.com/combine/many/*.json', (route) => {
    const index = Number(route.request().url().match(/database_(\d+)\.json$/)[1]);
    const body = database(`many_${index}`, { [`many_${index}.rbf`]: { size: 1, tags: [index % 2] } });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.route(LOOP_URL, (route) => route.fulfill({ status: 200, contentType: 'text/plain', body: `[Loop]\ndb_url=${LOOP_URL}\n` }));
});

test('database lists and combined databases', async ({ page }) => {
  const loadMode = page.getByRole('dialog', { name: 'Combine with the loaded databases?' });
  const heading = (name) => page.getByRole('heading', { name, exact: true });
  const link = () => new URL(page.url()).hash;
  await page.goto('/');

  await test.step('combining shows both databases and lists the paths they share as collisions', async () => {
    await fetchDatabase(page, ALPHA_URL);
    await expect(heading('alpha')).toBeVisible();
    await fetchDatabase(page, BETA_URL);
    await loadMode.getByRole('button', { name: 'Cancel' }).click();
    await expect(loadMode).toHaveCount(0);
    await expect(heading('alpha')).toBeVisible();

    await fetchDatabase(page, BETA_URL);
    await loadMode.getByRole('button', { name: 'Combine' }).click();
    await expect(heading('2 combined databases')).toBeVisible();
    const files = page.locator('#section-files');
    await expect(files.locator('.tree-entry', { has: heading('alpha.rbf') }).locator('.db-chip')).toHaveText('alpha');
    // Beta's own default filter (!console) still applies to it.
    await expect(files.getByRole('heading', { name: 'beta.rbf' })).toHaveCount(0);
    const collisions = page.locator('#section-collisions');
    await expect(collisions.getByRole('heading', { name: 'shared.rom' })).toHaveCount(3);
    await expect(collisions.locator('.db-chip')).toHaveText(['alpha', 'beta']);
    await expect(page.locator('#section-issues')).toContainText('1 path is claimed by more than one database: alpha, beta.');
    await expect.poll(link).toBe(`#db=${ALPHA_URL}&db=${BETA_URL}`);

    await page.locator('.app-footer').getByText('to search').click();
    await page.getByLabel('Search text').fill('shared.rom');
    await expect(page.locator('.find-bar-count')).toHaveText('1 of 3');
    await page.getByLabel('Search text').press('Escape');
  });

  await test.step('combined databases share a [mister] filter and can have their own, kept in the link across reload and history', async () => {
    const applied = page.getByRole('list', { name: 'Filter applied to each database' }).getByRole('listitem');
    await expect(applied).toHaveText(['alphaEverythingno filter', 'beta!consoledatabase default']);
    await page.getByLabel('FILTER', { exact: true }).fill('arcade');
    await expect(applied).toHaveText(['alphaarcadeshared filter', 'betaarcadeshared filter']);
    await page.getByRole('button', { name: 'Own filter for a database' }).click();
    await page.getByRole('option', { name: /^beta / }).click();
    await page.getByLabel('FILTER for beta').fill('[mister] console');
    await expect(applied).toHaveText(['alphaarcadeshared filter', 'betaarcade consoleits own filter']);
    await expect(page.locator('#section-files').getByRole('heading', { name: 'beta.rbf' })).toBeVisible();
    await expect.poll(link).toBe(`#db=${ALPHA_URL}&db=${BETA_URL}&filter=arcade&filter.beta=[mister]+console`);

    await page.reload();
    await expect(heading('2 combined databases')).toBeVisible();
    await expect(page.getByLabel('FILTER', { exact: true })).toHaveValue('arcade');
    await expect(page.getByLabel('FILTER for beta')).toHaveValue('[mister] console');
    await page.goBack();
    await expect(heading('alpha')).toBeVisible();
    await expect(heading('2 combined databases')).toHaveCount(0);
    await page.goForward();
    await expect(heading('2 combined databases')).toBeVisible();
    await expect(applied).toHaveText(['alphaarcadeshared filter', 'betaarcade consoleits own filter']);
  });

  await test.step('a database whose db_id is loaded asks which one stays', async () => {
    const question = page.getByRole('dialog', { name: 'Replace the loaded database?' });
    await fetchDatabase(page, ALPHA_TWIN_URL);
    await loadMode.getByRole('button', { name: 'Combine' }).click();
    await expect(question).toContainText('A database with the db_id alpha is already loaded.');
    await expect(question.locator('.filter-override-grid')).toHaveText(`Loaded${ALPHA_URL}New${ALPHA_TWIN_URL}`);
    await question.getByRole('button', { name: 'Keep the loaded one' }).click();
    await expect(heading('twin.rbf')).toHaveCount(0);

    await fetchDatabase(page, ALPHA_TWIN_URL);
    await loadMode.getByRole('button', { name: 'Combine' }).click();
    await expect(question).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(question).toHaveCount(0);
    await expect(heading('twin.rbf')).toHaveCount(0);

    await fetchDatabase(page, ALPHA_TWIN_URL);
    await loadMode.getByRole('button', { name: 'Combine' }).click();
    await question.getByRole('button', { name: 'Replace it' }).click();
    await expect(page.locator('.combined-database-card h3')).toHaveText(['alpha', 'beta']);
    await expect(heading('twin.rbf')).toBeVisible();
    await expect(page.locator('#section-files').getByRole('heading', { name: 'alpha.rbf' })).toHaveCount(0);
  });

  await test.step('several databases with loaded db_ids are answered together, and Cancel changes nothing', async () => {
    const question = page.getByRole('dialog', { name: 'Replace loaded databases?' });
    const replacing = `[alpha]\ndb_url=${ALPHA_URL}\n\n[other]\ndb_url=${BETA_TWIN_URL}\n`;
    await upload(page, 'replacing.ini', replacing);
    await page.getByRole('button', { name: 'Open 2 selected databases' }).click();
    await loadMode.getByRole('button', { name: 'Combine' }).click();
    await expect(question.getByRole('checkbox')).toHaveCount(2);
    await question.getByRole('button', { name: 'Cancel' }).click();
    await expect(heading('twin.rbf')).toBeVisible();

    await upload(page, 'replacing.ini', replacing);
    await page.getByRole('button', { name: 'Open 2 selected databases' }).click();
    await loadMode.getByRole('button', { name: 'Combine' }).click();
    await question.getByRole('checkbox', { name: 'Replace beta' }).uncheck();
    await question.getByRole('button', { name: 'Continue' }).click();
    await expect(page.locator('.combined-database-card h3')).toHaveText(['alpha', 'beta']);
    await expect(page.locator('#section-files').getByRole('heading', { name: 'alpha.rbf' })).toBeVisible();
    await expect(heading('beta-twin.rbf')).toHaveCount(0);
  });

  await test.step('databases chosen together report what failed and leave out a repeated db_id', async () => {
    await upload(page, 'downloader.ini', `[missing]\ndb_url=${MISSING_URL}\n\n[gamma]\ndb_url=${GAMMA_URL}\n`);
    await page.getByRole('button', { name: 'Open 2 selected databases' }).click();
    await loadMode.getByRole('button', { name: 'Load alone' }).click();
    await expect(heading('gamma')).toBeVisible();
    await expect(page.getByText(`${MISSING_URL}: Request failed with 404 Not Found.`)).toBeVisible();
    // The shared FILTER of the combined databases carries over to the one opened alone.
    await expect(page.getByLabel('FILTER')).toHaveValue('arcade');
    await expect.poll(link).toBe(`#db=${GAMMA_URL}&filter=arcade`);

    // Gamma is loaded and selected, so the selection opens afresh without asking.
    await upload(page, 'downloader.ini', `[twin]\ndb_url=${ALPHA_TWIN_URL}\n\n[gamma]\ndb_url=${GAMMA_URL}\n\n[alpha]\ndb_url=${ALPHA_URL}\n`);
    await page.getByRole('button', { name: 'Open 3 selected databases' }).click();
    await expect(heading('2 combined databases')).toBeVisible();
    await expect(page.locator('.combined-database-card h3')).toHaveText(['alpha', 'gamma']);
    await expect(page.getByText(`Another selected database has the db_id alpha, so ${ALPHA_URL} was not opened.`)).toBeVisible();
  });

  await test.step('a remote list stays in the address until an entry opens, with the list’s [mister] filter', async () => {
    // With nothing loaded: databases that are loaded keep the address while a list is chosen from.
    await page.goto('about:blank');
    await page.goto('/');
    await fetchDatabase(page, LIST_URL);
    await expect(page.getByRole('heading', { name: 'Choose databases from this list' })).toBeVisible();
    await expect(page.getByText(`${LIST_URL} contains 2 entries.`)).toBeVisible();
    await expect.poll(link).toBe(`#db=${LIST_URL}`);
    await chooseOnly(page, 'WithoutFilter');
    await page.getByRole('button', { name: 'Open selected database' }).click();
    await expect(heading('without_filter_db')).toBeVisible();
    await expect(page.getByLabel('FILTER')).toHaveValue('ini-list-default');
    await expect.poll(link).toBe(`#db=${WITHOUT_FILTER_URL}`);
  });

  await test.step('a list entry with its own filter asks before replacing a FILTER with terms', async () => {
    const question = page.getByRole('dialog', { name: 'Replace the current filter?' });
    await page.getByLabel('FILTER').fill('manual !keep');
    await fetchDatabase(page, LIST_URL);
    await chooseOnly(page, 'WithFilter');
    await page.getByRole('button', { name: 'Open selected database' }).click();
    await loadMode.getByRole('button', { name: 'Load alone' }).click();
    await expect(question.locator('.filter-override-grid')).toContainText('manual !keep');
    await expect(question.locator('.filter-override-grid')).toContainText('arcade ini-list-default');
    await question.getByRole('button', { name: 'Keep current' }).click();
    await expect(heading('with_filter_db')).toBeVisible();
    await expect(page.getByLabel('FILTER')).toHaveValue('manual !keep');
    await expect.poll(link).toBe(`#db=${WITH_FILTER_URL}&filter=manual+!keep`);

    // The entry is the loaded database this time, so only the FILTER question comes.
    await fetchDatabase(page, LIST_URL);
    await chooseOnly(page, 'WithFilter');
    await page.getByRole('button', { name: 'Open selected database' }).click();
    await question.getByRole('button', { name: 'Replace filter' }).click();
    await expect(heading('with_filter_db')).toBeVisible();
    await expect(page.getByLabel('FILTER')).toHaveValue('arcade ini-list-default');
    await expect(loadMode).toHaveCount(0);
  });

  await test.step('a single-entry list opens its database with the filter Downloader would give it', async () => {
    // A fresh page, with nothing loaded and an empty FILTER: an emptied FILTER that has reached the
    // address would be kept instead.
    await page.goto('about:blank');
    await page.goto('/');
    await upload(page, 'downloader.ini', `[MiSTer]\nfilter=console !cheats\n\n[Preserved]\ndb_url=${PRESERVED_URL}\n`);
    await expect(heading('preserved_db')).toBeVisible();
    await expect(page.getByLabel('FILTER')).toHaveValue('arcade console !cheats');
  });

  await test.step('a list that links back to itself reports a loop', async () => {
    await fetchDatabase(page, LOOP_URL);
    // With a database loaded, a single-entry list asks first, then follows its link.
    await loadMode.getByRole('button', { name: 'Load alone' }).click();
    await expect(page.getByText(`Detected a loop while following linked databases from ${LOOP_URL}.`)).toBeVisible();
  });

  await test.step('a long session is packed into its link, and opens again from it', async () => {
    await page.goto('about:blank');
    await page.goto('/');
    await upload(page, 'many.ini', MANY_URLS.map((url, index) => `[many_${index}]\ndb_url=${url}\n`).join('\n'));
    await page.getByRole('button', { name: 'Open 40 selected databases' }).click();
    await expect(heading('40 combined databases')).toBeVisible();
    const databases = MANY_URLS.map((url) => `db=${url}`).join('&');
    await expect.poll(() => unpackLink(link())).toBe(databases);
    await page.getByLabel('FILTER', { exact: true }).fill('arcade');
    await expect.poll(() => unpackLink(link())).toBe(`${databases}&filter=arcade`);
    expect(link()).toMatch(/^#z=[A-Za-z0-9_-]+$/);
    expect(page.url().length).toBeLessThanOrEqual(2000);

    await page.reload();
    await expect(heading('40 combined databases')).toBeVisible();
    await expect(page.getByLabel('FILTER', { exact: true })).toHaveValue('arcade');
    await expect(page.locator('.combined-database-row')).toHaveCount(40);
  });
});

// What a packed link holds, unpacked as the link format says (raw deflate in base64url), or null
// for a link that is not packed.
function unpackLink(hash) {
  const packed = new URLSearchParams(hash.slice(1)).get('z');
  return packed === null ? null : inflateRawSync(Buffer.from(packed, 'base64url')).toString('utf8');
}

async function fetchDatabase(page, url) {
  await page.getByLabel('URL').fill(url);
  await page.getByRole('button', { name: 'Fetch database' }).click();
}

async function chooseOnly(page, name) {
  await page.getByRole('button', { name: 'Select none' }).click();
  await page.getByRole('checkbox', { name, exact: true }).check();
}

function upload(page, name, text) {
  return page.locator('#database-file-input').setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(text, 'utf8') });
}
