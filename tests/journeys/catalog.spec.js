import { expect, test } from '@playwright/test';
import { strToU8, zipSync } from 'fflate';

// The catalog in a real browser: entries from Update All and MultiDatabases, databases fetched by
// URL joining it, approximate IDs, the Update All defaults, the db_id question, select all, when
// opening asks to combine, reviewing the selection, and Clear going back to the start page.

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
const UPDATE_ALL_DEFAULTS = [
  'Update All files (update_all_mister)',
  'Main Distribution: MiSTer-devel (distribution_mister)',
  'JTCORES for MiSTer (jtcores)',
  'Coin-Op Collection (Coin-OpCollection/Distribution-MiSTerFPGA)',
];
const EDGE = 'Main Distribution: MiSTer-devel (Edge Linux) (distribution_mister)';

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

test('the catalog lists known databases and opens them alone or together', async ({ page }) => {
  const loadMode = page.getByRole('dialog', { name: 'Combine with the loaded databases?' });
  await page.goto('/');
  await expect(page.getByText('7 entries available')).toBeVisible();

  await test.step('a database fetched from a catalog URL is that catalog entry', async () => {
    await fetchDatabase(page, ARCADE_URL);
    await expect(page.getByRole('heading', { name: 'arcade_roms_db', exact: true })).toBeVisible();
    await expect(page.getByText('7 entries available')).toBeVisible();
    const catalog = await openCatalog(page, 7);
    await expect(catalog.locator('.catalog-loaded-badge')).toHaveCount(1);
    await expect(catalog.locator('.catalog-option').filter({ hasText: 'Arcade ROMs Database' })).toContainText('Loaded');
    await catalog.getByRole('button', { name: 'Close', exact: true }).click();
  });

  await test.step('a database fetched from another URL joins the catalog, next to those that share its db_id', async () => {
    await fetchDatabase(page, CUSTOM_URL);
    await loadMode.getByRole('button', { name: 'Load alone' }).click();
    await expect(page.getByText('8 entries available')).toBeVisible();
    const catalog = await openCatalog(page, 8);
    await expect(catalog.locator('.catalog-option').filter({ hasText: 'example.com / custom.json' })).toHaveCount(1);
    await expect(catalog.locator('.catalog-option').filter({ hasText: 'Main Distribution: MiSTer-devel' })).toHaveCount(2);
    await catalog.getByRole('button', { name: 'Close', exact: true }).click();
  });

  await test.step('an approximate ID says so until its database is opened', async () => {
    let catalog = await openCatalog(page, 8);
    const extra = catalog.locator('.catalog-option').filter({ hasText: 'Extra' });
    await expect(extra).toContainText('MultiDatabases/extra');
    const approximation = extra.locator('.catalog-id-approximation');
    await approximation.hover();
    await expect(approximation.getByRole('tooltip')).toBeVisible();
    await expect(approximation.getByRole('tooltip')).toHaveText('The real database ID will be determined when the database is opened.');
    await expect(catalog.locator('.catalog-option').filter({ hasText: 'Main duplicate' })).toHaveCount(0);

    await extra.click();
    await catalog.getByRole('button', { name: 'Open selected database' }).click();
    await loadMode.getByRole('button', { name: 'Load alone' }).click();
    await expect(page.getByRole('heading', { name: 'extra_db', exact: true })).toBeVisible();

    catalog = await openCatalog(page, 8);
    const opened = catalog.locator('.catalog-option').filter({ hasText: 'Extra' });
    await expect(opened).toContainText('extra_db');
    await expect(opened).not.toContainText('Approximate ID');
    await expect(opened.locator('.catalog-loaded-badge')).toHaveText('Loaded');
    await catalog.getByRole('button', { name: 'Close', exact: true }).click();
  });

  await test.step('the Update All defaults, the db_id question, and select all', async () => {
    const catalog = await openCatalog(page, 8);
    // The search box's focus ring shows all round, inside what the scrolling body shows.
    await catalog.getByLabel('Search catalog').focus();
    expect(await catalog.getByLabel('Search catalog').evaluate(focusRingShown)).toEqual([true, 'solid', true]);
    await catalog.getByRole('button', { name: 'Select Update All defaults' }).click();
    await expect.poll(() => selectedNames(page)).toEqual(UPDATE_ALL_DEFAULTS);

    const edge = catalog.getByRole('checkbox', { name: EDGE, exact: true });
    const question = page.getByRole('dialog', { name: 'Replace the selected database?' });
    await edge.click();
    await expect(question).toContainText('Another selected database has the db_id distribution_mister.');
    // Escape answers the question, not the catalog.
    await page.keyboard.press('Escape');
    await expect(question).toHaveCount(0);
    await expect(catalog).toBeVisible();
    await expect(edge).not.toBeChecked();
    await edge.click();
    await question.getByRole('button', { name: 'Replace' }).click();
    await expect(edge).toBeChecked();

    // Select all keeps the database chosen for a db_id.
    await catalog.getByRole('button', { name: 'Select all' }).click();
    await expect(edge).toBeChecked();
    await expect(catalog.getByRole('button', { name: 'Open 6 selected databases' })).toBeVisible();
    await catalog.getByRole('button', { name: 'Select none' }).click();
    await expect.poll(() => selectedNames(page)).toEqual([]);
    await catalog.getByRole('button', { name: 'Select Update All defaults' }).click();
  });

  await test.step('opening asks to combine only when it would close a loaded database', async () => {
    const catalog = page.getByRole('dialog', { name: 'Browse database catalog' });
    await catalog.getByRole('button', { name: 'Open 4 selected databases' }).click();
    await expect(loadMode).toContainText('Load the 4 selected databases alone to replace it');
    await loadMode.getByRole('button', { name: 'Combine' }).click();
    await expect(page.getByRole('heading', { name: '5 combined databases' })).toBeVisible();
    await expect(page.locator('.combined-database-card h3')).toHaveText([
      'extra_db',
      'update_all_mister',
      'distribution_mister',
      'jtcores',
      'Coin-OpCollection/Distribution-MiSTerFPGA',
    ]);

    // Every loaded database is part of this selection, so it opens afresh without a question.
    const again = await openCatalog(page, 8);
    await again.getByRole('button', { name: 'Select all' }).click();
    await again.getByRole('button', { name: 'Open 6 selected databases' }).click();
    await expect(page.getByRole('heading', { name: '6 combined databases' })).toBeVisible();
    await expect(loadMode).toHaveCount(0);
    await expect.poll(() => new URLSearchParams(new URL(page.url()).hash.slice(1)).getAll('db')).toContain(JTCORES_URL);
  });

  await test.step('more than three databases list compactly, each opening on its own, in a section that collapses', async () => {
    const section = page.locator('#section-database');
    const rows = section.locator('.combined-database-row');
    await expect(rows).toHaveCount(6);
    const row = (dbId) => rows.filter({ has: page.getByRole('heading', { name: dbId, exact: true }) });
    await expect(row('jtcores').getByText('Loaded from')).toBeHidden();
    await row('jtcores').locator('summary').click();
    await expect(row('jtcores').getByText('Loaded from')).toBeVisible();
    await expect(row('jtcores').getByRole('button', { name: 'Install' })).toBeVisible();
    await expect(row('update_all_mister').getByText('Loaded from')).toBeHidden();

    // The Detailed toggle sits in the section's summary, and clicking it does not collapse it.
    const toggle = section.getByRole('button', { name: 'Detailed toggle' });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(row('jtcores').getByText('Default filter')).toBeVisible();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');

    // So does Clear databases, which asks first; Cancel leaves the section as it was.
    await section.locator('summary.section-summary').getByRole('button', { name: 'Clear databases' }).click();
    const clear = page.getByRole('dialog', { name: 'Clear the loaded databases?' });
    await expect(clear).toContainText('This closes the 6 loaded databases');
    await clear.getByRole('button', { name: 'Cancel' }).click();
    await expect(clear).toHaveCount(0);
    await expect(rows.first()).toBeVisible();

    const indicator = section.locator('summary.section-summary .summary-indicator');
    await indicator.click();
    await expect(rows.first()).toBeHidden();
    await expect(toggle).toBeVisible();
    await indicator.click();
    await expect(rows.first()).toBeVisible();
  });

  await test.step('on a phone, nothing on the page, in the catalog, in the filter terms or in the explorer is wider than the screen', async () => {
    // A long db_id in the compact list (one row open), on rows and in path collisions, in issues and
    // tags, and in the filters, with a filter of its own.
    const viewport = page.viewportSize();
    const link = new URL(page.url()).hash;
    const dbId = 'Coin-OpCollection/Distribution-MiSTerFPGA';
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
    await expect(page.getByLabel(`FILTER for ${dbId}`)).toBeFocused();
    await expect.poll(() => page.evaluate(findWiderThanScreen)).toEqual([]);

    // A tree row of the long db_id, opened with a tap: its database wraps inside the row.
    const row = page.locator('#section-files .tree-entry', { has: page.getByRole('heading', { name: `${dbId.replaceAll('/', '_')}.rbf`, exact: true }) });
    await row.scrollIntoViewIfNeeded();
    await row.locator('h3').click();
    await expect(row.locator('.db-chip')).toHaveText(dbId);
    expect(await row.locator('.db-chip').evaluate((chip) => chip.getBoundingClientRect().right <= chip.closest('.tree-card').getBoundingClientRect().right)).toBe(true);
    await expect.poll(() => page.evaluate(findWiderThanScreen)).toEqual([]);
    await row.locator('h3').click();

    // Under the FILTER boxes, which keep the line's width, their buttons share it.
    const box = (locator) => locator.boundingBox();
    const [shared, own, ownTerms, remove] = await Promise.all([
      box(page.getByLabel('FILTER', { exact: true })),
      box(page.getByLabel(`FILTER for ${dbId}`)),
      box(page.getByRole('button', { name: `Terms for ${dbId}` })),
      box(page.locator('.database-filter-row').getByRole('button', { name: 'Remove' })),
    ]);
    expect(own.width).toBe(shared.width);
    expect([ownTerms.y > own.y, ownTerms.width]).toEqual([true, remove.width]);

    // Its terms name it on every term, and the dialog scrolls only up and down, with a shared
    // filter to include, a long term among its own.
    await page.getByLabel('FILTER', { exact: true }).fill('arcade !cheats-and-every-other-long-named-extra-of-the-collection');
    await page.getByRole('button', { name: `Terms for ${dbId}` }).click();
    const terms = page.getByRole('dialog', { name: 'Filter terms' });
    await expect(terms.locator('.filter-term .db-chip', { hasText: dbId })).toHaveCount(2);
    // The shared filter to include has a line of its own above FILTER: the checkbox beside its
    // words, and the shared filter's terms under them, wrapping.
    const include = terms.locator('.filter-terms-shared');
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
    await page.setViewportSize(viewport);
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
    await page.locator('#section-filter .filter-toolbar').getByRole('button', { name: 'Clear' }).click();
    await page.locator('.database-filter-row').getByRole('button', { name: 'Remove' }).click();
    await expect.poll(() => new URL(page.url()).hash).toBe(link);

    // The catalog's selection names it too, and the catalog scrolls only up and down, with the
    // search's longer labels too.
    const catalog = await openCatalog(page, 8);
    await catalog.getByRole('button', { name: 'Select all' }).click();
    await expect(catalog.getByRole('button', { name: 'Open 6 selected databases' })).toBeVisible();
    expect(await catalog.locator('.modal-body').evaluate((body) => body.scrollWidth - body.clientWidth)).toBe(0);
    await catalog.getByLabel('Search catalog').fill('distribution');
    await expect(catalog.getByRole('button', { name: 'Unselect shown' })).toBeVisible();
    expect(await catalog.locator('.modal-body').evaluate((body) => body.scrollWidth - body.clientWidth)).toBe(0);
    expect(await catalog.getByLabel('Search catalog').evaluate(focusRingShown)).toEqual([true, 'solid', true]);
    await catalog.getByRole('button', { name: 'Close', exact: true }).click();

    // The explorer fills the screen, and a path every database installs lists each version, the
    // long db_id wrapping in its details.
    await page.locator('#section-files').getByRole('button', { name: 'Explorer' }).click();
    const explorer = page.getByRole('dialog', { name: 'Explorer' });
    await explorer.getByRole('option', { name: /^cores, folder/ }).dblclick();
    await explorer.getByRole('option', { name: /^console\.rbf, file, 6 versions/ }).click();
    await expect(explorer.getByRole('complementary').locator('.explorer-origins .db-chip', { hasText: dbId })).toBeVisible();
    await expect.poll(() => page.evaluate(findWiderInExplorer)).toEqual([]);
    // The details come up from the bottom, as wide as the screen.
    const panelBox = await explorer.boundingBox();
    await expect
      .poll(async () => {
        const detailsBox = await explorer.getByRole('complementary').boundingBox();
        return [detailsBox.x, detailsBox.width, Math.round(detailsBox.y + detailsBox.height)];
      })
      .toEqual([0, 360, Math.round(panelBox.height)]);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(explorer).toHaveCount(0);
    await page.setViewportSize(viewport);
  });

  await test.step('reviewing the selection lists only the selected databases', async () => {
    const catalog = await openCatalog(page, 8);
    await catalog.getByRole('button', { name: 'Select all' }).click();
    await catalog.getByRole('button', { name: 'Review selected' }).click();
    await expect(catalog.getByText('6 of 8 entries')).toBeVisible();
    await catalog.getByRole('checkbox', { name: UPDATE_ALL_DEFAULTS[0], exact: true }).uncheck();
    await expect(catalog.locator('.catalog-option')).toHaveCount(6);
    await catalog.getByRole('button', { name: 'Show all entries' }).click();
    await expect(catalog.getByText('8 of 8 entries')).toBeVisible();

    await catalog.getByRole('button', { name: 'Select all' }).click();
    await catalog.getByRole('button', { name: 'Select none' }).click();
    await catalog.getByRole('checkbox', { name: UPDATE_ALL_DEFAULTS[2], exact: true }).check();
    await catalog.getByRole('button', { name: 'Open selected database' }).click();
    await loadMode.getByRole('button', { name: 'Load alone' }).click();
    await expect(page.getByRole('heading', { name: 'jtcores', exact: true })).toBeVisible();
    await expect.poll(() => new URL(page.url()).hash).toBe(`#db=${JTCORES_URL}`);
  });

  await test.step('Clear asks first, then opens the start page afresh, and Back opens the database again', async () => {
    // On a phone, the Detailed toggle, Install and Clear database wrap rather than leave the screen.
    const viewport = page.viewportSize();
    await page.setViewportSize({ width: 360, height: 800 });
    await expect.poll(() => page.evaluate(findWiderThanScreen)).toEqual([]);
    await page.setViewportSize(viewport);

    await page.getByRole('button', { name: 'Clear database' }).click();
    const clear = page.getByRole('dialog', { name: 'Clear the loaded database?' });
    await clear.getByRole('button', { name: 'Clear', exact: true }).click();
    // The page loads again without its link: nothing loaded, the introduction open, and the
    // catalog without the database fetched from another URL that joined it.
    await page.waitForURL((url) => url.pathname === '/' && !url.hash);
    await expect(page.getByText('7 entries available')).toBeVisible();
    await expect(page.locator('#section-database')).toHaveCount(0);
    await expect(page.locator('.hero-compact')).toHaveCount(0);

    await page.goBack();
    await expect(page.getByRole('heading', { name: 'jtcores', exact: true })).toBeVisible();
    await expect.poll(() => new URL(page.url()).hash).toBe(`#db=${JTCORES_URL}`);
  });
});

async function fetchDatabase(page, url) {
  await page.getByLabel('URL').fill(url);
  await page.getByRole('button', { name: 'Fetch database' }).click();
}

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

function selectedNames(page) {
  return page
    .getByRole('checkbox', { checked: true })
    .evaluateAll((boxes) => boxes.map((box) => box.getAttribute('aria-label')).filter(Boolean));
}
