import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

// What only a real browser shows of uploads: files and folders dropped from disk, as the operating
// system drops them, reaching the page with their paths. What the page does with the files it is
// given (which it reads, what it offers and opens, the questions it asks) is checked in the unit
// and component tests.

const database = (dbId, files) => ({ db_id: dbId, v: 1, timestamp: 1710000000, base_files_url: 'https://example.com/files/', tag_dictionary: { arcade: 0 }, files, folders: {} });
const ALPHA_FORK = database('alpha', { 'fork.rbf': { size: 2 } });
const BETA = database('beta', { 'beta.rbf': { size: 3 } });
const DELTA = database('delta', { 'delta.rbf': { size: 4 } });

test('files and folders dropped from disk reach the page', async ({ page }, testInfo) => {
  const picker = page.getByRole('dialog', { name: 'Choose databases from your files' });
  await page.goto('/');

  await test.step('a dropped folder offers the databases in every folder inside it, by their paths', async () => {
    const folder = testInfo.outputPath('more');
    writeFiles(folder, { 'x/delta.json': JSON.stringify(DELTA), 'y/alpha-fork.json': JSON.stringify(ALPHA_FORK), 'readme.md': '# More' });
    await dropFromDisk(page, [folder]);
    await expect.poll(() => selectedNames(page)).toEqual(['delta (more/x/delta.json)', 'alpha (more/y/alpha-fork.json)']);
    await picker.getByRole('button', { name: 'Close', exact: true }).click();
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
});

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
