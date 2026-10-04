import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { strToU8, zipSync } from 'fflate';

// Uploads in a real browser: several files through the file input, folders and files dropped from
// disk, what is skipped, what is already loaded, the question when an uploaded db_id is loaded, and
// uploads opened again from the catalog.

const RUNTIME_CATALOG_URL = 'https://raw.githubusercontent.com/theypsilon/Update_All_MiSTer/master/src/update_all/databases.py';
const MULTIDATABASES_CATALOG_URL = 'https://raw.githubusercontent.com/theypsilon/MultiDatabases_MiSTer/main/README.md';
const GAMMA_URL = 'https://example.com/uploads/gamma.json';
const CATALOG_URL = 'https://example.com/uploads/catalog.json';

const database = (dbId, files) => ({ db_id: dbId, v: 1, timestamp: 1710000000, base_files_url: 'https://example.com/files/', tag_dictionary: { arcade: 0 }, files, folders: {} });
const ALPHA = database('alpha', { 'alpha.rbf': { size: 1, tags: [0] } });
const ALPHA_FORK = database('alpha', { 'fork.rbf': { size: 2 } });
const BETA = database('beta', { 'beta.rbf': { size: 3 } });
const DELTA = database('delta', { 'delta.rbf': { size: 4 } });
const BETA_ZIP = Buffer.from(zipSync({ 'db.json': strToU8(JSON.stringify(BETA)) }));
const LIST_INI = `[mister]\nfilter=arcade\n\n[gamma]\ndb_url=${GAMMA_URL}\n`;

test.beforeEach(async ({ page }) => {
  const reply = (contentType, body) => ({ status: 200, contentType, body });
  await page.route(GAMMA_URL, (route) => route.fulfill(reply('application/json', JSON.stringify(database('gamma', { 'gamma.rbf': { size: 5 } })))));
  await page.route(CATALOG_URL, (route) => route.fulfill(reply('application/json', JSON.stringify(database('catalog_db', {})))));
  await page.route(RUNTIME_CATALOG_URL, (route) =>
    route.fulfill(reply('text/plain', `self.CATALOG_DB = Database(db_id='catalog_db', db_url='${CATALOG_URL}', title='Catalog database')\n`)),
  );
  await page.route(MULTIDATABASES_CATALOG_URL, (route) =>
    route.fulfill(reply('text/markdown', `| [Extra](extra/) | Extra | [Inspect](https://theypsilon.github.io/DB-Inspector_MiSTer/?database-url=${encodeURIComponent('https://example.com/extra/db.json')}) |\n`)),
  );
});

