import { expect, test } from '@playwright/test';

// Two candidate real databases for these scroll tests:
//
//   Small — Update_All_MiSTer metadata DB (8 files, 3 folders):
//     https://raw.githubusercontent.com/theypsilon/Update_All_MiSTer/db/update_all_db.json
//   NOT suitable: far too few rows to produce a scrollable tree; none of the
//   scroll regressions can be triggered.
//
//   Large — Distribution_MiSTer main DB (thousands of files):
//     https://raw.githubusercontent.com/MiSTer-devel/Distribution_MiSTer/main/db.json.zip
//   Required for all four tests:
//   - Tests 1 and 4 need >9 000 px of tree height to reach a meaningful scroll position.
//   - Tests 2 and 3 additionally look for the specific file "riscos.rom" (an ARM RISC OS ROM
//     shipped with the Archimedes core) and the console folder names "Astrocade", "ATARI5200",
//     and "Atari2600", which only exist in the Distribution_MiSTer database.
//   RISCOS_REGION_ESTIMATED_TOP below is also calibrated against this database's tree layout.
//
// Set REAL_SCROLL_URL to the large-DB app URL to run the suite:
//   REAL_SCROLL_URL='http://localhost:5173/?database-url=...' npx playwright test real-db-scroll

const DEFAULT_REAL_SCROLL_URL =
  'http://localhost:5173/?database-url=https%3A%2F%2Fraw.githubusercontent.com%2FMiSTer-devel%2FDistribution_MiSTer%2Fmain%2Fdb.json.zip';
const RISCOS_REGION_ESTIMATED_TOP = 317809 + 1200;

