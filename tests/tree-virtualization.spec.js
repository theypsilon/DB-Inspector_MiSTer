import { expect, test } from '@playwright/test';

const FILE_COUNT = 220;
const ARCHIVE_COUNT = 220;

test('virtualized filesystem and archive trees still behave correctly', async ({ page }) => {
  await page.goto('/');

  await page.locator('#database-file-input').setInputFiles({
    name: 'virtualization-smoke.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(buildLargeDatabase()), 'utf8'),
  });

  await expect(page.getByRole('heading', { name: 'virtualization_smoke' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Files and folders' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Archive summaries' })).toBeVisible();

  const filesystemRowCount = await page.locator('.tree-root .tree-entry').count();
  expect(filesystemRowCount).toBeGreaterThan(0);
  expect(filesystemRowCount).toBeLessThan(FILE_COUNT);

  const firstFileRow = page
    .locator('.tree-entry', {
      has: page.getByRole('heading', { name: 'file_000.rbf' }),
    })
    .first();

  await expect(firstFileRow.locator('.collapse-button')).toHaveCount(0);
  await firstFileRow.getByRole('button', { name: 'Show details' }).click();
  await expect(firstFileRow.getByText('Hash', { exact: true })).toBeVisible();
  await firstFileRow.getByRole('button', { name: 'Hide details' }).click();
  await expect(firstFileRow.getByText('Hash', { exact: true })).toHaveCount(0);
  await firstFileRow.getByRole('button', { name: 'Show details' }).click();
  await expect(firstFileRow.getByText('Hash', { exact: true })).toBeVisible();

  await scrollVirtualListNearBottom(page, '.tree-root');
  await expect(page.getByRole('heading', { name: `file_${pad(FILE_COUNT - 1)}.rbf` })).toBeVisible();

  const archiveSection = page.locator('details', {
    has: page.getByRole('heading', { name: 'Archive summaries' }),
  });

  await scrollElementToViewportTop(page, archiveSection);
  await expect(page.getByRole('heading', { name: 'rom_000.bin' })).toBeVisible();

  const archiveRowCount = await page.locator('.archive-list .tree-entry').count();
  expect(archiveRowCount).toBeGreaterThan(0);
  expect(archiveRowCount).toBeLessThan(ARCHIVE_COUNT + 1);

  await archiveSection.getByRole('button', { name: /^Collapse all$/ }).click();
  await expect(page.getByRole('heading', { name: 'rom_000.bin' })).toHaveCount(0);

  await archiveSection.getByRole('button', { name: /^Uncollapse all$/ }).click();
  await expect(page.getByRole('heading', { name: 'rom_000.bin' })).toBeVisible();

  const filesystemSection = page.locator('details', {
    has: page.getByRole('heading', { name: 'Files and folders' }),
  });
  await filesystemSection.evaluate((element) => {
    element.querySelector('summary')?.click();
  });
  await expect(page.getByRole('heading', { name: 'rom_000.bin' })).toBeVisible();

  await scrollVirtualListNearBottom(page, '.archive-list');
  await expect(page.getByRole('heading', { name: `rom_${pad(ARCHIVE_COUNT - 1)}.bin` })).toBeVisible();
});

function buildLargeDatabase() {
  const files = {};
  const archiveSummaryFiles = {};

  for (let index = 0; index < FILE_COUNT; index += 1) {
    const padded = pad(index);
    files[`games/TEST/file_${padded}.rbf`] = {
      size: 4096 + index,
      hash: `file-hash-${padded}`,
    };
  }

  for (let index = 0; index < ARCHIVE_COUNT; index += 1) {
    const padded = pad(index);
    archiveSummaryFiles[`games/TEST/archive/rom_${padded}.bin`] = {
      arc_id: 'bundle_assets',
      arc_at: `payload/rom_${padded}.bin`,
      size: 8192 + index,
      hash: `archive-hash-${padded}`,
    };
  }

  return {
    db_id: 'virtualization_smoke',
    v: 1,
    timestamp: 1710000000,
    base_files_url: 'https://example.com/base/',
    files,
    folders: {},
    archives: {
      bundle_assets: {
        description: 'Bundle assets',
        format: 'zip',
        extract: 'selective',
        target_folder: 'games/TEST/archive/',
        archive_file: {
          url: 'https://example.com/archive/bundle_assets.zip',
          size: 999999,
          hash: 'bundle-assets-hash',
        },
        summary_inline: {
          files: archiveSummaryFiles,
          folders: {},
        },
        base_files_url: 'https://example.com/archive/files/',
      },
    },
  };
}

function pad(value) {
  return String(value).padStart(3, '0');
}

async function scrollVirtualListNearBottom(page, selector) {
  await page.locator(selector).evaluate((element) => {
    const top = element.getBoundingClientRect().top + window.scrollY;
    const height = element.getBoundingClientRect().height;
    window.scrollTo(0, top + height - window.innerHeight * 0.75);
  });
}

async function scrollElementToViewportTop(page, locator) {
  await locator.evaluate((element) => {
    const top = element.getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, Math.max(0, top - 120));
  });
}