test('uploads offer the databases they hold, and open them alone or combined', async ({ page }, testInfo) => {
  const picker = page.getByRole('dialog', { name: 'Choose databases from your files' });
  const loadMode = page.getByRole('dialog', { name: 'Combine with the loaded databases?' });
  await page.goto('/');

  await test.step('several chosen files offer their databases, and other files are skipped without a word', async () => {
    await page.locator('#database-file-input').setInputFiles([
      jsonFile('a.json', ALPHA),
      jsonFile('copy-of-a.json', ALPHA),
      { name: 'b.json.zip', mimeType: 'application/zip', buffer: BETA_ZIP },
      { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') },
      { name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{') },
      jsonFile('settings.json', { theme: 'dark' }),
      { name: 'list.ini', mimeType: 'text/plain', buffer: Buffer.from(LIST_INI) },
    ]);
    await expect.poll(() => selectedNames(page)).toEqual(['alpha (a.json)', 'beta (b.json.zip)', 'gamma (list.ini)']);
    await expect(page.getByText('Found 3 databases in 3 files.')).toBeVisible();
    await expect(page.locator('.status.error')).toHaveCount(0);

    await picker.getByRole('button', { name: 'Open 3 selected databases' }).click();
    await expect(page.getByRole('heading', { name: '3 combined databases' })).toBeVisible();
    await expect(appliedFilters(page)).toHaveText(['alphaarcadeshared filter', 'betaarcadeshared filter', 'gammaarcadeshared filter']);
    // Uploaded databases cannot be shared, so only the list's remote database is in the link.
    await expect.poll(() => new URL(page.url()).hash).toBe(`#db=${GAMMA_URL}&filter=arcade`);
  });

  await test.step('files with the content of loaded databases are marked as loaded', async () => {
    await page.locator('#database-file-input').setInputFiles([
      jsonFile('again.json', ALPHA),
      { name: 'again.json.zip', mimeType: 'application/zip', buffer: BETA_ZIP },
      jsonFile('fork.json', ALPHA_FORK),
    ]);
    await expect(picker.locator('.catalog-option')).toHaveCount(3);
    await expect(picker.locator('.catalog-loaded-badge')).toHaveCount(2);
    await expect(picker.locator('.catalog-option').filter({ hasText: 'fork.json' }).locator('.catalog-loaded-badge')).toHaveCount(0);
    await picker.getByRole('button', { name: 'Close', exact: true }).click();
  });

  await test.step('a folder dropped while databases are loaded is offered first, and its loaded db_id asks which database stays', async () => {
    const folder = testInfo.outputPath('more');
    writeFiles(folder, { 'x/delta.json': JSON.stringify(DELTA), 'y/alpha-fork.json': JSON.stringify(ALPHA_FORK), 'readme.md': '# More' });
    await dropFromDisk(page, [folder]);
    await expect.poll(() => selectedNames(page)).toEqual(['delta (more/x/delta.json)', 'alpha (more/y/alpha-fork.json)']);
    await expect(loadMode).toHaveCount(0);

    await picker.getByRole('button', { name: 'Open 2 selected databases' }).click();
    await loadMode.getByRole('button', { name: 'Combine' }).click();
    const replace = page.getByRole('dialog', { name: 'Replace the loaded database?' });
    await expect(replace).toContainText('A database with the db_id alpha is already loaded.');
    await replace.getByRole('button', { name: 'Replace it' }).click();
    await expect(page.locator('.combined-database-card h3')).toHaveText(['alpha', 'beta', 'gamma', 'delta']);
    await expect(page.getByRole('heading', { name: 'fork.rbf' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'alpha.rbf' })).toHaveCount(0);
  });

  await test.step('a single dropped file opens directly', async () => {
    const loose = testInfo.outputPath('beta.json');
    fs.writeFileSync(loose, JSON.stringify(BETA));
    await page.goto('about:blank');
    await page.goto('/');
    await dropFromDisk(page, [loose]);
    await expect(page.getByRole('heading', { name: 'beta', exact: true })).toBeVisible();
    await expect(picker).toHaveCount(0);
  });

  await test.step('files without databases say so', async () => {
    await page.locator('#database-file-input').setInputFiles([
      { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') },
      jsonFile('settings.json', { theme: 'dark' }),
    ]);
    await expect(page.getByText('No databases or database lists were found in your files.')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  await test.step('uploaded databases open again from the catalog, alone or combined', async () => {
    await page.locator('#database-file-input').setInputFiles([jsonFile('mine.json', database('mine_db', { 'mine.rbf': { size: 1 } }))]);
    await loadMode.getByRole('button', { name: 'Load alone' }).click();
    await expect(page.getByRole('heading', { name: 'mine_db', exact: true })).toBeVisible();

    let catalog = await openCatalog(page);
    await catalog.getByRole('checkbox', { name: 'Uploaded: beta.json (beta)', exact: true }).check();
    await catalog.getByRole('button', { name: 'Open selected database' }).click();
    await loadMode.getByRole('button', { name: 'Load alone' }).click();
    await expect(page.getByRole('heading', { name: 'beta', exact: true })).toBeVisible();
    await expect(page.locator('.status.error')).toHaveCount(0);
    // Uploaded databases cannot be shared, so the link is empty.
    expect(new URL(page.url()).hash).toBe('');

    catalog = await openCatalog(page);
    await expect(catalog.locator('.catalog-option').filter({ hasText: 'Uploaded: beta.json' })).toContainText('Loaded');
    await catalog.getByRole('checkbox', { name: 'Uploaded: mine.json (mine_db)', exact: true }).check();
    await catalog.getByRole('button', { name: 'Open selected database' }).click();
    await loadMode.getByRole('button', { name: 'Combine' }).click();
    await expect(page.locator('.combined-database-card h3')).toHaveText(['beta', 'mine_db']);

    // Both uploads are part of this selection, so they open again without a question.
    catalog = await openCatalog(page);
    await catalog.getByRole('checkbox', { name: 'Uploaded: beta.json (beta)', exact: true }).check();
    await catalog.getByRole('checkbox', { name: 'Uploaded: mine.json (mine_db)', exact: true }).check();
    await catalog.getByRole('button', { name: 'Open 2 selected databases' }).click();
    await expect(page.getByRole('heading', { name: '2 combined databases' })).toBeVisible();
    await expect(loadMode).toHaveCount(0);
    await expect(page.locator('.status.error')).toHaveCount(0);
  });
});

async function openCatalog(page) {
  await page.getByRole('button', { name: 'Browse catalog' }).click();
  return page.getByRole('dialog', { name: 'Browse database catalog' });
}

function jsonFile(name, value) {
  return { name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) };
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