test.describe('real database upward scroll regression', () => {
  test.skip(
    !process.env.REAL_SCROLL_URL,
    `Set REAL_SCROLL_URL to run this live regression, for example: ${DEFAULT_REAL_SCROLL_URL}`,
  );

  test('detailed filesystem wheel-up scrolling does not snap back', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'This regression targets Chrome/Chromium scroll behavior.');

    const url = process.env.REAL_SCROLL_URL || DEFAULT_REAL_SCROLL_URL;

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 120_000,
    });
    await page.waitForSelector('.tree-root', { timeout: 120_000 });

    const filesystemSection = page.locator('details', {
      has: page.getByRole('heading', { name: 'Files and folders' }),
    }).first();

    await filesystemSection.evaluate((element) => {
      const top = element.getBoundingClientRect().top + window.scrollY;
      window.scrollTo(0, Math.max(0, top - 120));
    });
    await page.waitForTimeout(300);

    await page.getByRole('button', { name: 'Detailed toggle' }).click();
    await page.waitForTimeout(500);

    const tree = page.locator('.tree-root').first();
    await tree.evaluate((element) => {
      const top = element.getBoundingClientRect().top + window.scrollY;
      window.scrollTo(0, top + 9000);
    });
    await page.waitForTimeout(800);

    const treeBox = await tree.boundingBox();
    if (!treeBox) {
      throw new Error('Could not resolve the filesystem tree bounding box.');
    }

    await page.mouse.move(treeBox.x + 50, Math.min(treeBox.y + 50, 900));
    const anchorNames = await page
      .locator('.tree-root .tree-entry h3')
      .evaluateAll((elements) =>
        elements
          .map((element) => ({
            name: element.textContent?.trim() ?? '',
            top: element.getBoundingClientRect().top,
          }))
          .filter((item) => item.top >= 0 && item.top < window.innerHeight)
          .slice(0, 3)
          .map((item) => item.name),
      );

    const tracePromise = page.evaluate(async ({ durationMs, anchorNames: visibleAnchors }) => {
      const samples = [];
      const start = performance.now();

      function getAnchorEntry() {
        const rows = Array.from(document.querySelectorAll('.tree-root .tree-entry'));
        for (const name of visibleAnchors) {
          const row = rows.find(
            (candidate) => candidate.querySelector('h3')?.textContent?.trim() === name,
          );
          if (row) {
            return row;
          }
        }

        return null;
      }

      return await new Promise((resolve) => {
        const tick = () => {
          const row = getAnchorEntry();
          samples.push({
            t: Math.round(performance.now() - start),
            y: window.scrollY,
            anchorName: row?.querySelector('h3')?.textContent?.trim() ?? null,
            top: row?.getBoundingClientRect().top ?? null,
            styleTop: row instanceof HTMLElement ? parseFloat(row.style.top || '0') : null,
          });

          if (performance.now() - start >= durationMs) {
            resolve(samples);
            return;
          }

          requestAnimationFrame(tick);
        };

        requestAnimationFrame(tick);
      });
    }, {
      durationMs: 1_400,
      anchorNames,
    });

    for (let index = 0; index < 8; index += 1) {
      await page.mouse.wheel(0, -220);
      await page.waitForTimeout(60);
    }

    const trace = await tracePromise;
    const jumps = [];

    for (let index = 1; index < trace.length; index += 1) {
      const previous = trace[index - 1];
      const sample = trace[index];

      if (
        previous.anchorName == null ||
        previous.anchorName !== sample.anchorName ||
        previous.top == null ||
        sample.top == null
      ) {
        continue;
      }

      const scrollDelta = sample.y - previous.y;
      const topDelta = sample.top - previous.top;
      const layoutDrift = topDelta + scrollDelta;

      if (Math.abs(scrollDelta) <= 2 && Math.abs(layoutDrift) > 40) {
        jumps.push({
          index,
          anchorName: sample.anchorName,
          t: sample.t,
          scrollDelta,
          topDelta,
          layoutDrift,
          styleTopDelta:
            sample.styleTop == null || previous.styleTop == null
              ? null
              : sample.styleTop - previous.styleTop,
        });
      }
    }

    expect(
      jumps,
      `Expected visible rows to stay anchored during upward wheel scrolling. Trace drift: ${JSON.stringify(jumps)}`,
    ).toEqual([]);
  });

  test('detailed filesystem wheel-up scrolling responds promptly after jumping beyond riscos.rom', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'This regression targets Chrome/Chromium scroll behavior.');

    const url = process.env.REAL_SCROLL_URL || DEFAULT_REAL_SCROLL_URL;

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 120_000,
    });
    await page.waitForSelector('.tree-root', { timeout: 120_000 });

    const filesystemSection = page.locator('details', {
      has: page.getByRole('heading', { name: 'Files and folders' }),
    }).first();

    await filesystemSection.evaluate((element) => {
      const top = element.getBoundingClientRect().top + window.scrollY;
      window.scrollTo(0, Math.max(0, top - 120));
    });
    await page.waitForTimeout(300);

    await page.getByRole('button', { name: 'Detailed toggle' }).click();
    await page.waitForTimeout(300);
    await filesystemSection.getByRole('button', { name: /^Open all$/ }).click();
    await page.waitForTimeout(1_200);

    const tree = page.locator('.tree-root').first();
    await tree.evaluate((element, offset) => {
      const top = element.getBoundingClientRect().top + window.scrollY;
      window.scrollTo(0, top + offset);
    }, RISCOS_REGION_ESTIMATED_TOP);
    await page.waitForTimeout(30);

    await expect(page.getByRole('heading', { name: 'riscos.rom' })).toBeVisible();

    const treeBox = await tree.boundingBox();
    if (!treeBox) {
      throw new Error('Could not resolve the filesystem tree bounding box.');
    }

    await page.mouse.move(treeBox.x + 60, Math.min(treeBox.y + 60, 900));

    const deltas = [-80, -140, -260, -120, -320, -90, -220, -160];
    const samples = [];
    for (let index = 0; index < deltas.length; index += 1) {
      const before = await page.evaluate(() => window.scrollY);
      await page.mouse.wheel(0, deltas[index]);
      await page.waitForTimeout(16);
      const after16 = await page.evaluate(() => window.scrollY);
      await page.waitForTimeout(48);
      const after64 = await page.evaluate(() => window.scrollY);
      await page.waitForTimeout(120);
      const after184 = await page.evaluate(() => window.scrollY);
      samples.push({ index, before, after16, after64, after184, delta: deltas[index] });
    }

    for (const sample of samples) {
      expect(
        sample.after64,
        `Expected wheel-up step ${sample.index} to start moving within 64ms after jumping near riscos.rom. Samples: ${JSON.stringify(sample)}`,
      ).toBeLessThan(sample.before - 20);

      expect(
        sample.after184,
        `Expected wheel-up step ${sample.index} to continue moving upward, not stall. Samples: ${JSON.stringify(sample)}`,
      ).toBeLessThan(sample.before - 20);
    }
  });

  test('detailed filesystem wheel-up scrolling does not reposition visible rows after jumping beyond riscos.rom', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'This regression targets Chrome/Chromium scroll behavior.');

    const url = process.env.REAL_SCROLL_URL || DEFAULT_REAL_SCROLL_URL;

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 120_000,
    });
    await page.waitForSelector('.tree-root', { timeout: 120_000 });

    const filesystemSection = page.locator('details', {
      has: page.getByRole('heading', { name: 'Files and folders' }),
    }).first();

    await filesystemSection.evaluate((element) => {
      const top = element.getBoundingClientRect().top + window.scrollY;
      window.scrollTo(0, Math.max(0, top - 120));
    });
    await page.waitForTimeout(300);

    await page.getByRole('button', { name: 'Detailed toggle' }).click();
    await page.waitForTimeout(300);
    await filesystemSection.getByRole('button', { name: /^Open all$/ }).click();
    await page.waitForTimeout(1_200);

    const tree = page.locator('.tree-root').first();
    await tree.evaluate((element, offset) => {
      const top = element.getBoundingClientRect().top + window.scrollY;
      window.scrollTo(0, top + offset);
    }, RISCOS_REGION_ESTIMATED_TOP);
    await page.waitForTimeout(30);

    await expect(page.getByRole('heading', { name: 'riscos.rom' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Astrocade' })).toBeVisible();

    const treeBox = await tree.boundingBox();
    if (!treeBox) {
      throw new Error('Could not resolve the filesystem tree bounding box.');
    }

    await page.mouse.move(treeBox.x + 60, Math.min(treeBox.y + 60, 900));

    const tracePromise = page.evaluate(async ({ durationMs, anchorNames }) => {
      const samples = [];
      const start = performance.now();

      function getAnchorEntry() {
        const rows = Array.from(document.querySelectorAll('.tree-root .tree-entry'));
        for (const name of anchorNames) {
          const row = rows.find(
            (candidate) => candidate.querySelector('h3')?.textContent?.trim() === name,
          );
          if (row) {
            return row;
          }
        }

        return null;
      }

      return await new Promise((resolve) => {
        const tick = () => {
          const row = getAnchorEntry();
          samples.push({
            t: Math.round(performance.now() - start),
            y: window.scrollY,
            anchorName: row?.querySelector('h3')?.textContent?.trim() ?? null,
            top: row?.getBoundingClientRect().top ?? null,
            styleTop: row instanceof HTMLElement ? parseFloat(row.style.top || '0') : null,
          });

          if (performance.now() - start >= durationMs) {
            resolve(samples);
            return;
          }

          requestAnimationFrame(tick);
        };

        requestAnimationFrame(tick);
      });
    }, {
      durationMs: 2_200,
      anchorNames: ['Astrocade', 'ATARI5200', 'Atari2600'],
    });

    const deltas = [-80, -140, -260, -120, -320, -90, -220, -160, -280, -110];
    const waits = [80, 70, 60, 70, 60, 90, 70, 90, 60, 100];

    for (let index = 0; index < deltas.length; index += 1) {
      await page.mouse.wheel(0, deltas[index]);
      await page.waitForTimeout(waits[index]);
    }

    const trace = await tracePromise;
    const jumps = [];

    for (let index = 1; index < trace.length; index += 1) {
      const previous = trace[index - 1];
      const sample = trace[index];

      if (
        previous.anchorName == null ||
        previous.anchorName !== sample.anchorName ||
        previous.top == null ||
        sample.top == null
      ) {
        continue;
      }

      const scrollDelta = sample.y - previous.y;
      const topDelta = sample.top - previous.top;
      const layoutDrift = topDelta + scrollDelta;

      if (Math.abs(scrollDelta) <= 2 && Math.abs(layoutDrift) > 40) {
        jumps.push({
          index,
          anchorName: sample.anchorName,
          t: sample.t,
          scrollDelta,
          topDelta,
          layoutDrift,
          styleTopDelta:
            sample.styleTop == null || previous.styleTop == null
              ? null
              : sample.styleTop - previous.styleTop,
        });
      }
    }

    expect(
      jumps,
      `Expected visible rows to stay anchored after the jump beyond riscos.rom. Trace drift: ${JSON.stringify(jumps)}`,
    ).toEqual([]);
  });

  test('detailed filesystem wheel-down scrolling does not leave deferred visible-row jumps', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'This regression targets Chrome/Chromium scroll behavior.');

    const url = process.env.REAL_SCROLL_URL || DEFAULT_REAL_SCROLL_URL;

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 120_000,
    });
    await page.waitForSelector('.tree-root', { timeout: 120_000 });

    const filesystemSection = page.locator('details', {
      has: page.getByRole('heading', { name: 'Files and folders' }),
    }).first();

    await filesystemSection.evaluate((element) => {
      const top = element.getBoundingClientRect().top + window.scrollY;
      window.scrollTo(0, Math.max(0, top - 120));
    });
    await page.waitForTimeout(300);

    await page.getByRole('button', { name: 'Detailed toggle' }).click();
    await page.waitForTimeout(300);
    await filesystemSection.getByRole('button', { name: /^Open all$/ }).click();
    await page.waitForTimeout(1_200);

    const tree = page.locator('.tree-root').first();
    const treeBox = await tree.boundingBox();
    if (!treeBox) {
      throw new Error('Could not resolve the filesystem tree bounding box.');
    }

    await page.mouse.move(treeBox.x + 60, Math.min(treeBox.y + 60, 900));

    const tracePromise = page.evaluate(async ({ durationMs, visibleLimit }) => {
      const samples = [];
      const start = performance.now();

      return await new Promise((resolve) => {
        const tick = () => {
          const rows = Array.from(document.querySelectorAll('.tree-root .tree-entry'))
            .map((row) => ({
              name: row.querySelector('h3')?.textContent?.trim() ?? '',
              top: row.getBoundingClientRect().top,
              styleTop: row instanceof HTMLElement ? parseFloat(row.style.top || '0') : null,
            }))
            .filter((item) => item.top >= 0 && item.top < window.innerHeight)
            .slice(0, visibleLimit);

          samples.push({
            t: Math.round(performance.now() - start),
            y: window.scrollY,
            rows,
          });

          if (performance.now() - start >= durationMs) {
            resolve(samples);
            return;
          }

          requestAnimationFrame(tick);
        };

        requestAnimationFrame(tick);
      });
    }, {
      durationMs: 2_200,
      visibleLimit: 4,
    });

    const deltas = [220, 220, 220, 220, 220, 220, 220, 220, 220, 220];
    for (const delta of deltas) {
      await page.mouse.wheel(0, delta);
      await page.waitForTimeout(60);
    }

    const trace = await tracePromise;
    const jumps = [];

    for (let index = 1; index < trace.length; index += 1) {
      const previous = trace[index - 1];
      const sample = trace[index];

      for (const previousRow of previous.rows) {
        const nextRow = sample.rows.find((row) => row.name === previousRow.name);
        if (!nextRow) {
          continue;
        }

        const scrollDelta = sample.y - previous.y;
        const topDelta = nextRow.top - previousRow.top;
        const layoutDrift = topDelta + scrollDelta;

        if (Math.abs(scrollDelta) <= 2 && Math.abs(layoutDrift) > 40) {
          jumps.push({
            index,
            name: previousRow.name,
            t: sample.t,
            scrollDelta,
            topDelta,
            layoutDrift,
            styleTopDelta:
              nextRow.styleTop == null || previousRow.styleTop == null
                ? null
                : nextRow.styleTop - previousRow.styleTop,
          });
        }
      }
    }

    expect(
      jumps,
      `Expected downward scrolling not to leave deferred visible-row jumps. Trace drift: ${JSON.stringify(jumps)}`,
    ).toEqual([]);
  });
});
