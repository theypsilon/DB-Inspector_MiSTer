import { expect, test } from '@playwright/test';

const SMALL_DB = {
  db_id: 'anchor_test',
  v: 1,
  timestamp: 1710000000,
  base_files_url: 'https://example.com/base/',
  files: {
    'core_a.rbf': { size: 1024, hash: 'ha' },
    'core_b.rbf': { size: 2048, hash: 'hb' },
  },
  folders: {},
  archives: {
    test_archive: {
      description: 'Test archive',
      format: 'zip',
      extract: 'selective',
      target_folder: 'games/arc/',
      archive_file: { url: 'https://example.com/arc.zip', size: 9999, hash: 'ah' },
      summary_inline: {
        files: {
          'games/arc/rom_a.bin': { arc_id: 'test_archive', arc_at: 'rom_a.bin', size: 100, hash: 'ra' },
        },
        folders: {},
      },
      base_files_url: 'https://example.com/arc/files/',
    },
  },
};

function uploadDatabase(page, db = SMALL_DB) {
  return page.locator('#database-file-input').setInputFiles({
    name: 'test.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(db), 'utf8'),
  });
}

test.describe('node anchors', () => {
  test('clicking a file anchor icon updates the URL hash', async ({ page }) => {
    await page.goto('/');
    await uploadDatabase(page);
    await expect(page.getByRole('heading', { name: 'core_a.rbf' })).toBeVisible();

    const fileRow = page.locator('.tree-entry', {
      has: page.getByRole('heading', { name: 'core_a.rbf' }),
    }).first();
    await fileRow.hover();
    await fileRow.locator('.copy-link-button').click();

    await expect.poll(() => page.url()).toContain('#files:');
    expect(page.url()).toContain('core_a.rbf');
  });

  test('clicking an archive anchor icon updates the URL hash', async ({ page }) => {
    await page.goto('/');
    await uploadDatabase(page);
    await expect(page.getByRole('heading', { name: 'test_archive' })).toBeVisible();

    const archiveRow = page.locator('.tree-entry.archive-card', {
      has: page.getByRole('heading', { name: 'test_archive' }),
    }).first();
    await archiveRow.hover();
    await archiveRow.locator('.copy-link-button').click();

    await expect.poll(() => page.url()).toContain('#archives:test_archive');
  });

  test('anchor icon does not change hash for non-anchor clicks', async ({ page }) => {
    await page.goto('/');
    await uploadDatabase(page);
    await expect(page.getByRole('heading', { name: 'core_a.rbf' })).toBeVisible();

    const urlBefore = page.url();
    const fileRow = page.locator('.tree-entry', {
      has: page.getByRole('heading', { name: 'core_a.rbf' }),
    }).first();
    await fileRow.getByRole('button', { name: 'Show details' }).click();

    expect(page.url()).toBe(urlBefore);
  });
});

test.describe('section anchors', () => {
  test('clicking a section anchor updates the URL hash', async ({ page }) => {
    await page.goto('/');
    await uploadDatabase(page);
    await expect(page.getByRole('heading', { name: 'anchor_test' })).toBeVisible();

    const filterHeading = page.locator('h2', { hasText: 'Enter terms to filter by' });
    await filterHeading.hover();
    await filterHeading.locator('.section-anchor-button').click();

    await expect.poll(() => page.url()).toContain('#filter');
  });

  test('section anchors exist for all major sections', async ({ page }) => {
    await page.goto('/');
    await uploadDatabase(page);
    await expect(page.getByRole('heading', { name: 'anchor_test' })).toBeVisible();

    await expect(page.locator('#section-filter')).toBeAttached();
    await expect(page.locator('#section-files')).toBeAttached();
    await expect(page.locator('#section-archives')).toBeAttached();
    await expect(page.locator('#section-issues')).toBeAttached();
  });

  test('section anchor on collapsed section opens it', async ({ page }) => {
    await page.goto('/');
    await uploadDatabase(page);
    await expect(page.getByRole('heading', { name: 'anchor_test' })).toBeVisible();

    const issuesSection = page.locator('#section-issues');
    await issuesSection.locator('summary').click();
    await expect(issuesSection).not.toHaveAttribute('open');

    const heading = issuesSection.locator('h2');
    await heading.hover();
    await heading.locator('.section-anchor-button').click();

    await expect(issuesSection).toHaveAttribute('open', '');
  });
});

