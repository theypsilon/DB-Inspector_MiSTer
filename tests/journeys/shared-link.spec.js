import { expect, test } from '@playwright/test';

// What only a real browser shows of a database opened from a shared link: find-in-page's
// highlights, with the row a jump flashes; a row anchor scrolling back to its row after a reload;
// the page behind the explorer and the image dialog kept where it was; images loaded, no wider than
// where they show; and each theme's colors. Everything else these pages do (FILTER and the link,
// the detailed toggle, size hints, downloads, the explorer's folders and link, back and forward,
// the theme menu) is checked in the component and unit tests.

const SHARED_URL = 'https://raw.githubusercontent.com/example-owner/example-repo/main/db.json';
const IMAGES_URL = 'https://example.com/images.json';
// A 640×160 PNG, wider than the explorer's details.
const WIDE_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAoAAAACgCAIAAAATnEprAAAC3UlEQVR42u3VAQ0AAAjDMCQhCemXgg5Ik2rYKtPAUT0BjioJAwMGDBgwYDBgwIABAwYMGAwYMGDAgMGAAQMGDBgwYDBgwIABAwYMGAwYMGDAgMGAAQMGDBgwYDBgwIABAwYDBgwYMGDAgMGAAQMGDBgwYDBgwIABAwYDBgwYMGDAgMGAAQMGDBgMGDBgwIABAwYDBgwYMGDAgMGAAQMGDBgMGDBgwIABAwYDBgwYMGAwYMCAAQMGDBgMGDBgwIABAwYDBgwYMGAwYMCAAQMGDBgMGDBgwIDBgFUMDBgwYMCAwYABAwYMGDBgMGDAgAEDBgMGDBgwYMCAwYABAwYMGDBgMGDAgAEDBgMGDBgwYMCAwYABAwYMGAwYMGDAgAEDBgMGDBgwYMCAwYABAwYMGAwYMGDAgAEDBgMGDBgwYDBgwIABAwYMGAwYMGDAgAEDBgMGDBgwYDBgwIABAwYMGAwYMGDAgMGAAQMGDBgwYDBgwIABAwYMGAwYMGDAgMGAAQMGDBgwYDBgwIABAwYDVjEwYMCAAQMGAwYMGDBgwIDBgAEDBgwYDBgwYMCAAQMGAwYMGDBgwIDBgAEDBgwYDBgwYMCAAQMGAwYMGDBgMGDAgAEDBgwYDBgwYMCAAQMGAwYMGDBgMGDAgAEDBgwYDBgwYMCAwYABAwYMGDBgMGDAgAEDBgwYDBgwYMCAwYABAwYMGDBgMGDAgAEDBgMGDBgwYMCAwYABAwYMGDBgMGDAgAEDBgMGDBgwYMCAwYABAwYMGAxYxcCAAQMGDBgMGDBgwIABAwYDBgwYMGAwYMCAAQMGDBgMGDBgwIABAwYDBgwYMGAwYMCAAQMGDBgMGDBgwIDBgAEDBgwYMGAwYMCAAQMGDBgMGDBgwIDBgAEDBgwYMGAwYMCAAQMGAwYMGDBgwIDBgAEDBgwYMGAwYMCAAQMGAwYMGDBgwIDBgAEDBgwYDBgwYMCAAQOG7xaxhiGyLNe5vwAAAABJRU5ErkJggg==';

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
});

