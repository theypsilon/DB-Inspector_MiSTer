import { expect, test } from '@playwright/test';
import { strToU8, zipSync } from 'fflate';

// What only a real browser shows of the catalog and the databases it opens: nothing on the page or
// in its dialogs wider than a phone's screen with a long db_id everywhere, the catalog's tooltip and
// focus ring, and Clear loading the start page afresh, with Back opening the database again. What
// the catalog lists and selects, its questions, and the combined databases' list are checked in the
// component and unit tests.

const RUNTIME_CATALOG_URL = 'https://raw.githubusercontent.com/theypsilon/Update_All_MiSTer/master/src/update_all/databases.py';
const MULTIDATABASES_CATALOG_URL = 'https://raw.githubusercontent.com/theypsilon/MultiDatabases_MiSTer/main/README.md';
const UPDATE_ALL_URL = 'https://raw.githubusercontent.com/theypsilon/Update_All_MiSTer/db/update_all_db.json';
const PINNED_URL = 'https://raw.githubusercontent.com/theypsilon/MultiDatabases_MiSTer/db/distribution-mister-pinned-linux/db.json.zip';
const JTCORES_URL = 'https://raw.githubusercontent.com/jotego/jtcores_mister/main/jtbindb.json.zip';
const COIN_OP_URL = 'https://raw.githubusercontent.com/Coin-OpCollection/Distribution-MiSTerFPGA/db/db.json.zip';
const EDGE_URL = 'https://raw.githubusercontent.com/MiSTer-devel/Distribution_MiSTer/main/db.json.zip';
const ARCADE_URL = 'https://example.com/catalog/arcade.json';
const EXTRA_URL = 'https://raw.githubusercontent.com/theypsilon/MultiDatabases_MiSTer/db/extra/db.json';
const CUSTOM_URL = 'https://example.com/custom.json';

// Edge Linux comes before the pinned Main Distribution, so "first" and "Update All default" differ.
const RUNTIME_CATALOG_SOURCE = `
self.UPDATE_ALL_MISTER = Database(db_id='update_all_mister', db_url='${UPDATE_ALL_URL}', title='Update All files')
self.MISTER_DEVEL_DISTRIBUTION_MISTER = Database(db_id='distribution_mister', db_url='${EDGE_URL}', title='Main Distribution: MiSTer-devel (Edge Linux)')
self.MISTER_PINNED_LINUX_DISTRIBUTION_MISTER = Database(db_id='distribution_mister', db_url='${PINNED_URL}', title='Main Distribution: MiSTer-devel')
self.JTCORES = Database(db_id='jtcores', db_url='${JTCORES_URL}', title='JTCORES for MiSTer')
self.ARCADE_ROMS = Database(db_id='arcade_roms_db', db_url='${ARCADE_URL}', title='Arcade ROMs Database')
self.COIN_OP_COLLECTION = Database(db_id='Coin-OpCollection/Distribution-MiSTerFPGA', db_url='${COIN_OP_URL}', title='Coin-Op Collection')
`;
const MULTIDATABASES_CATALOG_SOURCE = `
| Database | What it installs | Links |
| --- | --- | --- |
| [Main duplicate](duplicate/) | Duplicate | [Inspect](https://theypsilon.github.io/DB-Inspector_MiSTer/?database-url=${encodeURIComponent(PINNED_URL)}) |
| [Extra](extra/) | Extra files | [Inspect](https://theypsilon.github.io/DB-Inspector_MiSTer/?database-url=${encodeURIComponent(EXTRA_URL)}) |
`;

const DATABASES = [
  [UPDATE_ALL_URL, 'update_all_mister'],
  [EDGE_URL, 'distribution_mister'],
  [PINNED_URL, 'distribution_mister'],
  [JTCORES_URL, 'jtcores'],
  [ARCADE_URL, 'arcade_roms_db'],
  [COIN_OP_URL, 'Coin-OpCollection/Distribution-MiSTerFPGA'],
  [EXTRA_URL, 'extra_db'],
  [CUSTOM_URL, 'distribution_mister'],
];