test.describe('detailed URL param', () => {
  test('detailed toggle adds and removes the search param', async ({ page }) => {
    await page.goto('/');
    await uploadDatabase(page);
    await expect(page.getByRole('heading', { name: 'anchor_test' })).toBeVisible();

    expect(page.url()).not.toContain('detailed');

    const toggle = page.locator('.overview-controls').getByRole('button', { name: /Detailed toggle/ });
    await toggle.click();
    await expect.poll(() => page.url()).toContain('detailed');

    await toggle.click();
    await expect.poll(() => page.url()).not.toContain('detailed');
  });

  test('loading with detailed param starts with details on', async ({ page }) => {
    await page.goto('/?detailed');
    await uploadDatabase(page);
    await expect(page.getByRole('heading', { name: 'anchor_test' })).toBeVisible();

    const toggle = page.locator('.overview-controls').getByRole('button', { name: /Detailed toggle/ });
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  });

  test('detailed state is shared across all sections', async ({ page }) => {
    await page.goto('/?detailed');
    await uploadDatabase(page);
    await expect(page.getByRole('heading', { name: 'anchor_test' })).toBeVisible();

    await expect(page.locator('.tree-root .tree-entry').first().getByText('MD5 HASH')).toBeVisible();
  });
});

test.describe('filter enter key', () => {
  test('pressing enter in filter input blurs it', async ({ page }) => {
    await page.goto('/');
    await uploadDatabase(page);
    await expect(page.getByRole('heading', { name: 'anchor_test' })).toBeVisible();

    const filterInput = page.getByLabel('FILTER');
    await filterInput.click();
    await filterInput.fill('test');
    await filterInput.press('Enter');

    await expect(filterInput).not.toBeFocused();
  });

  test('pressing enter does not insert a newline', async ({ page }) => {
    await page.goto('/');
    await uploadDatabase(page);
    await expect(page.getByRole('heading', { name: 'anchor_test' })).toBeVisible();

    const filterInput = page.getByLabel('FILTER');
    await filterInput.click();
    await filterInput.fill('hello');
    await filterInput.press('Enter');

    await expect(filterInput).toHaveValue('hello');
  });
});

test.describe('ghost parent', () => {
  function buildDeepDatabase() {
    const files = {};
    for (let i = 0; i < 100; i++) {
      files[`games/deep/folder/file_${String(i).padStart(3, '0')}.rbf`] = {
        size: 1024 + i,
        hash: `h${i}`,
      };
    }
    return {
      db_id: 'ghost_test',
      v: 1,
      timestamp: 1,
      base_files_url: 'https://example.com/',
      files,
      folders: { 'games/': {}, 'games/deep/': {}, 'games/deep/folder/': {} },
    };
  }

  test('ghost does not appear when parent is visible', async ({ page }) => {
    await page.goto('/');
    await uploadDatabase(page, buildDeepDatabase());
    await expect(page.getByRole('heading', { name: 'ghost_test' })).toBeVisible();

    const container = page.locator('.tree-root');
    const box = await container.boundingBox();
    if (box) {
      await page.mouse.move(box.x + 10, box.y + 50);
      await page.waitForTimeout(200);
    }

    await expect(page.locator('.ghost-parent-row')).toHaveCount(0);
  });

  test('ghost click does not change URL hash', async ({ page }) => {
    await page.goto('/');
    await uploadDatabase(page, buildDeepDatabase());
    await expect(page.getByRole('heading', { name: 'ghost_test' })).toBeVisible();

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(500);

    const container = page.locator('.tree-root');
    const box = await container.boundingBox();
    if (box) {
      await page.mouse.move(box.x + 10, box.y + box.height / 2);
      await page.waitForTimeout(300);
    }

    const ghost = page.locator('.ghost-parent-row');
    if (await ghost.count() > 0) {
      await ghost.click();
      await page.waitForTimeout(300);
      expect(page.url()).not.toContain('#files:');
      expect(page.url()).not.toContain('#folders:');
    }
  });
});
