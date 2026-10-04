import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { strToU8, zipSync } from 'fflate';

// Legacy end-to-end tests: replaced by the journeys in tests/journeys/, with their behavior specced
// by tests/unit/flows/ and tests/component/. Kept for reference; LEGACY_E2E=1 runs them.
test.skip(!process.env.LEGACY_E2E, 'Replaced by the journeys in tests/journeys/; set LEGACY_E2E=1 to run it');

const GAMMA_URL = 'https://example.com/uploads/gamma.json';

const ALPHA = database('alpha', { 'alpha.rbf': { size: 1, tags: [0] } });
const ALPHA_FORK = database('alpha', { 'fork.rbf': { size: 2 } });
const BETA = database('beta', { 'beta.rbf': { size: 3 } });
const GAMMA = database('gamma', { 'gamma.rbf': { size: 4 } });
const BETA_ZIP = zipJson(BETA);
const LIST_INI = `[mister]\nfilter=arcade\n\n[gamma]\ndb_url=${GAMMA_URL}\n`;

test.beforeEach(async ({ page }) => {
  await page.route(GAMMA_URL, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(GAMMA) }),
  );
});

test('several chosen files offer their databases, and other files are skipped without a word', async ({ page }) => {
  await page.goto('/');
  await page.locator('#database-file-input').setInputFiles([
    jsonFile('a.json', ALPHA),
    jsonFile('copy-of-a.json', ALPHA),
    { name: 'b.json.zip', mimeType: 'application/zip', buffer: BETA_ZIP },
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') },
    { name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{') },
    jsonFile('settings.json', { theme: 'dark' }),
    { name: 'list.ini', mimeType: 'text/plain', buffer: Buffer.from(LIST_INI) },
  ]);

  const picker = page.getByRole('dialog', { name: 'Choose databases from your files' });
  await expect.poll(() => selectedNames(page)).toEqual(['alpha (a.json)', 'beta (b.json.zip)', 'gamma (list.ini)']);
  await expect(picker.locator('.catalog-option')).toHaveCount(3);
  await expect(picker.locator('.catalog-option').first()).toContainText('From a.json');
  await expect(picker.locator('.mister-option')).toContainText('From list.ini');
  await expect(picker.getByLabel('Apply the [mister] filter')).toBeChecked();
  await expect(page.getByText('Found 3 databases in 3 files.')).toBeVisible();
  await expect(page.locator('.status.error')).toHaveCount(0);

  await picker.getByRole('button', { name: 'Open 3 selected databases' }).click();
  await expect(page.getByRole('heading', { name: '3 combined databases' })).toBeVisible();
  await expect(appliedFilters(page)).toHaveText([
    'alphaarcadeshared filter',
    'betaarcadeshared filter',
    'gammaarcadeshared filter',
  ]);
  // Uploaded databases cannot be shared, so only the list's remote database is in the address.
  await expect
    .poll(() => new URL(page.url()).hash)
    .toBe(`#db=${GAMMA_URL}&filter=arcade`);

  // Files with the same content as loaded databases are marked as loaded.
  await page.locator('#database-file-input').setInputFiles([
    jsonFile('again.json', ALPHA),
    { name: 'again.json.zip', mimeType: 'application/zip', buffer: BETA_ZIP },
    jsonFile('fork.json', ALPHA_FORK),
  ]);
  await expect(picker.locator('.catalog-option')).toHaveCount(3);
  await expect(picker.locator('.catalog-loaded-badge')).toHaveCount(2);
  await expect(picker.locator('.catalog-option').filter({ hasText: 'fork.json' }).locator('.catalog-loaded-badge')).toHaveCount(0);
});

test('a dropped folder offers the databases of all its folders, one selected per db_id', async ({ page }, testInfo) => {
  const root = testInfo.outputPath('my-dbs');
  writeFiles(root, {
    'one/alpha.json': JSON.stringify(ALPHA),
    'one/deep/beta.json.zip': zipJson(BETA),
    'two/alpha-copy.json': JSON.stringify(ALPHA),
    'two/alpha-fork.json': JSON.stringify(ALPHA_FORK),
    'two/list.ini': LIST_INI,
    'readme.md': '# My databases',
  });

  await page.goto('/');
  await dropFromDisk(page, [root]);

  const picker = page.getByRole('dialog', { name: 'Choose databases from your files' });
  await expect(picker.locator('.catalog-option')).toHaveCount(4);
  await expect.poll(() => selectedNames(page)).toEqual([
    'alpha (my-dbs/one/alpha.json)',
    'beta (my-dbs/one/deep/beta.json.zip)',
    'gamma (my-dbs/two/list.ini)',
  ]);

  // Only one database per db_id can be selected.
  await picker.getByRole('checkbox', { name: 'alpha (my-dbs/two/alpha-fork.json)' }).click();
  await page.getByRole('dialog', { name: 'Replace the selected database?' }).getByRole('button', { name: 'Replace' }).click();
  await expect.poll(() => selectedNames(page)).toEqual([
    'beta (my-dbs/one/deep/beta.json.zip)',
    'alpha (my-dbs/two/alpha-fork.json)',
    'gamma (my-dbs/two/list.ini)',
  ]);

  await picker.getByRole('button', { name: 'Open 3 selected databases' }).click();
  await expect(page.getByRole('heading', { name: '3 combined databases' })).toBeVisible();
  await expect(page.locator('.combined-database-card h3')).toHaveText(['beta', 'alpha', 'gamma']);
  await expect(page.getByRole('heading', { name: 'fork.rbf' })).toBeVisible();
});

test('several lists offer their [mister] filters to choose one from, and a folder always opens the picker', async ({
  page,
}, testInfo) => {
  const root = testInfo.outputPath('lists');
  writeFiles(root, {
    'a/downloader.ini': LIST_INI,
    'b/other.ini': `[mister]\nfilter=console\n\n[alpha_list]\ndb_url=${GAMMA_URL.replace('gamma.json', 'alpha.json')}\n`,
  });
  const single = testInfo.outputPath('single');
  writeFiles(single, { 'alpha.json': JSON.stringify(ALPHA) });
  await page.route(GAMMA_URL.replace('gamma.json', 'alpha.json'), (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(database('alpha_list', {})) }),
  );

  await page.goto('/');
  await dropFromDisk(page, [root]);
  const picker = page.getByRole('dialog', { name: 'Choose databases from your files' });
  const misterChoices = picker.getByRole('group', { name: '[mister] sections' }).getByRole('radio');
  await expect(misterChoices).toHaveCount(3);
  await expect(misterChoices.nth(0)).toBeChecked();
  await expect(picker.locator('.mister-option')).toContainText('From lists/a/downloader.ini');

  await misterChoices.nth(1).check();
  await picker.getByRole('button', { name: 'Open 2 selected databases' }).click();
  await expect(appliedFilters(page)).toHaveText(['gammaconsoleshared filter', 'alpha_listconsoleshared filter']);

  // A folder offers its databases even when it holds only one.
  await dropFromDisk(page, [single]);
  await expect(picker).toBeVisible();
  await expect.poll(() => selectedNames(page)).toEqual(['alpha (single/alpha.json)']);
});

test('databases opened together share the chosen [mister] filter, else the current FILTER', async ({ page }) => {
  await page.goto('/');
  await page.locator('#database-file-input').setInputFiles([jsonFile('beta.json', BETA)]);
  await page.getByLabel('FILTER').fill('console');
  await expect(page.getByLabel('FILTER')).toHaveValue('console');
  const files = [jsonFile('a.json', ALPHA), { name: 'list.ini', mimeType: 'text/plain', buffer: Buffer.from(LIST_INI) }];
  const picker = page.getByRole('dialog', { name: 'Choose databases from your files' });
  const loadAlone = () =>
    page.getByRole('dialog', { name: 'Combine with the loaded databases?' }).getByRole('button', { name: 'Load alone' }).click();

  // The list's [mister] filter wins over FILTER (console).
  await page.locator('#database-file-input').setInputFiles(files);
  await picker.getByRole('button', { name: 'Open 2 selected databases' }).click();
  await loadAlone();
  await expect(appliedFilters(page)).toHaveText(['alphaarcadeshared filter', 'gammaarcadeshared filter']);

  // Without it, the current FILTER is shared. Both databases are loaded already, so they open
  // again without a question.
  await page.getByLabel('FILTER', { exact: true }).fill('console');
  await page.locator('#database-file-input').setInputFiles(files);
  await expect(picker.locator('.catalog-loaded-badge')).toHaveCount(2);
  await picker.getByLabel('Apply the [mister] filter').uncheck();
  await picker.getByRole('button', { name: 'Open 2 selected databases' }).click();
  await expect(appliedFilters(page)).toHaveText(['alphaconsoleshared filter', 'gammaconsoleshared filter']);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('dropped folders and files are walked the same way, and a single dropped file opens directly', async ({
  page,
}, testInfo) => {
  const folder = testInfo.outputPath('dropped');
  writeFiles(folder, { 'sub/beta.json.zip': zipJson(BETA), 'sub/ignored.txt': 'nothing' });
  const loose = testInfo.outputPath('loose.json');
  fs.writeFileSync(loose, JSON.stringify(ALPHA));

  await page.goto('/');
  await dropFromDisk(page, [folder, loose]);
  const picker = page.getByRole('dialog', { name: 'Choose databases from your files' });
  await expect.poll(() => selectedNames(page)).toEqual(['beta (dropped/sub/beta.json.zip)', 'alpha (loose.json)']);
  await picker.getByRole('button', { name: 'Close', exact: true }).click();

  await page.goto('/');
  await dropFromDisk(page, [loose]);
  await expect(page.getByRole('heading', { name: 'alpha', exact: true })).toBeVisible();
  await expect(picker).toHaveCount(0);
});

test('files without databases say so', async ({ page }) => {
  await page.goto('/');
  await page.locator('#database-file-input').setInputFiles([
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') },
    jsonFile('settings.json', { theme: 'dark' }),
  ]);

  await expect(page.getByText('No databases or database lists were found in your files.')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('files uploaded while databases are loaded are chosen first, then combined or opened alone', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('URL').fill(GAMMA_URL);
  await page.getByRole('button', { name: 'Fetch database' }).click();
  await expect(page.getByRole('heading', { name: 'gamma', exact: true })).toBeVisible();

  const localGamma = database('gamma', { 'local-gamma.rbf': { size: 5 } });
  await page.locator('#database-file-input').setInputFiles([jsonFile('a.json', ALPHA), jsonFile('gamma.json', localGamma)]);
  const picker = page.getByRole('dialog', { name: 'Choose databases from your files' });
  const loadMode = page.getByRole('dialog', { name: 'Combine with the loaded databases?' });
  await expect(picker).toBeVisible();
  await expect(loadMode).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'gamma', exact: true })).toBeVisible();

  await picker.getByRole('button', { name: 'Open 2 selected databases' }).click();
  await loadMode.getByRole('button', { name: 'Combine' }).click();
  await page.getByRole('dialog', { name: 'Replace the loaded database?' }).getByRole('button', { name: 'Replace it' }).click();
  await expect(page.locator('.combined-database-card h3')).toHaveText(['gamma', 'alpha']);
  await expect(page.getByRole('heading', { name: 'local-gamma.rbf' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'gamma.rbf', exact: true })).toHaveCount(0);
});

function database(dbId, files, extra = {}) {
  return {
    db_id: dbId,
    v: 1,
    timestamp: 1710000000,
    base_files_url: 'https://example.com/files/',
    tag_dictionary: { arcade: 0 },
    files,
    folders: {},
    ...extra,
  };
}

function jsonFile(name, value) {
  return { name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) };
}

function zipJson(value) {
  return Buffer.from(zipSync({ 'db.json': strToU8(JSON.stringify(value)) }));
}

function writeFiles(root, files) {
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }
}

// Drops files and folders from disk on the upload card, as the operating system would.
async function dropFromDisk(page, paths) {
  const cdp = await page.context().newCDPSession(page);
  await page.locator('.dropzone').scrollIntoViewIfNeeded();
  const box = await page.locator('.dropzone').boundingBox();
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const data = { items: [], files: paths, dragOperationsMask: 1 };
  for (const type of ['dragEnter', 'dragOver', 'drop']) {
    await cdp.send('Input.dispatchDragEvent', { type, ...point, data });
  }
  await cdp.detach();
}

function selectedNames(page) {
  return page
    .getByRole('checkbox', { checked: true })
    .evaluateAll((boxes) => boxes.map((box) => box.getAttribute('aria-label')).filter(Boolean));
}

function appliedFilters(page) {
  return page.getByRole('list', { name: 'Filter applied to each database' }).getByRole('listitem');
}