test.beforeEach(async ({ page }) => {
  await page.route(RUNTIME_CATALOG_URL, (route) => route.fulfill({ status: 200, contentType: 'text/plain', body: RUNTIME_CATALOG_SOURCE }));
  await page.route(MULTIDATABASES_CATALOG_URL, (route) => route.fulfill({ status: 200, contentType: 'text/markdown', body: MULTIDATABASES_CATALOG_SOURCE }));
  for (const [url, dbId] of DATABASES) {
    const json = JSON.stringify({
      db_id: dbId,
      v: 1,
      timestamp: 1710000000,
      base_files_url: 'https://example.com/files/',
      tag_dictionary: { arcade: 0, console: 1 },
      files: { [`cores/${dbId.replaceAll('/', '_')}.rbf`]: { size: 1, hash: dbId, tags: [0] }, 'cores/console.rbf': { size: 2, hash: dbId, tags: [1] } },
      folders: {},
    });
    const zipped = url.endsWith('.zip');
    await page.route(url, (route) =>
      route.fulfill({
        status: 200,
        contentType: zipped ? 'application/zip' : 'application/json',
        body: zipped ? Buffer.from(zipSync({ 'db.json': strToU8(json) })) : json,
      }),
    );
  }
});

test('on a phone, nothing on the page, in the catalog, in the filter terms or in the explorer is wider than the screen', async ({ page }) => {
  const dbId = 'Coin-OpCollection/Distribution-MiSTerFPGA';
  await page.goto('/');

  await test.step('the catalog shows an approximate ID’s tooltip under the pointer, and its search box’s focus ring all round', async () => {
    const catalog = await openCatalog(page, 7);
    const approximation = catalog.locator('.catalog-option').filter({ hasText: 'Extra' }).locator('.catalog-id-approximation');
    await approximation.hover();
    await expect(approximation.getByRole('tooltip')).toBeVisible();
    // The search box's focus ring shows all round, inside what the scrolling body shows.
    await catalog.getByLabel('Search catalog').focus();
    expect(await catalog.getByLabel('Search catalog').evaluate(focusRingShown)).toEqual([true, 'solid', true]);
    // Every database, one per db_id: six, the long db_id among them, each with the same path.
    await catalog.getByRole('button', { name: 'Select all' }).click();
    await catalog.getByRole('button', { name: 'Open 6 selected databases' }).click();
    await expect(page.getByRole('heading', { name: '6 combined databases' })).toBeVisible();
    // One row of the compact list open.
    const row = page.locator('#section-database .combined-database-row').filter({ has: page.getByRole('heading', { name: 'jtcores', exact: true }) });
    await row.locator('summary').click();
    await expect(row.getByText('Loaded from')).toBeVisible();
  });

  await test.step('the page, the own-filter list and a tree row of the long db_id fit a 360px screen', async () => {
    await page.setViewportSize({ width: 360, height: 800 });
    // The databases to give a filter of their own fit it, the long db_id among them, and their
    // list scrolls only up and down. Opened low on the screen, the list scrolls the page to show
    // it whole, and nothing paints over it: neither the FILTER panel's own lines nor the panels below.
    const picker = page.getByRole('button', { name: 'Own filter for a database' });
    await picker.evaluate((button) => window.scrollBy(0, button.getBoundingClientRect().bottom - window.innerHeight + 8));
    await picker.click();
    const choices = page.getByRole('listbox', { name: 'Databases without their own filter' });
    const longest = choices.getByRole('option').filter({ hasText: dbId });
    await expect(longest).toBeVisible();
    // Within a pixel: the page scrolls by whole pixels.
    await expect.poll(() => page.evaluate(() => document.querySelector('.own-filter-popover').getBoundingClientRect().bottom < window.innerHeight + 1)).toBe(true);
    expect(await page.evaluate(findOverOwnFilterList)).toEqual({ belowPanel: true, over: [] });
    await expect.poll(() => page.evaluate(findWiderThanScreen)).toEqual([]);
    expect(await choices.evaluate((list) => list.scrollWidth - list.clientWidth)).toBe(0);
    await longest.click();
    await expect(page.getByLabel(`FILTER for ${dbId}`)).toBeVisible();
    await expect.poll(() => page.evaluate(findWiderThanScreen)).toEqual([]);

    // A tree row of the long db_id, opened with a tap: its database wraps inside the row.
    const row = page.locator('#section-files .tree-entry', { has: page.getByRole('heading', { name: `${dbId.replaceAll('/', '_')}.rbf`, exact: true }) });
    await row.scrollIntoViewIfNeeded();
    await row.locator('h3').click();
    await expect(row.locator('.db-chip')).toBeVisible();
    expect(await row.locator('.db-chip').evaluate((chip) => chip.getBoundingClientRect().right <= chip.closest('.tree-card').getBoundingClientRect().right)).toBe(true);
    await expect.poll(() => page.evaluate(findWiderThanScreen)).toEqual([]);
    await row.locator('h3').click();

    // Under the FILTER boxes, which keep the line's width, their buttons share it.
    const [shared, own, ownTerms, remove] = await Promise.all([
      box(page.getByLabel('FILTER', { exact: true })),
      box(page.getByLabel(`FILTER for ${dbId}`)),
      box(page.getByRole('button', { name: `Terms for ${dbId}` })),
      box(page.locator('.database-filter-row').getByRole('button', { name: 'Remove' })),
    ]);
    expect(own.width).toBe(shared.width);
    expect([ownTerms.y > own.y, ownTerms.width]).toEqual([true, remove.width]);
  });

  await test.step('the filter terms of the long db_id’s own filter scroll only up and down, with the shared filter to include on a line of its own', async () => {
    // A shared filter to include, with a long term.
    await page.getByLabel('FILTER', { exact: true }).fill('arcade !cheats-and-every-other-long-named-extra-of-the-collection');
    await page.getByRole('button', { name: `Terms for ${dbId}` }).click();
    const terms = page.getByRole('dialog', { name: 'Filter terms' });
    const include = terms.locator('.filter-terms-shared');
    await expect(include.locator('code')).toBeVisible();
    // The checkbox beside its words, and the shared filter's terms under them, wrapping.
    const [check, words, sharedTerms, current] = await Promise.all([
      box(include.getByRole('checkbox')),
      box(include.locator('.filter-terms-shared-words > span')),
      box(include.locator('code')),
      box(terms.locator('.filter-terms-current')),
    ]);
    expect([
      check.x + check.width < words.x && Math.abs(check.y + check.height / 2 - (words.y + words.height / 2)) < 1,
      sharedTerms.y >= words.y + words.height && sharedTerms.height > words.height * 2,
      sharedTerms.y + sharedTerms.height <= current.y,
    ]).toEqual([true, true, true]);
    // On a wide screen, where its words and terms fit on one line, the line is still all its own.
    await page.setViewportSize({ width: 1440, height: 960 });
    const [wideInclude, footer, wideCurrent] = await Promise.all([box(include), box(terms.locator('.modal-footer')), box(terms.locator('.filter-terms-current'))]);
    expect([Math.abs(wideInclude.width - footer.width) < 1, wideInclude.height < words.height * 2, wideInclude.y + wideInclude.height <= wideCurrent.y]).toEqual([true, true, true]);
    await page.setViewportSize({ width: 360, height: 800 });
    for (const part of ['.modal-body', '.modal-footer']) {
      expect(await terms.locator(part).evaluate((element) => element.scrollWidth - element.clientWidth), part).toBe(0);
    }
    expect(await terms.evaluate((panel) => panel.getBoundingClientRect().right <= window.innerWidth)).toBe(true);
    // The search box has the focus, and its ring all round: inside what the scrolling body shows.
    expect(
      await terms.getByRole('searchbox', { name: 'Search terms' }).evaluate((input) => {
        const style = getComputedStyle(input);
        const reach = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
        const box = input.getBoundingClientRect();
        const body = input.closest('.modal-body').getBoundingClientRect();
        return [input.matches(':focus-visible'), style.outlineStyle, box.left - reach >= body.left && box.right + reach <= body.right];
      }),
    ).toEqual([true, 'solid', true]);
    await terms.getByRole('button', { name: 'Done' }).click();
    await expect(terms).toHaveCount(0);

    // No filters again, so every database installs every path for the explorer below.
    await page.locator('#section-filter .filter-toolbar').getByRole('button', { name: 'Clear' }).click();
    await page.locator('.database-filter-row').getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByLabel(`FILTER for ${dbId}`)).toHaveCount(0);
    await expect(page.getByLabel('FILTER', { exact: true })).toHaveValue('');
  });

  await test.step('the catalog scrolls only up and down with every database selected, and with the search’s longer labels', async () => {
    const catalog = await openCatalog(page, 7);
    await catalog.getByRole('button', { name: 'Select all' }).click();
    await expect(catalog.getByRole('button', { name: 'Open 6 selected databases' })).toBeVisible();
    expect(await catalog.locator('.modal-body').evaluate((body) => body.scrollWidth - body.clientWidth)).toBe(0);
    await catalog.getByLabel('Search catalog').fill('distribution');
    await expect(catalog.getByRole('button', { name: 'Unselect shown' })).toBeVisible();
    expect(await catalog.locator('.modal-body').evaluate((body) => body.scrollWidth - body.clientWidth)).toBe(0);
    expect(await catalog.getByLabel('Search catalog').evaluate(focusRingShown)).toEqual([true, 'solid', true]);
    await catalog.getByRole('button', { name: 'Close', exact: true }).click();
  });

  await test.step('the explorer fills the screen, and the details of a path every database installs come up from the bottom, the long db_id wrapping', async () => {
    await page.locator('#section-files').getByRole('button', { name: 'Explorer' }).click();
    const explorer = page.getByRole('dialog', { name: 'Explorer' });
    await explorer.getByRole('option', { name: /^cores, folder/ }).dblclick();
    await explorer.getByRole('option', { name: /^console\.rbf, file, 6 versions/ }).click();
    await expect(explorer.getByRole('complementary').locator('.explorer-origins .db-chip', { hasText: dbId })).toBeVisible();
    await expect.poll(() => page.evaluate(findWiderInExplorer)).toEqual([]);
    const panelBox = await explorer.boundingBox();
    await expect
      .poll(async () => {
        const detailsBox = await explorer.getByRole('complementary').boundingBox();
        return [detailsBox.x, detailsBox.width, Math.round(detailsBox.y + detailsBox.height)];
      })
      .toEqual([0, 360, Math.round(panelBox.height)]);
  });
});