test('find-in-page highlights what it finds, and a row anchor scrolls back to its row after a reload', async ({ page }) => {
  // The page clock runs normally, except while the find step stops it to time the row flash.
  await page.clock.install();
  await page.goto(`/#db=${SHARED_URL}`);
  const heading = (name) => page.getByRole('heading', { name, exact: true });
  const link = () => new URL(page.url()).hash;
  await expect(heading('shared_db')).toBeVisible();

  await test.step('the essential hint highlights every match, and the row a jump lands on keeps its text highlighted after its flash', async () => {
    await page.locator('#filter-essential-hint').click();
    const findInput = page.getByLabel('Search text');
    await expect.poll(() => readHighlight(page, 'search-match')).toEqual(['essential']);

    // From here the page's time moves only when the test moves it, so however slowly the page runs,
    // the flash is timed exactly.
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1_000));
    await findInput.press('Enter');
    // The jump lands after the next paint, and the row's text takes the highlight: the page's time
    // moves a frame at a time until it does.
    await expect
      .poll(async () => {
        await page.clock.runFor(16);
        return [...new Set(await readHighlightOwners(page, 'search-match'))];
      })
      .toEqual(['row-database:file:cores/essential.rbf']);
    await expect.poll(() => readHighlight(page, 'search-match-all-filter')).toEqual(['essential']);
    // Past the flash's three seconds, the row's text stays highlighted.
    await page.clock.runFor(3_400);
    await expect.poll(async () => [...new Set(await readHighlightOwners(page, 'search-match'))]).toEqual(['row-database:file:cores/essential.rbf']);
    await page.clock.resume();

    await findInput.press('Escape');
    await expect.poll(() => readHighlight(page, 'search-match')).toBeNull();

    // Closing search right after a jump leaves no highlight, not even after what the jump does later.
    // Unlike fastForward, runFor also runs the timers those timers start, so the jump's later
    // scrolls end here rather than in the next step.
    await page.locator('#filter-essential-hint').click();
    await findInput.press('Enter');
    await findInput.press('Escape');
    await page.clock.runFor(1_500);
    expect(await readHighlight(page, 'search-match')).toBeNull();
  });

  await test.step('a row anchor scrolls back to its row after a reload', async () => {
    // A row's link icon shows only under the pointer.
    const row = page.locator('.tree-entry', { has: heading('essential.rbf') });
    await row.hover();
    await row.locator('.copy-link-button').click();
    await expect.poll(link).toBe(`#db=${SHARED_URL}&at=files:cores/essential.rbf`);
    // At the top of the page, so the browser's own scroll restoration cannot bring the row back.
    await page.evaluate(() => window.scrollTo(0, 0));
    await untilScrollStops(page);
    await page.reload();
    await expect(heading('shared_db')).toBeVisible();
    await expect(page.locator('[id="row-database:file:cores/essential.rbf"]')).toBeInViewport();
  });
});

// The tests below start on a fresh page, so they run beside the one above: a run lasts as long as
// its longest test.
test('images load no wider than where they show, and the page behind the explorer and the image dialog stays where it was', async ({ page }) => {
  const images = {
    db_id: 'images_db',
    v: 1,
    timestamp: 1710000000,
    base_files_url: 'https://example.com/images/',
    files: { 'docs/wide.png': { size: 790, hash: 'w' }, 'docs/broken.png': { size: 1, hash: 'b' } },
    folders: {},
  };
  await page.route(IMAGES_URL, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(images) }));
  await page.route('https://example.com/images/docs/wide.png', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(WIDE_PNG, 'base64') }));
  await page.route('https://example.com/images/docs/broken.png', (route) => route.fulfill({ status: 404, body: '' }));
  await page.goto(`/#db=${IMAGES_URL}&at=explorer:docs/wide.png`);
  const explorer = page.getByRole('dialog', { name: 'Explorer' });
  const viewport = page.viewportSize();

  await test.step('an image in the explorer’s details loads inside them and the screen, in its own proportions, on a wide screen and on a phone', async () => {
    const image = explorer.getByRole('complementary', { name: 'Details of wide.png' }).getByRole('img', { name: 'Preview of wide.png' });
    const fit = () =>
      image.evaluate((img) => {
        const box = img.getBoundingClientRect();
        const details = img.closest('.explorer-details').getBoundingClientRect();
        return [img.naturalWidth, box.left >= details.left && box.right <= details.right && box.right <= window.innerWidth, Math.round(box.width / box.height)];
      });
    await expect(image).toBeVisible();
    expect(await fit()).toEqual([640, true, 4]);
    await page.setViewportSize({ width: 360, height: 800 });
    await expect.poll(fit).toEqual([640, true, 4]);
    await page.setViewportSize(viewport);

    // An image the browser cannot load says so.
    await explorer.getByRole('option', { name: /^broken\.png,/ }).click();
    await expect(explorer.getByRole('complementary', { name: 'Details of broken.png' })).toContainText('The preview could not be loaded.');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(explorer).toHaveCount(0);
  });

  await test.step('the page behind the explorer does not scroll under it, and is where it was once it closes', async () => {
    const open = page.locator('#section-files').getByRole('button', { name: 'Explorer' });
    await open.scrollIntoViewIfNeeded();
    await untilScrollStops(page);
    const scrollY = await page.evaluate(() => window.scrollY);
    await open.click();
    await expect(explorer).toBeVisible();
    await page.mouse.move(4, 400);
    await page.mouse.wheel(0, 400);
    await afterTwoFrames(page);
    await explorer.getByRole('button', { name: 'Close explorer' }).click();
    await expect(explorer).toHaveCount(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);
  });

  await test.step('a tree row’s VIEW shows the image inside its dialog and the screen, leaves the page where it was, and on a phone too', async () => {
    const row = page.locator('#section-files .tree-entry', { has: page.getByRole('heading', { name: 'wide.png', exact: true }) });
    const view = row.getByRole('button', { name: 'VIEW' });
    await view.scrollIntoViewIfNeeded();
    await untilScrollStops(page);
    const scrollY = await page.evaluate(() => window.scrollY);
    const viewer = page.getByRole('dialog', { name: 'wide.png' });
    const shown = viewer.getByRole('img', { name: 'Preview of wide.png' });
    const inside = () =>
      shown.evaluate((img) => {
        const box = img.getBoundingClientRect();
        const panel = img.closest('.modal-panel').getBoundingClientRect();
        return [img.naturalWidth, box.left >= panel.left && box.right <= panel.right && box.bottom <= panel.bottom && box.right <= window.innerWidth];
      });
    await view.click();
    await expect(shown).toBeVisible();
    expect(await inside()).toEqual([640, true]);
    await page.keyboard.press('Escape');
    await expect(viewer).toHaveCount(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);

    // On a phone, a tap on the row's name shows its details, with VIEW.
    await page.setViewportSize({ width: 360, height: 800 });
    await row.locator('h3').click();
    await view.click();
    await expect(shown).toBeVisible();
    await expect.poll(inside).toEqual([640, true]);
    await viewer.getByRole('button', { name: 'Close' }).click();
    await expect(viewer).toHaveCount(0);
    await page.setViewportSize(viewport);
  });
});

