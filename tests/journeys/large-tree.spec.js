import { expect, test } from '@playwright/test';

// The virtualized trees of a large database in a real browser: only rows near the viewport render,
// rows keep their spacing as details open and close, the last rows can be reached, and URL anchors,
// find-in-page and ghost parent rows bring far rows into view.

const FILE_COUNT = 600;
const ARCHIVE_COUNT = 220;
const FAR_FILE_PATH = 'games/folder_14/file_00599.rbf';

test('large trees render near the viewport, keep their spacing, and reach far rows', async ({ page }) => {
  await page.goto('/');
  await upload(page, 'large.json', buildLargeDatabase());
  await expect(page.getByRole('heading', { name: 'large_db' })).toBeVisible();
  const files = page.locator('details', { has: page.getByRole('heading', { name: 'Files and folders' }) });
  const archives = page.locator('details', { has: page.getByRole('heading', { name: 'Archives' }) });

  await test.step('only rows near the viewport render', async () => {
    await scrollListBy(page, '.tree-root', 220);
    const rendered = await page.locator('.tree-root .tree-entry').count();
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(FILE_COUNT);
  });

  await test.step('a parent row still on screen shows no ghost', async () => {
    await scrollUntilSteady(page.locator('.tree-root'), 100);
    const box = await page.locator('.tree-root').boundingBox();
    await page.mouse.move(box.x + 10, box.y + 50);
    // Once the page has drawn twice, a ghost would be on screen.
    await afterTwoFrames(page);
    await expect(page.locator('.ghost-parent-row')).toHaveCount(0);
  });

  await test.step('rows keep the list spacing as their details open and close', async () => {
    const row = rowNamed(page, 'file_00000.rbf');
    await expect(row.locator('.collapse-button')).toHaveCount(0);
    const urlBefore = page.url();
    for (const [button, hashCount] of [['Show details', 1], ['Hide details', 0], ['Show details', 1]]) {
      await row.getByRole('button', { name: button }).click();
      await expect(row.getByText('MD5 HASH', { exact: true })).toHaveCount(hashCount);
      await expect.poll(async () => Math.abs(Math.round(await gapAfter(row)) - 13)).toBeLessThanOrEqual(1);
    }
    // Only a row's link icon puts it in the address.
    expect(page.url()).toBe(urlBefore);
  });

  await test.step('the last rows can be reached', async () => {
    await scrollUntilSteady(page.locator('.tree-root'), 'end');
    await expect(page.getByRole('heading', { name: 'file_00599.rbf' })).toBeInViewport();
  });

  await test.step('archives close and open, and keep rendering when the section above closes', async () => {
    await expect(page.locator('#section-archives')).toBeAttached();
    await scrollUntilSteady(archives, 120);
    await expect(page.getByRole('heading', { name: 'rom_000.bin' })).toBeVisible();
    const rendered = await page.locator('.archive-list .tree-entry').count();
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(ARCHIVE_COUNT + 1);

    await archives.getByRole('button', { name: /^Close all$/ }).click();
    await expect(page.getByRole('heading', { name: 'rom_000.bin' })).toHaveCount(0);
    await archives.getByRole('button', { name: /^Open all$/ }).click();
    await expect(page.getByRole('heading', { name: 'rom_000.bin' })).toBeVisible();

    await files.evaluate((element) => element.querySelector('summary').click());
    await expect(page.getByRole('heading', { name: 'rom_000.bin' })).toBeVisible();
    await scrollUntilSteady(page.locator('.archive-list'), 'end');
    await expect(page.getByRole('heading', { name: `rom_${String(ARCHIVE_COUNT - 1).padStart(3, '0')}.bin` })).toBeInViewport();
    await files.evaluate((element) => element.querySelector('summary').click());
  });

  await test.step('hovering a folder’s column far below it shows the folder, and a click goes back to it', async () => {
    await scrollUntilSteady(page.locator('.tree-root'), 'end');
    const box = await page.locator('.tree-root').boundingBox();
    const columnX = box.x + 10;
    await page.mouse.move(columnX, page.viewportSize().height / 2);
    const ghost = page.locator('.ghost-parent-row');
    await expect(ghost).toHaveText(/games/);

    const urlBefore = page.url();
    const ghostBox = await ghost.boundingBox();
    await ghost.click({ position: { x: columnX - ghostBox.x, y: ghostBox.height / 2 } });
    await expect(page.locator('.tree-root .tree-entry', { has: page.getByRole('heading', { name: 'games', exact: true }) })).toBeInViewport();
    expect(page.url()).toBe(urlBefore);
  });

  // A jump keeps correcting its scroll for a moment after it lands, so the steps after this one
  // start from a fresh page.
  await test.step('find-in-page brings a far row into view', async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    // The footer link, unlike Ctrl+F, works even before the shortcut listener is attached.
    await page.locator('.app-footer').getByText('to search').click();
    await page.getByLabel('Search text').fill('file_00599.rbf');
    await expect(page.locator(`[id="row-database:file:${FAR_FILE_PATH}"]`)).toBeInViewport();
    await page.getByLabel('Search text').press('Escape');
  });

  await test.step('a URL anchor opens a far row', async () => {
    // A fresh page: going to the same address with only another hash would not reload it.
    await page.goto('about:blank');
    await page.goto(`/#files:${encodeURIComponent(FAR_FILE_PATH)}`);
    await upload(page, 'large.json', buildLargeDatabase());
    await expect(page.getByRole('heading', { name: 'large_db' })).toBeVisible();
    await expect(page.locator(`[id="row-database:file:${FAR_FILE_PATH}"]`)).toBeInViewport();
  });
});