// Starts on a fresh page, so it runs beside the test above.
test('Clear loads the start page afresh, and Back opens the database again', async ({ page }) => {
  await page.goto(`/#db=${JTCORES_URL}`);
  await expect(page.getByRole('heading', { name: 'jtcores', exact: true })).toBeVisible();

  await test.step('on a phone, the header of a database alone fits the screen: the Detailed toggle, Install and Clear database wrap', async () => {
    await page.setViewportSize({ width: 360, height: 800 });
    await expect.poll(() => page.evaluate(findWiderThanScreen)).toEqual([]);
    await page.setViewportSize({ width: 1440, height: 960 });
  });

  await test.step('Clear loads the page again without its link, keeping nothing of the session, and Back opens the database again', async () => {
    // A database fetched from a URL the catalog does not have joins it, for this session only.
    await page.getByLabel('URL').fill(CUSTOM_URL);
    await page.getByRole('button', { name: 'Fetch database' }).click();
    await page.getByRole('dialog', { name: 'Combine with the loaded databases?' }).getByRole('button', { name: 'Load alone' }).click();
    await expect(page.getByText('8 entries available')).toBeVisible();

    await page.getByRole('button', { name: 'Clear database' }).click();
    await page.getByRole('dialog', { name: 'Clear the loaded database?' }).getByRole('button', { name: 'Clear', exact: true }).click();
    await page.waitForURL((url) => url.pathname === '/' && !url.hash);
    await expect(page.getByText('7 entries available')).toBeVisible();
    await expect(page.locator('#section-database')).toHaveCount(0);
    await expect(page.locator('.hero-compact')).toHaveCount(0);

    await page.goBack();
    await expect(page.getByRole('heading', { name: 'distribution_mister', exact: true })).toBeVisible();
    await expect.poll(() => new URL(page.url()).hash).toBe(`#db=${CUSTOM_URL}`);
  });
});