test('each theme draws its own colors, the chosen one and the system’s, across reloads', async ({ page }) => {
  const pageColor = () => page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
  const chooseTheme = async (current, choice) => {
    await page.getByRole('button', { name: `Theme: ${current}` }).click();
    await page.getByRole('menu', { name: 'Theme' }).getByRole('menuitemradio', { name: choice }).click();
  };
  const systemIsDark = () => page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches);
  const LIGHT = 'rgb(220, 220, 229)';
  const DARK = 'rgb(18, 15, 38)';
  const reload = async () => {
    await page.reload();
    await expect(page.getByRole('button', { name: /^Theme: / })).toBeVisible();
  };
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Theme: Match system' })).toBeVisible();

  await test.step('a chosen theme draws its colors across a reload and the system’s switches, and Match system follows the system', async () => {
    expect(await pageColor()).toBe(LIGHT);
    await chooseTheme('Match system', 'Dark');
    await expect.poll(pageColor).toBe(DARK);
    await reload();
    expect(await pageColor()).toBe(DARK);
    // The system switching, by hand or on a schedule, leaves a chosen theme alone.
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(systemIsDark).toBe(true);
    await page.emulateMedia({ colorScheme: 'light' });
    await expect.poll(systemIsDark).toBe(false);
    await afterTwoFrames(page);
    expect(await pageColor()).toBe(DARK);

    // Match system follows the system again, from the first draw and while the page is open.
    await chooseTheme('Dark', 'Match system');
    await expect.poll(pageColor).toBe(LIGHT);
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(pageColor).toBe(DARK);
    await reload();
    expect(await pageColor()).toBe(DARK);
    await page.emulateMedia({ colorScheme: 'light' });
    await expect.poll(pageColor).toBe(LIGHT);
  });

  await test.step('the hidden themes, picked only by a value written by hand, draw with their own colors', async () => {
    for (const [hidden, color] of [
      ['classic', 'rgb(237, 230, 212)'],
      ['dot-matrix', 'rgb(211, 207, 199)'],
      ['phosphor', 'rgb(20, 17, 13)'],
    ]) {
      await page.evaluate((value) => localStorage.setItem('inspector-theme', value), hidden);
      await reload();
      expect(await pageColor()).toBe(color);
    }
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