function rowNamed(page, name) {
  return page.locator('.tree-entry', { has: page.getByRole('heading', { name, exact: true }) }).first();
}

function buildLargeDatabase() {
  const files = {};
  const folders = {};
  for (let index = 0; index < FILE_COUNT; index += 1) {
    const folder = `games/folder_${String(Math.floor(index / 40)).padStart(2, '0')}`;
    folders[folder] = {};
    files[`${folder}/file_${String(index).padStart(5, '0')}.rbf`] = { size: 1000 + index, hash: `h${index}` };
  }
  const summary = {};
  for (let index = 0; index < ARCHIVE_COUNT; index += 1) {
    const padded = String(index).padStart(3, '0');
    summary[`games/archive/rom_${padded}.bin`] = { arc_id: 'bundle_assets', arc_at: `payload/rom_${padded}.bin`, size: 8192 + index, hash: `archive-hash-${padded}` };
  }
  return {
    db_id: 'large_db',
    v: 1,
    timestamp: 1710000000,
    base_files_url: 'https://example.com/',
    files,
    folders: { 'games/': {}, ...folders },
    archives: {
      bundle_assets: {
        description: 'Bundle assets',
        format: 'zip',
        extract: 'selective',
        target_folder: 'games/archive/',
        archive_file: { url: 'https://example.com/archive/bundle_assets.zip', size: 999999, hash: 'bundle-assets-hash' },
        summary_inline: { files: summary, folders: {} },
        base_files_url: 'https://example.com/archive/files/',
      },
    },
  };
}

function upload(page, name, json) {
  return page.locator('#database-file-input').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(json)) });
}

async function scrollListBy(page, selector, offset) {
  await page.locator(selector).evaluate((element, nextOffset) => {
    window.scrollTo(0, element.getBoundingClientRect().top + window.scrollY + nextOffset);
  }, offset);
}

// Scrolls the window until `locator`'s top stays `place` pixels below the top of the window, or with
// 'end', until its bottom stays at the bottom of the window. Rows measured during a scroll apply
// their heights once it stops, which can move the element, so after each scroll this waits until it
// holds still for ten frames, and scrolls again until it holds where it should.
async function scrollUntilSteady(locator, place) {
  await expect
    .poll(() =>
      locator.evaluate(async (element, target) => {
        const offset = () => {
          const rect = element.getBoundingClientRect();
          return target === 'end' ? rect.bottom - window.innerHeight : rect.top - target;
        };
        window.scrollTo(0, window.scrollY + offset());
        let last = offset();
        for (let still = 0, frames = 0; still < 10 && frames < 600; frames += 1) {
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const now = offset();
          still = Math.abs(now - last) < 0.5 ? still + 1 : 0;
          last = now;
        }
        return Math.abs(Math.round(last));
      }, place),
    )
    .toBe(0);
}

// Waits until the page has drawn twice, so what the last input changed is on screen.
function afterTwoFrames(page) {
  return page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

// The space between a row and the next one.
function gapAfter(row) {
  return row.evaluate((element) => {
    const next = element.nextElementSibling;
    if (!(next instanceof HTMLElement)) {
      return Number.NaN;
    }
    return parseFloat(next.style.top || '0') - parseFloat(element.style.top || '0') - element.getBoundingClientRect().height;
  });
}
