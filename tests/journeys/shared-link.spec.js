import { expect, test } from '@playwright/test';

// A database opened from a shared link, in a real browser: an old link becoming its #db= link, its
// default FILTER and the link, the detailed toggle, size hints and downloads, find-in-page with its
// highlights and row flash, section and row anchors across a reload, the explorer and its link,
// back/forward between databases, and a link typed in the address bar of the open page.

const SHARED_URL = 'https://raw.githubusercontent.com/example-owner/example-repo/main/db.json';
const SECOND_URL = 'https://example.com/second.json';

function database(dbId, extra = {}) {
  return {
    db_id: dbId,
    v: 1,
    timestamp: 1710000000,
    base_files_url: 'https://example.com/base/',
    tag_dictionary: { essential: 0, arcade: 1, console: 2 },
    files: {
      'cores/essential.rbf': { size: 1024, hash: 'h1', tags: [0] },
      'cores/arcade.rbf': { size: 2048, hash: 'h2', tags: [1] },
      'cores/console.rbf': { size: 3000, hash: 'h3', tags: [2] },
      'docs/notes.txt': { size: 10, hash: 'h4', url: 'https://example.com/files/notes.txt' },
    },
    folders: { 'cores/': {}, 'docs/': {} },
    archives: {
      flows_archive: {
        description: 'Flows archive',
        format: 'zip',
        extract: 'selective',
        target_folder: 'games/flows/',
        archive_file: { url: 'https://example.com/flows.zip', size: 4096, hash: 'ah' },
        summary_inline: { files: { 'games/flows/untagged.bin': { arc_id: 'flows_archive', arc_at: 'untagged.bin', size: 100 } }, folders: {} },
      },
    },
    ...extra,
  };
}

test.beforeEach(async ({ page }) => {
  const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route(SHARED_URL, (route) => route.fulfill(json(database('shared_db', { default_options: { filter: 'arcade' } }))));
  await page.route(SECOND_URL, (route) => route.fulfill(json(database('second_db'))));
});

