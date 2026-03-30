import { expect, test } from '@playwright/test';

test('browser-native file types expose OPEN while binary files stay download-only', async ({
  page,
}) => {
  await page.goto('/');

  await page.locator('#database-file-input').setInputFiles({
    name: 'download-actions.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(buildDownloadActionDatabase()), 'utf8'),
  });

  await expect(page.getByRole('heading', { name: 'download_actions' })).toBeVisible();

  for (const fileName of ['notes.txt', 'settings.ini', 'readme.md', 'manual.pdf', 'cover.png']) {
    const row = page
      .locator('.tree-entry', {
        has: page.getByRole('heading', { name: fileName }),
      })
      .first();
    await expect(row.getByRole('button', { name: 'Download' })).toBeVisible();
    await expect(row.getByRole('link', { name: 'OPEN' })).toBeVisible();
  }

  const binaryRow = page
    .locator('.tree-entry', {
      has: page.getByRole('heading', { name: 'core.rbf' }),
    })
    .first();
  await expect(binaryRow.getByRole('button', { name: 'Download' })).toBeVisible();
  await expect(binaryRow.getByRole('link', { name: 'OPEN' })).toHaveCount(0);
});

function buildDownloadActionDatabase() {
  return {
    db_id: 'download_actions',
    v: 1,
    timestamp: 1710000000,
    files: {
      'docs/notes.txt': {
        url: 'https://example.com/files/notes.txt',
      },
      'docs/settings.ini': {
        url: 'https://example.com/files/settings.ini',
      },
      'docs/readme.md': {
        url: 'https://example.com/files/readme.md',
      },
      'docs/manual.pdf': {
        url: 'https://example.com/files/manual.pdf',
      },
      'images/cover.png': {
        url: 'https://example.com/files/cover.png',
      },
      'cores/core.rbf': {
        url: 'https://example.com/files/core.rbf',
      },
    },
    folders: {},
    archives: {},
  };
}