// Runs in the page. Nothing when the page fits the screen; otherwise by how much it does not, and
// each element that sticks out past the screen's edge while its parent does not.
function findWiderThanScreen() {
  const overflow = document.documentElement.scrollWidth - window.innerWidth;
  if (overflow <= 0) {
    return [];
  }
  const sticksOut = (element) => element.getBoundingClientRect().right > window.innerWidth;
  const culprits = [...document.body.querySelectorAll('*')]
    .filter((element) => sticksOut(element) && !sticksOut(element.parentElement))
    .map((element) => `<${element.localName} class="${element.getAttribute('class') ?? ''}"> ${element.textContent.slice(0, 60)}`);
  return [`${overflow}px wider than the screen`, ...culprits];
}

// Runs in the page, on a focused input in a dialog: whether its focus ring shows, how it is drawn,
// and whether it is all inside what the dialog's scrolling body shows.
function focusRingShown(input) {
  const style = getComputedStyle(input);
  const reach = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
  const box = input.getBoundingClientRect();
  const body = input.closest('.modal-body').getBoundingClientRect();
  return [input.matches(':focus-visible'), style.outlineStyle, box.left - reach >= body.left && box.right + reach <= body.right && box.top - reach >= body.top];
}

// Runs in the page. Whether the own-filter picker's list reaches past its panel onto the panels
// below, and what paints over it, at points 10px apart across it (inside its rounded corners).
function findOverOwnFilterList() {
  const popover = document.querySelector('.own-filter-popover');
  const box = popover.getBoundingClientRect();
  const inset = parseFloat(getComputedStyle(popover).borderTopLeftRadius) + 1;
  const over = new Set();
  for (let y = box.top + inset; y < box.bottom - inset; y += 10) {
    for (let x = box.left + inset; x < box.right - inset; x += 10) {
      const hit = document.elementFromPoint(x, y);
      if (hit && !popover.contains(hit)) {
        over.add(`<${hit.localName} class="${hit.getAttribute('class') ?? ''}">`);
      }
    }
  }
  return { belowPanel: box.bottom > document.getElementById('section-filter').getBoundingClientRect().bottom, over: [...over] };
}

// Runs in the page. Nothing when the explorer fits the screen and nothing in it scrolls sideways;
// otherwise what does not.
function findWiderInExplorer() {
  const panel = document.querySelector('.explorer-panel');
  const problems = panel.getBoundingClientRect().right > window.innerWidth ? ['the explorer is wider than the screen'] : [];
  for (const part of panel.querySelectorAll('.explorer-bar, .explorer-items, .explorer-details')) {
    if (part.scrollWidth > part.clientWidth) {
      problems.push(`.${part.className.split(' ')[0]} is ${part.scrollWidth - part.clientWidth}px wider than its place`);
    }
  }
  return problems;
}

async function openCatalog(page, entryCount) {
  await page.getByRole('button', { name: 'Browse catalog' }).click();
  const catalog = page.getByRole('dialog', { name: 'Browse database catalog' });
  await expect(catalog.getByText(`${entryCount} of ${entryCount} entries`)).toBeVisible();
  return catalog;
}

function box(locator) {
  return locator.boundingBox();
}
