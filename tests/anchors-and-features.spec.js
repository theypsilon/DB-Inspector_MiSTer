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
  test('anchor icons put file and archive rows in the URL hash, and other row clicks leave it alone', async ({
    page,
  }) => {
    await page.goto('/');
    await uploadDatabase(page);
    await expect(page.getByRole('heading', { name: 'core_a.rbf' })).toBeVisible();

    const urlBefore = page.url();
    const fileRow = page.locator('.tree-entry', {
      has: page.getByRole('heading', { name: 'core_a.rbf' }),
    }).first();
    await fileRow.getByRole('button', { name: 'Show details' }).click();
    expect(page.url()).toBe(urlBefore);

    await fileRow.hover();
    await fileRow.locator('.copy-link-button').click();
    await expect.poll(() => page.url()).toContain('#files:');
    expect(page.url()).toContain('core_a.rbf');

    const archiveRow = page.locator('.tree-entry.archive-card', {
      has: page.getByRole('heading', { name: 'test_archive' }),
    }).first();
    await archiveRow.hover();
    await archiveRow.locator('.copy-link-button').click();
    await expect.poll(() => page.url()).toContain('#archives:test_archive');
  });
});

test.describe('section anchors', () => {
  test('every section has an anchor that updates the URL hash and opens the section when collapsed', async ({
    page,
  }) => {
    await page.goto('/');
    await uploadDatabase(page);
    await expect(page.getByRole('heading', { name: 'anchor_test' })).toBeVisible();

    await expect(page.locator('#section-filter')).toBeAttached();
    await expect(page.locator('#section-files')).toBeAttached();
    await expect(page.locator('#section-archives')).toBeAttached();
    await expect(page.locator('#section-issues')).toBeAttached();

    const filterHeading = page.locator('h2', { hasText: 'Enter terms to filter by' });
    await filterHeading.hover();
    await filterHeading.locator('.section-anchor-button').click();
    await expect.poll(() => page.url()).toContain('#filter');

    const issuesSection = page.locator('#section-issues');
    await issuesSection.locator('summary').click();
    await expect(issuesSection).not.toHaveAttribute('open');

    const issuesHeading = issuesSection.locator('h2');
    await issuesHeading.hover();
    await issuesHeading.locator('.section-anchor-button').click();
    await expect(issuesSection).toHaveAttribute('open', '');
  });
});

test.describe('detailed URL param', () => {
  test('the detailed toggle adds and removes the search param, and the param turns details on at load', async ({
    page,
  }) => {
    await page.goto('/');
    await uploadDatabase(page);
    await expect(page.getByRole('heading', { name: 'anchor_test' })).toBeVisible();

    expect(page.url()).not.toContain('detailed');

    const toggle = page.locator('.overview-controls').getByRole('button', { name: /Detailed toggle/ });
    await toggle.click();
    // The toggle applies in a transition; clicking again before it lands would repeat the first click.
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => page.url()).toContain('detailed');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => page.url()).not.toContain('detailed');

    await page.goto('/?detailed');
    await uploadDatabase(page);
    await expect(page.getByRole('heading', { name: 'anchor_test' })).toBeVisible();

    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.tree-root .tree-entry').first().getByText('MD5 HASH')).toBeVisible();
  });
});

test.describe('filter enter key', () => {
  test('pressing Enter in FILTER blurs it without inserting a newline', async ({ page }) => {
    await page.goto('/');
    await uploadDatabase(page);
    await expect(page.getByRole('heading', { name: 'anchor_test' })).toBeVisible();

    const filterInput = page.getByLabel('FILTER');
    await filterInput.click();
    await filterInput.fill('hello');
    await filterInput.press('Enter');

    await expect(filterInput).not.toBeFocused();
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

  test('ghost click jumps to the parent row without changing the URL hash', async ({ page }) => {
    await page.goto('/');
    await uploadDatabase(page, buildDeepDatabase());
    await expect(page.getByRole('heading', { name: 'ghost_test' })).toBeVisible();

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));

    // Hovering the outermost indentation column while its folder is scrolled out of view shows
    // that folder as a ghost row.
    const box = await page.locator('.tree-root').boundingBox();
    const columnX = box.x + 10;
    await page.mouse.move(columnX, page.viewportSize().height / 2);
    const ghost = page.locator('.ghost-parent-row');
    await expect(ghost).toHaveText(/games/);

    // Click it in the same column: the ghost follows the hovered column, so a click further right
    // could land on a deeper folder's ghost.
    const urlBefore = page.url();
    const ghostBox = await ghost.boundingBox();
    await ghost.click({ position: { x: columnX - ghostBox.x, y: ghostBox.height / 2 } });
    await expect(
      page.locator('.tree-entry', { has: page.getByRole('heading', { name: 'games', exact: true }) }),
    ).toBeInViewport();
    expect(page.url()).toBe(urlBefore);
  });
});
