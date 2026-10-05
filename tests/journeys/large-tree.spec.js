import { expect, test } from '@playwright/test';

// The virtualized trees of a large database in a real browser: only rows near the viewport render,
// rows keep touching as details and tags open and close, with each line between two rows drawn
// once, a row shows as many tags as fit its line at any width, the last rows can be reached, and URL anchors, find-in-page and ghost parent rows bring far
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

  await test.step('rows keep touching as their details open and close, and draw each line between them once', async () => {
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
    // Only a row's link icon puts it in the address.
    expect(page.url()).toBe(urlBefore);
  });

  await test.step('a row shows as many tags as fit its line at any width, and keeps touching the next as they change, open and close', async () => {
    const file = rowNamed(page, 'file_00000.rbf');
    // Its eleven short tags fit at 1440px.
    await expect(file.locator('.tag-chip')).toHaveCount(11);
    await expect(file.getByRole('button', { name: /more tags/ })).toHaveCount(0);
    // At 960px and narrower a file leaves its tags to its details (the next step), so the narrower
    // widths are checked on its folder, which has the same eleven tags.
    const row = rowNamed(page, 'folder_00');
    for (const [width, fitted] of [[700, row], [1440, file], [1440, row], [360, row]]) {
      await page.setViewportSize({ width, height: 960 });
      await scrollUntilSteady(page.locator('.tree-root'), 100);
      await expect.poll(() => tagLineMisfits(fitted)).toEqual([]);
      await expect.poll(() => meetsNextRow(fitted)).toBe(true);
    }
    // On a phone some are counted.
    const shown = await row.locator('.tag-chip').count();
    expect(shown).toBeLessThan(11);
    for (const [button, chips] of [[`+${11 - shown} more tags`, 11], ['Show fewer', shown]]) {
      await row.getByRole('button', { name: button }).click();
      await expect(row.locator('.tag-chip')).toHaveCount(chips);
      await expect.poll(() => meetsNextRow(row)).toBe(true);
    }
    // And at every width of the list 4px apart, through the widths where a tag comes or goes.
    const widths = Array.from({ length: 31 }, (_, step) => 310 - step * 4);
    expect(await tagLineMisfits(row, widths)).toEqual([]);
    await expect.poll(() => meetsNextRow(row)).toBe(true);
    await page.setViewportSize({ width: 1440, height: 960 });
  });

  await test.step('at 960px and narrower a file leaves its tags to its details, from the width its heading stacks, and the rows keep touching and reach the end', async () => {
    const file = rowNamed(page, 'file_00000.rbf');
    const folder = rowNamed(page, 'folder_00');
    const heading = () => file.locator('.tree-heading').evaluate((element) => getComputedStyle(element).flexDirection);
    await page.setViewportSize({ width: 960, height: 960 });
    await scrollUntilSteady(page.locator('.tree-root'), 100);
    await expect(file.locator('.primary-row')).toHaveCount(0);
    expect(await heading()).toBe('column');
    await expect(folder.locator('.tag-chip').first()).toBeVisible();
    await expect.poll(() => meetsNextRow(file)).toBe(true);
    for (const [button, chips] of [['Show details', 11], ['Hide details', 0]]) {
      await file.getByRole('button', { name: button }).click();
      await expect(file.locator('.tag-chip')).toHaveCount(chips);
      await expect.poll(() => meetsNextRow(file)).toBe(true);
    }

    // One pixel wider, its heading is on one line and its tags are back.
    await page.setViewportSize({ width: 961, height: 960 });
    await expect(file.locator('.tag-chip').first()).toBeVisible();
    expect(await heading()).toBe('row');
    await expect.poll(() => meetsNextRow(file)).toBe(true);

    await page.setViewportSize({ width: 960, height: 960 });
    await expect(file.locator('.primary-row')).toHaveCount(0);
    await scrollUntilSteady(page.locator('.tree-root'), 'end');
    await expect(page.getByRole('heading', { name: `file_${String(FILE_COUNT - 1).padStart(5, '0')}.rbf` })).toBeInViewport();
    await page.setViewportSize({ width: 1440, height: 960 });
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

  await test.step('the explorer renders only the entries near view of a large folder, as icons and as a list, and reaches the last', async () => {
    // The page's time runs as usual until a step stops it.
    await page.clock.install();
    await page.goto('about:blank');
    await page.goto('/#at=explorer:games/archive');
    await upload(page, 'large.json', buildLargeDatabase());
    const explorer = page.getByRole('dialog', { name: 'Explorer' });
    const last = `rom_${String(ARCHIVE_COUNT - 1).padStart(3, '0')}.bin`;
    const entry = (name) => explorer.getByRole('option', { name: new RegExp(`^${name.replace('.', '\\.')},`) });
    await expect(explorer.locator('.explorer-crumb-current')).toHaveText('archive');
    await expect(entry('rom_000.bin')).toBeVisible();
    await expect(entry('rom_000.bin')).toHaveAttribute('aria-setsize', String(ARCHIVE_COUNT));

    // The icons first, as the explorer opens in them, then the list.
    for (const [view, toggle] of [['icons', null], ['list', 'Show as list']]) {
      if (toggle) {
        await explorer.getByRole('button', { name: toggle }).click();
        await expect(explorer.locator('.explorer-row').first()).toBeVisible();
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
    await explorer.getByRole('button', { name: 'Show as icons' }).click();

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

  await test.step('the icons: drawn in place on opening, a double click going into a folder before the details move anything, and making way for the details at once', async () => {
    const explorer = page.getByRole('dialog', { name: 'Explorer' });
    const entry = (name) => explorer.getByRole('option', { name: new RegExp(`^${name.replace('.', '\\.')},`) });
    const details = explorer.getByRole('complementary');
    // Runs in the page: the number of columns of the icons drawn.
    const countColumns = () => new Set([...document.querySelectorAll('.explorer-tile')].map((tile) => tile.style.transform.split(',')[0])).size;

    // Opening in the icons, the icons are drawn in their places, rather than glide there from where
    // they were first put: one is where it was first drawn ten frames later.
    await page.goto('about:blank');
    await page.goto('/#at=explorer:games');
    await page.evaluate(() => {
      window.firstPlaces = new Promise((resolve) => {
        const observer = new MutationObserver(() => {
          const tile = document.querySelector('[role="option"][aria-label^="folder_14,"]');
          if (!tile) return;
          observer.disconnect();
          const first = tile.getBoundingClientRect();
          let frames = 0;
          const later = () => {
            frames += 1;
            if (frames < 10) {
              requestAnimationFrame(later);
            } else {
              const last = tile.getBoundingClientRect();
              resolve([[first.x, first.y], [last.x, last.y]]);
            }
          };
          requestAnimationFrame(later);
        });
        observer.observe(document.body, { childList: true, subtree: true });
      });
    });
    await upload(page, 'large.json', buildLargeDatabase());
    const [first, last] = await page.evaluate(() => window.firstPlaces);
    expect(last).toEqual(first);

    // The last of the folders, at the end of the second row of icons, which fewer columns move.
    const folder = entry('folder_14');
    await expect(folder).toBeVisible();

    // The page's time moves only when the test moves it, from here.
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1_000));
    const box = await folder.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    await expect(folder).toHaveAttribute('aria-selected', 'true');
    // Up to the double click time later, nothing has moved under the pointer.
    await page.clock.runFor(250);
    expect(await folder.boundingBox()).toEqual(box);
    await expect(details).toHaveCount(0);
    // The second click of the double click goes in, and the details never come up.
    await page.mouse.down({ clickCount: 2 });
    await page.mouse.up({ clickCount: 2 });
    await expect(explorer.locator('.explorer-crumb-current')).toHaveText('folder_14');
    await page.clock.runFor(1_000);
    await expect(details).toHaveCount(0);

    // A click shows the details after the wait. The icons are laid out at once for the width the
    // list will have, in fewer columns, while the details are only starting to slide in.
    const before = await page.evaluate(countColumns);
    // Runs in the page: the details' width, and the icons' columns, as the details start to open.
    await page.evaluate(() => {
      const slot = document.querySelector('.explorer-details-slot');
      window.detailsOpening = new Promise((resolve) => {
        const observer = new MutationObserver(() => {
          if (!slot.classList.contains('is-open')) return;
          observer.disconnect();
          const columns = new Set([...document.querySelectorAll('.explorer-tile')].map((tile) => tile.style.transform.split(',')[0])).size;
          resolve({ slotWidth: slot.getBoundingClientRect().width, columns });
        });
        observer.observe(slot, { attributes: true, attributeFilter: ['class'] });
      });
    });
    await entry('file_00560.rbf').click();
    await page.clock.runFor(300);
    await expect(explorer.getByRole('complementary', { name: 'Details of file_00560.rbf' })).toBeVisible();
    const opening = await page.evaluate(() => window.detailsOpening);
    expect(opening.slotWidth).toBeLessThan(100);
    expect(opening.columns).toBeLessThan(before);
    await page.clock.resume();
    // Once the details are in, the last icon is inside the list, beside them.
    await expect
      .poll(async () => {
        const [tile, list] = await Promise.all([entry('file_00599.rbf').boundingBox(), explorer.locator('.explorer-items').boundingBox()]);
        return list.width < 1100 && tile.x + tile.width <= list.x + list.width;
      })
      .toBe(true);

    // Visitors who ask for less motion get the same places without the movement.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const durations = () =>
      page.evaluate(() => [document.querySelector('.explorer-details-slot'), document.querySelector('.explorer-tile')].map((element) => getComputedStyle(element).transitionDuration));
    expect(await durations()).toEqual(['0s', '0s']);
    await page.emulateMedia({ reducedMotion: null });
    expect(await durations()).not.toEqual(['0s', '0s']);
  });

  await test.step('of a long list of filter terms, only those on screen are laid out', async () => {
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Explorer' })).toHaveCount(0);
    await page.locator('#section-filter').getByRole('button', { name: 'Terms', exact: true }).click();
    const terms = page.getByRole('dialog', { name: 'Filter terms' });
    const names = terms.locator('.filter-term strong');
    await expect(names).toHaveCount(71);
    // Runs in the page: whether a term's name is laid out (not skipped as off screen).
    const laidOut = (name) => name.evaluate((element) => element.checkVisibility({ contentVisibilityAuto: true }));
    // The terms are in the page before the browser has told which are on screen, which it does by
    // the next frame: until then they all count as skipped.
    await expect.poll(() => laidOut(names.first())).toBe(true);
    expect(await laidOut(names.last())).toBe(false);
    await names.last().scrollIntoViewIfNeeded();
    await expect.poll(() => laidOut(names.last())).toBe(true);
    // The count follows, once the dialog is on screen.
    await expect(terms.locator('.filter-terms-matches')).toHaveText(`Matches all ${(FILE_COUNT + ARCHIVE_COUNT).toLocaleString('en-US')} files`);
    await terms.getByRole('button', { name: 'Done' }).click();
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
  // The first file has many tags, and so does its folder.
  files['games/folder_00/file_00000.rbf'].tags = Array.from({ length: 11 }, (_, index) => index);
  folders['games/folder_00'].tags = Array.from({ length: 11 }, (_, index) => index);
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
    // Eleven tags the first file and its folder use, and more that nothing uses, for a long list of
    // filter terms.
    tag_dictionary: Object.fromEntries([
      ...Array.from({ length: 11 }, (_, index) => [`tag_${index}`, index]),
      ...Array.from({ length: 60 }, (_, index) => [`unused_${String(index).padStart(2, '0')}`, 100 + index]),
    ]),
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

// Where a row's tags do not fit as they should, as the list is or, narrowing the list, at each of
// `widths`: more than one line, unless the first tag and "+N" do not fit together; or room for one
// more of them (the file's tags are tag_0 to tag_10), with "+N" one less, on a line 2px narrower
// than theirs, the room the page keeps against rounding (TAG_FIT_MARGIN_PX). Each width is checked
// once the row's tags hold still for three frames.
function tagLineMisfits(row, widths = [null]) {
  return row.evaluate(async (element, listWidths) => {
    const root = element.closest('.tree-root');
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const lines = (tags) => new Set([...tags.children].map((tag) => Math.round(tag.getBoundingClientRect().top))).size;
    const misfits = [];
    for (const width of listWidths) {
      if (width !== null) {
        root.style.width = `${width}px`;
        // The list's new width is laid out, then its tags are counted again.
        await frame();
        await frame();
        for (let still = 0, last = null, frames = 0; still < 3 && frames < 120; frames += 1) {
          await frame();
          const now = element.querySelector('.tag-chip-list').textContent;
          still = now === last ? still + 1 : 0;
          last = now;
        }
      }
      if (!element.isConnected) {
        misfits.push(`${width}px: the row left the list`);
        break;
      }
      const line = element.querySelector('.primary-row');
      const list = line.querySelector('.tag-chip-list');
      const shown = list.querySelectorAll('.tag-chip').length;
      if (shown > 1 && lines(list) > 1) {
        misfits.push(`${width}px: ${shown} tags on ${lines(list)} lines`);
      }
      if (shown < 11) {
        const trial = list.cloneNode(true);
        Object.assign(trial.style, { position: 'absolute', visibility: 'hidden', width: `${line.getBoundingClientRect().width - 2}px` });
        const next = trial.querySelector('.tag-chip').cloneNode(true);
        next.firstChild.textContent = `tag_${shown}`;
        const more = trial.querySelector('.tag-chip-toggle');
        trial.insertBefore(next, more);
        if (shown + 1 < 11) {
          more.textContent = `+${11 - shown - 1}`;
        } else {
          more.remove();
        }
        line.append(trial);
        if (lines(trial) === 1) {
          misfits.push(`${width}px: room for tag_${shown} after ${shown} tags`);
        }
        trial.remove();
      }
    }
    root.style.width = '';
    return misfits;
  }, widths);
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