test('a shared link opens its database, and the page around it works', async ({ page }) => {
  // The page clock runs normally, except while the find step stops it to time the row flash.
  await page.clock.install();
  // A link from before the #, as READMEs still have them.
  await page.goto(`/?database-url=${encodeURIComponent(SHARED_URL)}`);
  const filter = page.getByLabel('FILTER');
  const heading = (name) => page.getByRole('heading', { name, exact: true });
  const link = () => new URL(page.url()).hash;

  await test.step('an old link opens its database as its #db= link, with its default FILTER and a link to its repository', async () => {
    await expect(heading('shared_db')).toBeVisible();
    expect(new URL(page.url()).search).toBe('');
    // The database's repository, in its overview (the top of the page links to this project's).
    const repoLink = page.locator('#section-database .github-repo-link');
    await expect(repoLink).toHaveText('example-owner/example-repo');
    await expect(repoLink).toHaveAttribute('href', 'https://github.com/example-owner/example-repo');
    await expect(filter).toHaveValue('arcade');
    await expect(heading('arcade.rbf')).toBeVisible();
    await expect(heading('console.rbf')).toHaveCount(0);
    expect(link()).toBe(`#db=${SHARED_URL}`);
  });

  await test.step('FILTER follows into the link, Clear restores the default, and an empty FILTER shows everything', async () => {
    await filter.fill('console');
    await expect(heading('console.rbf')).toBeVisible();
    await expect(heading('arcade.rbf')).toHaveCount(0);
    await expect.poll(link).toBe(`#db=${SHARED_URL}&filter=console`);

    await page.getByRole('button', { name: 'Clear' }).click();
    await expect(filter).toHaveValue('arcade');
    await expect.poll(link).toBe(`#db=${SHARED_URL}`);

    await filter.fill('');
    await expect(page.getByText(/^Showing the full database: \d+ files/)).toBeVisible();
    await expect(heading('console.rbf')).toBeVisible();
    await expect.poll(link).toBe(`#db=${SHARED_URL}&filter=`);
    await page.getByRole('button', { name: 'Clear' }).click();
    await expect(filter).toHaveValue('arcade');
  });

  await test.step('the detailed toggle shows details and keeps the choice in the link', async () => {
    const toggle = page.locator('.overview-controls').getByRole('button', { name: 'Detailed toggle' });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(link).toBe(`#db=${SHARED_URL}&detailed`);
    await expect(page.locator('.tree-entry', { has: heading('arcade.rbf') }).getByText('MD5 HASH')).toBeVisible();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(link).toBe(`#db=${SHARED_URL}`);
  });

  await test.step('size hints open on click and close when the pointer leaves, and the cluster size changes the estimate', async () => {
    const size = page.locator('.disk-usage-value');
    await size.click();
    await expect(size).toHaveAttribute('data-open', '');
    await page.mouse.move(0, 0);
    await expect(size).not.toHaveAttribute('data-open', '');
    await size.click();
    await expect(size).toHaveAttribute('data-open', '');
    await filter.focus();
    await expect(size).not.toHaveAttribute('data-open', '');
    const before = await size.textContent();
    await page.getByLabel('Cluster size', { exact: true }).selectOption(String(4096));
    await expect(size).not.toHaveText(before);
  });

  await test.step('files the browser can show open in a new tab; binaries only download', async () => {
    const notes = page.locator('.tree-entry', { has: heading('notes.txt') });
    await expect(notes.getByRole('link', { name: 'OPEN' })).toHaveAttribute('href', 'https://example.com/files/notes.txt');
    await expect(notes.getByRole('button', { name: 'Download' })).toBeVisible();
    const binary = page.locator('.tree-entry', { has: heading('essential.rbf') });
    await expect(binary.getByRole('link', { name: 'OPEN' })).toHaveCount(0);
  });

  await test.step('the essential hint searches the page, highlighting every match and flashing the tree row it jumps to', async () => {
    await page.locator('#filter-essential-hint').click();
    const findInput = page.getByLabel('Search text');
    await expect(findInput).toHaveValue('essential');
    await expect(page.locator('.find-bar-count')).toHaveText('1 of 2');
    await expect.poll(() => readHighlight(page, 'search-match')).toEqual(['essential']);

    // From here the page's time moves only when the test moves it, so however slowly the page runs,
    // the flash is timed exactly.
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1_000));
    await findInput.press('Enter');
    await expect(page.locator('.find-bar-count')).toHaveText('2 of 2');
    // The jump lands after the next paint, and the row's text takes the highlight: the page's time
    // moves a frame at a time until it does.
    await expect
      .poll(async () => {
        await page.clock.runFor(16);
        return [...new Set(await readHighlightOwners(page, 'search-match'))];
      })
      .toEqual(['row-database:file:cores/essential.rbf']);
    const row = page.locator('[id="row-database:file:cores/essential.rbf"]');
    await expect(row).toHaveClass(/tree-entry-highlighted/);
    await expect.poll(() => readHighlight(page, 'search-match-all-filter')).toEqual(['essential']);

    // Waiting for the jump took at most a few frames, so the flash is still on well before its three
    // seconds end, and over after them.
    await page.clock.runFor(1_400);
    await expect(row).toHaveClass(/tree-entry-highlighted/);
    await page.clock.runFor(2_000);
    await expect(row).not.toHaveClass(/tree-entry-highlighted/);
    // The row's text stays highlighted after its flash.
    await expect.poll(async () => [...new Set(await readHighlightOwners(page, 'search-match'))]).toEqual(['row-database:file:cores/essential.rbf']);
    await page.clock.resume();

    await findInput.press('Escape');
    await expect(page.getByRole('search')).toHaveCount(0);
    await expect.poll(() => readHighlight(page, 'search-match')).toBeNull();
    await expect(page.locator('.tree-entry-highlighted')).toHaveCount(0);

    // Closing search right after a jump leaves nothing behind, not even what the jump does later.
    // Unlike fastForward, runFor also runs the timers those timers start, so the jump's later
    // scrolls end here rather than in the next step.
    await page.locator('#filter-essential-hint').click();
    await findInput.press('Enter');
    await findInput.press('Escape');
    await page.clock.runFor(1_500);
    expect(await readHighlight(page, 'search-match')).toBeNull();
    await expect(page.locator('.tree-entry-highlighted')).toHaveCount(0);
  });

  await test.step('section anchors open their section, and row anchors reopen at their row after a reload', async () => {
    const issues = page.locator('#section-issues');
    await issues.locator('summary').click();
    await expect(issues).not.toHaveAttribute('open');
    await issues.locator('h2').hover();
    await issues.locator('h2 .section-anchor-button').click();
    await expect(issues).toHaveAttribute('open', '');
    expect(link()).toBe(`#db=${SHARED_URL}&at=issues`);
    // The section scrolls into view smoothly, and a row's link icon shows only under the pointer.
    await untilScrollStops(page);

    const consoleRow = page.locator('.tree-entry', { has: heading('essential.rbf') });
    await consoleRow.hover();
    await consoleRow.locator('.copy-link-button').click();
    await expect.poll(link).toBe(`#db=${SHARED_URL}&at=files:cores/essential.rbf`);
    await page.reload();
    await expect(heading('shared_db')).toBeVisible();
    await expect(page.locator('[id="row-database:file:cores/essential.rbf"]')).toBeInViewport();
  });

  await test.step('the explorer shows the SD card one folder at a time, with the archive’s files in their folder, and its own link', async () => {
    // A fresh page: the row anchor above keeps correcting its scroll for a moment after it lands.
    await page.goto('about:blank');
    await page.goto(`/#db=${SHARED_URL}`);
    await expect(heading('shared_db')).toBeVisible();
    const explorer = page.getByRole('dialog', { name: 'Explorer' });
    const entry = (name) => explorer.getByRole('option', { name: new RegExp(`^${name.replaceAll('.', '\\.')},`) });
    const shown = explorer.locator('.explorer-crumb-current');
    const open = page.locator('#section-files').getByRole('button', { name: 'Explorer' });
    await open.scrollIntoViewIfNeeded();
    await untilScrollStops(page);
    const scrollY = await page.evaluate(() => window.scrollY);

    await open.click();
    await expect(explorer).toBeVisible();
    expect(link()).toBe(`#db=${SHARED_URL}&at=explorer`);

    // With the page's time in the test's hands: a double click goes in, and the details never come
    // up; a click selects at once, and shows the details once the time of a double click has passed.
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1_000));
    const details = explorer.getByRole('complementary');
    await entry('games').dblclick();
    await expect(shown).toHaveText('games');
    await entry('flows').dblclick();
    await expect(shown).toHaveText('flows');
    await page.clock.runFor(1_000);
    await expect(details).toHaveCount(0);
    await entry('untagged.bin').click();
    await expect(entry('untagged.bin')).toHaveAttribute('aria-selected', 'true');
    await page.clock.runFor(250);
    await expect(details).toHaveCount(0);
    await page.clock.runFor(50);
    await expect(explorer.getByRole('complementary', { name: 'Details of untagged.bin' })).toContainText('Archive flows_archive');
    await page.clock.resume();
    await expect.poll(link).toBe(`#db=${SHARED_URL}&at=explorer:games/flows/untagged.bin`);

    // Alt+← goes back a folder, not back a page; the details show the folder that leads back.
    await page.keyboard.press('Alt+ArrowLeft');
    await expect(shown).toHaveText('games');
    await expect(entry('flows')).toHaveAttribute('aria-selected', 'true');
    await expect.poll(link).toBe(`#db=${SHARED_URL}&at=explorer:games`);
    await explorer.getByRole('button', { name: 'Forward' }).click();
    await expect(shown).toHaveText('flows');
    await explorer.getByRole('button', { name: 'Up to games' }).click();
    await expect(shown).toHaveText('games');

    // The page behind does not scroll under the explorer, and closing takes the explorer out of the
    // link and leaves the page where it was.
    await page.mouse.move(4, 400);
    await page.mouse.wheel(0, 400);
    await afterTwoFrames(page);
    await explorer.getByRole('button', { name: 'Close explorer' }).click();
    await expect(explorer).toHaveCount(0);
    await expect.poll(link).toBe(`#db=${SHARED_URL}`);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);
    await expect(open).toBeFocused();

    // A link to a file opens its folder with its details.
    await page.goto('about:blank');
    await page.goto(`/#db=${SHARED_URL}&at=explorer:games/flows/untagged.bin`);
    await expect(explorer.getByRole('complementary', { name: 'Details of untagged.bin' })).toBeVisible();
    await expect(entry('untagged.bin')).toHaveAttribute('aria-selected', 'true');

    // The explorer shows icons; the list, once chosen, is remembered across a reload.
    await expect(explorer.locator('.explorer-tile')).toHaveCount(1);
    await explorer.getByRole('button', { name: 'Show as list' }).click();
    await expect(explorer.locator('.explorer-row')).toHaveCount(1);
    await page.reload();
    await expect(explorer.locator('.explorer-row')).toHaveCount(1);
    await explorer.getByRole('button', { name: 'Show as icons' }).click();
    await expect(explorer.locator('.explorer-tile')).toHaveCount(1);

    // Escape closes the details, then the explorer.
    await page.keyboard.press('Escape');
    await expect(explorer.getByRole('complementary')).toHaveCount(0);
    await expect.poll(link).toBe(`#db=${SHARED_URL}&at=explorer:games/flows`);
    await page.keyboard.press('Escape');
    await expect(explorer).toHaveCount(0);
    await expect.poll(link).toBe(`#db=${SHARED_URL}`);
  });

  await test.step('back and forward reopen the databases opened before', async () => {
    await page.getByLabel('URL').fill(SECOND_URL);
    await page.getByRole('button', { name: 'Fetch database' }).click();
    await page.getByRole('dialog', { name: 'Combine with the loaded databases?' }).getByRole('button', { name: 'Load alone' }).click();
    await expect(heading('second_db')).toBeVisible();

    await page.goBack();
    await expect(heading('shared_db')).toBeVisible();
    await expect(page.getByLabel('URL')).toHaveValue(SHARED_URL);
    await page.goForward();
    await expect(heading('second_db')).toBeVisible();
    await expect(page.getByLabel('URL')).toHaveValue(SECOND_URL);
  });

  await test.step('a link typed in the address bar of the open page opens there', async () => {
    await page.evaluate(() => {
      window.notReloaded = true;
    });
    await page.goto(`/#db=${SHARED_URL}&filter=console`);
    await expect(heading('shared_db')).toBeVisible();
    await expect(filter).toHaveValue('console');
    await expect(heading('arcade.rbf')).toHaveCount(0);
    expect(await page.evaluate(() => window.notReloaded)).toBe(true);
  });

  await test.step('the theme menu in the top corner: a chosen theme stays across a reload and the system\u2019s switches, and Match system follows the system', async () => {
    const theme = () => page.evaluate(() => document.documentElement.dataset.theme);
    const pageColor = () => page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
    const chooseTheme = async (current, choice) => {
      await page.getByRole('button', { name: `Theme: ${current}` }).click();
      await page.getByRole('menu', { name: 'Theme' }).getByRole('menuitemradio', { name: choice }).click();
    };
    const systemIsDark = () => page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches);
    expect(await theme()).toBe('light');
    expect(await pageColor()).toBe('rgb(220, 220, 229)');

    await chooseTheme('Match system', 'Dark');
    await expect.poll(theme).toBe('dark');
    await expect.poll(pageColor).toBe('rgb(18, 15, 38)');
    await page.reload();
    await expect(heading('shared_db')).toBeVisible();
    expect(await theme()).toBe('dark');
    // The system switching, by hand or on a schedule, leaves a chosen theme alone.
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(systemIsDark).toBe(true);
    await page.emulateMedia({ colorScheme: 'light' });
    await expect.poll(systemIsDark).toBe(false);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(await theme()).toBe('dark');

    // Match system follows the system again, from the first draw and while the page is open.
    await chooseTheme('Dark', 'Match system');
    await expect.poll(theme).toBe('light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(theme).toBe('dark');
    await page.reload();
    await expect(heading('shared_db')).toBeVisible();
    expect(await theme()).toBe('dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect.poll(theme).toBe('light');
    await expect.poll(pageColor).toBe('rgb(220, 220, 229)');

    // The hidden themes, picked only by a value written by hand, draw with their own colors.
    for (const [hidden, name, color] of [
      ['classic', 'Classic', 'rgb(237, 230, 212)'],
      ['dot-matrix', 'Dot Matrix', 'rgb(211, 207, 199)'],
      ['phosphor', 'Phosphor', 'rgb(20, 17, 13)'],
    ]) {
      await page.evaluate((value) => localStorage.setItem('inspector-theme', value), hidden);
      await page.reload();
      await expect(heading('shared_db')).toBeVisible();
      expect(await theme()).toBe(hidden);
      expect(await pageColor()).toBe(color);
      await expect(page.getByRole('button', { name: `Theme: ${name}` })).toBeVisible();
    }
    await chooseTheme('Phosphor', 'Match system');
    await expect.poll(theme).toBe('light');
  });
});

// Waits until the page stops scrolling: its scroll position holds for ten frames.
async function untilScrollStops(page) {
  await page.evaluate(async () => {
    let last = window.scrollY;
    for (let still = 0, frames = 0; still < 10 && frames < 600; frames += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      still = window.scrollY === last ? still + 1 : 0;
      last = window.scrollY;
    }
  });
}

function readHighlight(page, name) {
  return page.evaluate((highlightName) => {
    const highlight = CSS.highlights.get(highlightName);
    return highlight ? [...highlight].map((range) => range.toString()) : null;
  }, name);
}

function readHighlightOwners(page, name) {
  return page.evaluate((highlightName) => {
    const highlight = CSS.highlights.get(highlightName);
    return highlight ? [...highlight].map((range) => range.startContainer.parentElement?.closest('[id]')?.id ?? null) : [];
  }, name);
}

// Resolves once the page has drawn two more frames, so what it was doing has reached the screen.
function afterTwoFrames(page) {
  return page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
