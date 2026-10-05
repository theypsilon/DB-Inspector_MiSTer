import { expect, test } from '@playwright/test';

// The virtualized trees of a large database in a real browser: only rows near the viewport render,
// rows keep touching as details and tags open and close, with each line between two rows drawn
// once, the last rows can be reached, and URL anchors, find-in-page and ghost parent rows bring far
// rows into view. The explorer renders only the entries near view of a large folder too, and folds
// its path on a phone.

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

  await test.step('rows keep touching as their details and tags open and close, and draw each line between them once', async () => {
    const row = rowNamed(page, 'file_00000.rbf');
    await expect(row.locator('.collapse-button')).toHaveCount(0);
    expect(await linesDrawnTwiceOrNot(page)).toEqual([]);
    const urlBefore = page.url();
    for (const [button, hashCount] of [['Show details', 1], ['Hide details', 0], ['Show details', 1]]) {
      await row.getByRole('button', { name: button }).click();
      await expect(row.getByText('MD5 HASH', { exact: true })).toHaveCount(hashCount);
      await expect.poll(() => meetsNextRow(row)).toBe(true);
    }
    await row.getByRole('button', { name: 'Hide details' }).click();
    for (const [button, chips] of [['+7 more tags', 11], ['Show fewer', 4]]) {
      await row.getByRole('button', { name: button }).click();
      await expect(row.locator('.tag-chip')).toHaveCount(chips);
      await expect.poll(() => meetsNextRow(row)).toBe(true);
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
    // A fresh page: going to the same address with only another # would not load it again.
    await page.goto('about:blank');
    await page.goto(`/#at=files:${FAR_FILE_PATH}`);
    await upload(page, 'large.json', buildLargeDatabase());
    await expect(page.getByRole('heading', { name: 'large_db' })).toBeVisible();
    await expect(page.locator(`[id="row-database:file:${FAR_FILE_PATH}"]`)).toBeInViewport();
  });

  await test.step('the explorer renders only the entries near view of a large folder, as a list and as icons, and reaches the last', async () => {
    await page.goto('about:blank');
    await page.goto('/#at=explorer:games/archive');
    await upload(page, 'large.json', buildLargeDatabase());
    const explorer = page.getByRole('dialog', { name: 'Explorer' });
    const last = `rom_${String(ARCHIVE_COUNT - 1).padStart(3, '0')}.bin`;
    const entry = (name) => explorer.getByRole('option', { name: new RegExp(`^${name.replace('.', '\\.')},`) });
    await expect(explorer.locator('.explorer-crumb-current')).toHaveText('archive');
    await expect(entry('rom_000.bin')).toBeVisible();
    await expect(entry('rom_000.bin')).toHaveAttribute('aria-setsize', String(ARCHIVE_COUNT));

    for (const [view, toggle] of [['list', null], ['icons', 'Show as icons']]) {
      if (toggle) {
        await explorer.getByRole('button', { name: toggle }).click();
        await expect(explorer.locator('.explorer-tile').first()).toBeVisible();
      }
      const rendered = await explorer.getByRole('option').count();
      expect(rendered, view).toBeGreaterThan(0);
      expect(rendered, view).toBeLessThan(ARCHIVE_COUNT);
      await explorer.locator('.explorer-items').evaluate((items) => {
        items.scrollTop = items.scrollHeight;
      });
      await expect(entry(last), view).toBeInViewport();
      await expect(entry('rom_000.bin'), view).toHaveCount(0);
      // Home and End select the first and last entries, and bring them into view.
      await explorer.getByRole('listbox').focus();
      await page.keyboard.press('Home');
      await expect(entry('rom_000.bin'), view).toBeInViewport();
      await page.keyboard.press('End');
      await expect(entry(last), view).toHaveAttribute('aria-selected', 'true');
      await expect(entry(last), view).toBeInViewport();
    }
    await explorer.getByRole('button', { name: 'Show as list' }).click();

    // On a phone the first folders of the path fold into …, which lists them.
    await page.setViewportSize({ width: 360, height: 760 });
    const more = explorer.getByRole('button', { name: 'Folders above' });
    await expect(more).toBeVisible();
    await expect(explorer.locator('.explorer-crumb-current')).toHaveText('archive');
    await more.click();
    const menu = explorer.getByRole('menu', { name: 'Folders above' });
    await expect(menu.getByRole('menuitem').first()).toHaveText('SD card');
    await menu.getByRole('menuitem', { name: 'SD card' }).click();
    await expect(explorer.locator('.explorer-crumb-current')).toHaveText('SD card');
    await expect(more).toHaveCount(0);
    await page.setViewportSize({ width: 1440, height: 960 });
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
  // The first file has many tags.
  files['games/folder_00/file_00000.rbf'].tags = Array.from({ length: 11 }, (_, index) => index);
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
    tag_dictionary: Object.fromEntries(Array.from({ length: 11 }, (_, index) => [`tag_${index}`, index])),
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

// Whether a row reaches the next one: the box it draws ends right where the next row starts, and its
// content fits in that box (rows are placed at whole pixels, so it is up to a pixel taller).
function meetsNextRow(row) {
  return row.evaluate((element) => {
    const next = element.nextElementSibling;
    if (!(next instanceof HTMLElement)) {
      return false;
    }
    const place = parseFloat(next.style.top) - parseFloat(element.style.top);
    const slack = place - element.getBoundingClientRect().height;
    return parseFloat(getComputedStyle(element, '::before').height) === place && slack >= 0 && slack < 1;
  });
}

// The lines between two rendered rows that are drawn twice, or not at all: each should be drawn by
// exactly one of the two rows, the one's bottom border or the other's top border.
function linesDrawnTwiceOrNot(page) {
  return page.locator('.tree-root').evaluate((root) => {
    const rows = [...root.querySelectorAll(':scope > .tree-entry')];
    const border = (element, side) => parseFloat(getComputedStyle(element, '::before').getPropertyValue(`border-${side}-width`));
    return rows.slice(1).flatMap((row, at) => {
      const above = rows[at];
      // Only rows next to each other in the list share a line.
      if (parseFloat(row.style.top) !== parseFloat(above.style.top) + parseFloat(above.style.getPropertyValue('--tree-row-height'))) {
        return [];
      }
      const drawn = border(above, 'bottom') + border(row, 'top');
      return drawn === 1 ? [] : [`${above.querySelector('h3').textContent} / ${row.querySelector('h3').textContent}: ${drawn}px`];
    });
  });
}
