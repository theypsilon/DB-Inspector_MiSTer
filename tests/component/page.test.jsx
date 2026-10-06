import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import App from '../../src/App.jsx';
import { SEARCH_FLASH_MS } from '../../src/lib/rowFlash.js';
import { NARROW_SCREEN_QUERY, PHONE_SCREEN_QUERY } from '../../src/lib/utils.js';
import { text } from './support.js';

// The whole page in jsdom, with fetch answered from `routes`: how it is wired to the app model.
// jsdom has no layout, so this checks what the page asks for (renders, questions, scrolls,
// addresses), not where things land; the journeys check that in a browser.

const RUNTIME_CATALOG_URL = 'https://raw.githubusercontent.com/theypsilon/Update_All_MiSTer/master/src/update_all/databases.py';
const MULTIDATABASES_CATALOG_URL = 'https://raw.githubusercontent.com/theypsilon/MultiDatabases_MiSTer/main/README.md';

const database = (dbId, extra = {}) => ({
  db_id: dbId,
  v: 1,
  timestamp: 1710000000,
  base_files_url: `https://example.com/${dbId}/`,
  tag_dictionary: { essential: 0, arcade: 1 },
  files: {
    'cores/essential.rbf': { size: 1024, hash: 'h1', tags: [0] },
    'cores/arcade.rbf': { size: 2048, hash: 'h2', tags: [1] },
  },
  folders: { 'cores/': {} },
  ...extra,
});

// An archive that installs into a folder of its own, as the explorer shows it.
const EXPLORER_ARCHIVES = {
  archives: {
    flows_archive: {
      description: 'Flows archive',
      format: 'zip',
      extract: 'all',
      target_folder: 'games/flows/',
      archive_file: { url: 'https://example.com/flows.zip', size: 4096, hash: 'ah' },
      summary_inline: { files: { 'games/flows/untagged.bin': { arc_id: 'flows_archive', size: 100, hash: 'u' } }, folders: {} },
    },
  },
};

function serve(routes) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input) => {
      const route = routes[String(input)];
      if (!route) {
        throw new TypeError('Failed to fetch');
      }
      const body = typeof route.body === 'string' ? route.body : JSON.stringify(route.body);
      return new Response(body, { status: route.status ?? 200, headers: { 'content-type': route.contentType ?? 'application/json' } });
    }),
  );
}

// A window as wide as `width` says ('narrow', 960px and narrower, or 'phone'), as matchMedia tells
// the page's screen queries, and tells again when `resize` changes it.
function stubScreen(width) {
  let current = width;
  const listeners = new Map([[NARROW_SCREEN_QUERY, new Set()], [PHONE_SCREEN_QUERY, new Set()]]);
  const matches = (query) => (query === NARROW_SCREEN_QUERY && current !== 'wide') || (query === PHONE_SCREEN_QUERY && current === 'phone');
  vi.stubGlobal('matchMedia', (query) => ({
    media: query,
    get matches() {
      return matches(query);
    },
    addEventListener: (type, listener) => listeners.get(query)?.add(listener),
    removeEventListener: (type, listener) => listeners.get(query)?.delete(listener),
  }));
  return {
    resize(next) {
      act(() => {
        current = next;
        for (const [query, set] of listeners) set.forEach((listener) => listener({ media: query, matches: matches(query) }));
      });
    },
  };
}

// The page as main.jsx renders it: in StrictMode, which mounts it twice and runs its effects twice,
// in development builds only. The journeys run the production build, so this is where it is checked.
function openPage(path, routes) {
  window.history.replaceState(null, '', path);
  serve(routes);
  render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('the page and the app model', () => {
  test('a shared link opens its database with its default FILTER, and FILTER follows into the address', async () => {
    const url = 'https://example.com/rich.json';
    const user = openPage(`/#db=${url}`, { [url]: { body: database('rich_db', { default_options: { filter: 'arcade' } }) } });

    expect(await screen.findByRole('heading', { name: 'rich_db' })).toBeTruthy();
    const filter = screen.getByLabelText('FILTER');
    await waitFor(() => expect(filter.value).toBe('arcade'));

    await user.clear(filter);
    await user.type(filter, 'essential');
    await waitFor(() => expect(window.location.hash).toBe(`#db=${url}&filter=essential`), { timeout: 3000 });

    // Clear brings back the default, which the link leaves out.
    await user.click(within(document.getElementById('section-filter')).getByRole('button', { name: 'Clear' }));
    expect(filter.value).toBe('arcade');
    await waitFor(() => expect(window.location.hash).toBe(`#db=${url}`), { timeout: 3000 });
  });

  test('the rows of a tree draw one outline around the list: each line once, rounded at its outer corners', async () => {
    const url = 'https://example.com/outline.json';
    openPage(`/#db=${url}`, { [url]: { body: database('outline_db') } });
    expect(await screen.findByRole('heading', { name: 'outline_db' })).toBeTruthy();

    const rows = await waitFor(() => {
      const found = [...document.querySelectorAll('.tree-root .tree-entry')];
      expect(found).toHaveLength(3);
      return found;
    });
    const drawn = (row) => ['--tree-row-top-line', '--tree-row-bottom-line', '--tree-row-corners'].map((name) => row.style.getPropertyValue(name));
    expect(rows.map((row) => [row.querySelector('h3').textContent, ...drawn(row)])).toEqual([
      // The folder draws the list's top and the line under it, where its files step in.
      ['cores', '1px', '1px', 'var(--tree-corner-outer) var(--tree-corner-outer) 0px var(--tree-corner-step)'],
      ['arcade.rbf', '0px', '0px', '0px 0px 0px 0px'],
      ['essential.rbf', '1px', '1px', '0px 0px var(--tree-corner-outer) var(--tree-corner-outer)'],
    ]);
    // Each is drawn over its place in the list.
    for (const row of rows) {
      expect(row.style.getPropertyValue('--tree-row-height')).toMatch(/^\d+px$/);
    }
  });

  test('an anchor to a row outside the rendered ones scrolls the page to it', async () => {
    const files = {};
    for (let index = 0; index < 600; index += 1) {
      files[`games/folder_${String(Math.floor(index / 40)).padStart(2, '0')}/file_${String(index).padStart(5, '0')}.rbf`] = { size: 1000 + index, hash: `h${index}` };
    }
    const url = 'https://example.com/large.json';
    const scrolls = vi.spyOn(window, 'scrollTo');
    openPage(`/#db=${url}&at=files:games/folder_14/file_00599.rbf`, {
      [url]: { body: { db_id: 'large_db', v: 1, timestamp: 1, base_files_url: 'https://example.com/', files, folders: {} } },
    });

    expect(await screen.findByRole('heading', { name: 'large_db' })).toBeTruthy();
    await waitFor(() => expect(scrolls.mock.calls.some(([, top]) => top > 1000)).toBe(true), { timeout: 3000 });
  });

  test('opening another database asks first, and Combine combines them', async () => {
    const alpha = 'https://example.com/alpha.json';
    const beta = 'https://example.com/beta.json';
    const user = openPage(`/#db=${alpha}`, { [alpha]: { body: database('alpha') }, [beta]: { body: database('beta') } });
    expect(await screen.findByRole('heading', { name: 'alpha' })).toBeTruthy();

    const urlBox = screen.getByLabelText('URL');
    await user.clear(urlBox);
    await user.type(urlBox, beta);
    await user.click(screen.getByRole('button', { name: 'Fetch database' }));
    // Cancel leaves the loaded database as it was.
    await user.click(within(await screen.findByRole('dialog', { name: 'Combine with the loaded databases?' })).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('heading', { name: 'alpha' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /combined databases/ })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Fetch database' }));
    const question = await screen.findByRole('dialog', { name: 'Combine with the loaded databases?' });
    await user.click(within(question).getByRole('button', { name: 'Combine' }));

    expect(await screen.findByRole('heading', { name: '2 combined databases' })).toBeTruthy();
    await waitFor(() => expect(window.location.hash).toBe(`#db=${alpha}&db=${beta}`));

    // Their shared FILTER filters both, and reaches the link.
    await user.type(screen.getByLabelText('FILTER', { exact: true }), 'arcade');
    await waitFor(() => expect(window.location.hash).toBe(`#db=${alpha}&db=${beta}&filter=arcade`), { timeout: 3000 });
  });

  test('Escape on a db_id question in the catalog closes only the question', async () => {
    const edge = 'https://example.com/edge.json.zip';
    const pinned = 'https://raw.githubusercontent.com/theypsilon/MultiDatabases_MiSTer/db/distribution-mister-pinned-linux/db.json.zip';
    const user = openPage('/', {
      [RUNTIME_CATALOG_URL]: {
        contentType: 'text/plain',
        body: `self.EDGE = Database(db_id='distribution_mister', db_url='${edge}', title='Edge')\nself.PINNED = Database(db_id='distribution_mister', db_url='${pinned}', title='Pinned')\n`,
      },
      [MULTIDATABASES_CATALOG_URL]: {
        contentType: 'text/markdown',
        body: `| [Extra](extra/) | Extra files | [Inspect](https://theypsilon.github.io/DB-Inspector_MiSTer/?database-url=${encodeURIComponent('https://example.com/extra/db.json')}) |\n`,
      },
    });
    expect(await screen.findByText('3 entries available')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Browse catalog' }));
    const catalog = screen.getByRole('dialog', { name: 'Browse database catalog' });
    await user.click(within(catalog).getByRole('checkbox', { name: 'Pinned (distribution_mister)' }));
    await user.click(within(catalog).getByRole('checkbox', { name: 'Edge (distribution_mister)' }));
    expect(screen.getByRole('dialog', { name: 'Replace the selected database?' })).toBeTruthy();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Replace the selected database?' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Browse database catalog' })).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Browse database catalog' })).toBeNull();
  });

  test('the essential hint opens the find bar on it', async () => {
    const url = 'https://example.com/essential.json';
    const user = openPage(`/#db=${url}`, { [url]: { body: database('essential_db') } });
    expect(await screen.findByRole('heading', { name: 'essential_db' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'essential' }));
    const search = await screen.findByRole('search', { name: 'Find in tree' });
    expect(within(search).getByLabelText('Search text').value).toBe('essential');
    await waitFor(() => expect(text(search.querySelector('.find-bar-count'))).toBe('1 of 2'));

    // Enter jumps to the tree's match, whose row flashes until its time is up.
    const timers = vi.spyOn(window, 'setTimeout');
    const row = () => document.getElementById('row-database:file:cores/essential.rbf');
    const flashing = () => [...document.querySelectorAll('.tree-entry-highlighted')].map((element) => element.id);
    await user.keyboard('{Enter}');
    expect(text(search.querySelector('.find-bar-count'))).toBe('2 of 2');
    await waitFor(() => expect(flashing()).toEqual([row().id]));
    const flashEnds = timers.mock.calls.findLast(([, delay]) => delay === SEARCH_FLASH_MS)[0];
    act(() => flashEnds());
    expect(flashing()).toEqual([]);

    // Escape ends a flash, and closing search right after a jump leaves no row flashing.
    await user.keyboard('{Enter}{Enter}');
    await waitFor(() => expect(flashing()).toEqual([row().id]));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('search')).toBeNull();
    expect(flashing()).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'essential' }));
    await user.keyboard('{Enter}{Escape}');
    await act(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(flashing()).toEqual([]);
  });

  test('Escape in the theme menu closes only the menu, and the find bar stays open', async () => {
    const url = 'https://example.com/essential.json';
    const user = openPage(`/#db=${url}`, { [url]: { body: database('essential_db') } });
    expect(await screen.findByRole('heading', { name: 'essential_db' })).toBeTruthy();
    await user.keyboard('{Control>}f{/Control}');
    expect(await screen.findByRole('search', { name: 'Find in tree' })).toBeTruthy();

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await user.click(screen.getByRole('button', { name: 'Theme: Match system' }));
    expect(screen.getByRole('menu', { name: 'Theme' })).toBeTruthy();
    expect(log).toHaveBeenCalledTimes(1);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('search', { name: 'Find in tree' })).toBeTruthy();

    // Outside the menu, Escape closes the find bar as before.
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('search')).toBeNull();
  });

  test('a combined database picked for its own filter gets the filter it had, with the cursor in its box; Escape in the list leaves the find bar open', async () => {
    const alpha = 'https://example.com/own-alpha.json';
    const beta = 'https://example.com/own-beta.json';
    const user = openPage(`/#db=${alpha}&db=${beta}&filter=arcade`, {
      [alpha]: { body: database('alpha') },
      [beta]: { body: database('beta', { default_options: { filter: '!cheats' } }) },
    });
    expect(await screen.findByRole('heading', { name: '2 combined databases' })).toBeTruthy();
    await user.keyboard('{Control>}f{/Control}');
    expect(await screen.findByRole('search', { name: 'Find in tree' })).toBeTruthy();

    const button = screen.getByRole('button', { name: 'Own filter for a database' });
    await user.click(button);
    const list = screen.getByRole('listbox', { name: 'Databases without their own filter' });
    expect(within(list).getAllByRole('option').map(text)).toEqual(['alpha arcade · shared filter', 'beta arcade · shared filter']);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(screen.getByRole('search', { name: 'Find in tree' })).toBeTruthy();

    await user.click(button);
    await user.click(within(screen.getByRole('listbox')).getAllByRole('option')[1]);
    const box = screen.getByLabelText('FILTER for beta');
    expect(box.value).toBe('arcade');
    expect(document.activeElement).toBe(box);
    expect([box.selectionStart, box.selectionEnd]).toEqual([6, 6]);
    await user.keyboard(' !cheats');
    await waitFor(() => expect(window.location.hash).toBe(`#db=${alpha}&db=${beta}&filter=arcade&filter.beta=arcade+!cheats`), { timeout: 3000 });
  });

  test('fetching the loaded database again asks only whether to reload it, and reloading shows its new version', async () => {
    const url = 'https://example.com/reload.json';
    const routes = { [url]: { body: database('reload_db') } };
    const user = openPage(`/#db=${url}`, routes);
    expect(await screen.findByRole('heading', { name: 'reload_db' })).toBeTruthy();
    routes[url] = { body: database('reload_db', { files: { 'cores/new.rbf': { size: 1, hash: 'n1', tags: [1] } } }) };

    await user.click(screen.getByRole('button', { name: 'Fetch database' }));
    const question = await screen.findByRole('dialog', { name: 'Reload the loaded database?' });
    expect(screen.queryByRole('dialog', { name: 'Combine with the loaded databases?' })).toBeNull();
    await user.click(within(question).getByRole('button', { name: 'Reload it' }));

    expect(await screen.findByRole('heading', { name: 'new.rbf' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'arcade.rbf' })).toBeNull();
    expect(screen.queryByRole('heading', { name: /combined databases/ })).toBeNull();
  });

  test('a GitHub release download says why the page cannot open it, with a link to download it', async () => {
    const url = 'https://github.com/giancarloerra/Degauss/releases/latest/download/degauss.json.zip';
    openPage(`/#db=${url}`, {});

    const link = await screen.findByRole('link', { name: 'Download degauss.json.zip' });
    expect(link.getAttribute('href')).toBe(url);
    expect(text(document.querySelector('.status-panel .status.error'))).toContain('GitHub does not let websites read release downloads');
  });

  test('the FILTER help follows what the loaded database holds', async () => {
    const essential = 'https://example.com/essential-help.json';
    const untagged = 'https://example.com/untagged-help.json';
    const user = openPage(`/#db=${essential}`, {
      [essential]: { body: database('essential_help') },
      [untagged]: { body: database('untagged_help', { tag_dictionary: {} }) },
    });
    expect(await screen.findByRole('heading', { name: 'essential_help' })).toBeTruthy();
    const help = () => text(document.querySelector('.filter-panel .helper-copy'));
    expect(help()).toBe(
      'Filter content with terms (a.k.a. tags) like console, arcade, or !cheats. Positive terms keep matching tagged items, negative terms remove them, untagged items remain visible, and essential stays included unless you exclude it. Read the official guide.',
    );

    const urlBox = screen.getByLabelText('URL');
    await user.clear(urlBox);
    await user.type(urlBox, untagged);
    await user.click(screen.getByRole('button', { name: 'Fetch database' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Combine with the loaded databases?' })).getByRole('button', { name: 'Load alone' }));
    expect(await screen.findByRole('heading', { name: 'untagged_help' })).toBeTruthy();
    expect(help()).toBe(
      'Filter content with terms (a.k.a. tags) like console, arcade, or !cheats. Positive terms keep matching tagged items, negative terms remove them, and untagged items remain visible. Read the official guide.',
    );
  });

  test('a FILTER that leaves no archive hides the Archives section', async () => {
    const url = 'https://example.com/archives.json';
    const archives = {
      page_archive: {
        description: 'Page archive',
        format: 'zip',
        extract: 'selective',
        target_folder: 'games/page/',
        archive_file: { url: 'https://example.com/page.zip', size: 4096, hash: 'ah' },
        summary_inline: { files: { 'games/page/untagged.bin': { arc_id: 'page_archive', arc_at: 'untagged.bin', size: 100 } }, folders: {} },
      },
    };
    const user = openPage(`/#db=${url}`, { [url]: { body: database('archives_db', { archives }) } });
    expect(await screen.findByRole('heading', { name: 'archives_db' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Archives' })).toBeTruthy();
    expect(document.querySelector('#section-archives')).not.toBeNull();

    const filter = screen.getByLabelText('FILTER');
    await user.clear(filter);
    await user.type(filter, '!all');
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Archives' })).toBeNull(), { timeout: 3000 });
    expect(document.querySelector('#section-archives')).toBeNull();
    expect(screen.getByRole('heading', { name: 'archives_db' })).toBeTruthy();
  });

  test('detailed in the link shows every row’s details from the start', async () => {
    const url = 'https://example.com/detailed-at-load.json';
    openPage(`/#db=${url}&detailed`, { [url]: { body: database('detailed_at_load') } });
    expect(await screen.findByRole('heading', { name: 'detailed_at_load' })).toBeTruthy();

    expect(screen.getByRole('button', { name: 'Detailed toggle' }).getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => expect(text(document.querySelector('#section-files'))).toContain('MD5 HASH'));
  });

  test('the detailed toggle shows every row’s details and keeps the choice in the address', async () => {
    const url = 'https://example.com/detailed.json';
    const user = openPage(`/#db=${url}`, { [url]: { body: database('detailed_db') } });
    expect(await screen.findByRole('heading', { name: 'detailed_db' })).toBeTruthy();
    expect(window.location.hash).toBe(`#db=${url}`);

    await user.click(screen.getByRole('button', { name: 'Detailed toggle' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Detailed toggle' }).getAttribute('aria-pressed')).toBe('true'));
    expect(window.location.hash).toBe(`#db=${url}&detailed`);
    await waitFor(() => expect(text(document.querySelector('#section-files'))).toContain('MD5 HASH'));

    await user.click(screen.getByRole('button', { name: 'Detailed toggle' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Detailed toggle' }).getAttribute('aria-pressed')).toBe('false'));
    expect(window.location.hash).toBe(`#db=${url}`);
    await waitFor(() => expect(text(document.querySelector('#section-files'))).not.toContain('MD5 HASH'));
  });

  test('a row’s link icon puts it in the address, and showing its details does not', async () => {
    const url = 'https://example.com/row-link.json';
    const user = openPage(`/#db=${url}`, { [url]: { body: database('row_link_db') } });
    expect(await screen.findByRole('heading', { name: 'row_link_db' })).toBeTruthy();
    const row = await waitFor(() => {
      const found = document.getElementById('row-database:file:cores/essential.rbf');
      expect(found).toBeTruthy();
      return found;
    });

    await user.click(within(row).getByRole('button', { name: 'Show details' }));
    expect(window.location.hash).toBe(`#db=${url}`);
    await user.click(row.querySelector('.copy-link-button'));
    expect(window.location.hash).toBe(`#db=${url}&at=files:cores/essential.rbf`);
  });

  test('the cluster size changes the size estimate', async () => {
    const url = 'https://example.com/cluster.json';
    const user = openPage(`/#db=${url}`, { [url]: { body: database('cluster_db') } });
    expect(await screen.findByRole('heading', { name: 'cluster_db' })).toBeTruthy();
    const size = () => text(document.querySelector('.disk-usage-value'));

    const before = size();
    await user.selectOptions(screen.getByLabelText('Cluster size'), '4096');
    expect(size()).not.toBe(before);
  });

  test('the catalog marks the loaded database, and opening, combining and clearing ask about the loaded ones', async () => {
    const [alpha, beta, gamma] = ['alpha', 'beta', 'gamma'].map((dbId) => `https://example.com/${dbId}.json`);
    const user = openPage(`/#db=${alpha}`, {
      [RUNTIME_CATALOG_URL]: {
        contentType: 'text/plain',
        body: ['alpha', 'beta', 'gamma'].map((dbId) => `self.${dbId.toUpperCase()} = Database(db_id='${dbId}', db_url='https://example.com/${dbId}.json', title='${dbId} title')`).join('\n'),
      },
      [MULTIDATABASES_CATALOG_URL]: {
        contentType: 'text/markdown',
        body: `| [Extra](extra/) | Extra files | [Inspect](https://theypsilon.github.io/DB-Inspector_MiSTer/?database-url=${encodeURIComponent('https://example.com/extra/db.json')}) |\n`,
      },
      [alpha]: { body: database('alpha') },
      [beta]: { body: database('beta') },
      [gamma]: { body: database('gamma') },
    });
    expect(await screen.findByRole('heading', { name: 'alpha' })).toBeTruthy();
    expect(await screen.findByText('4 entries available')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Browse catalog' }));
    let catalog = screen.getByRole('dialog', { name: 'Browse database catalog' });
    const option = (title) => [...catalog.querySelectorAll('.catalog-option')].find((element) => text(element).includes(title));
    expect(text(option('alpha title'))).toContain('Loaded');
    await user.click(within(catalog).getByRole('checkbox', { name: 'beta title (beta)' }));
    await user.click(within(catalog).getByRole('checkbox', { name: 'gamma title (gamma)' }));
    await user.click(within(catalog).getByRole('button', { name: 'Open 2 selected databases' }));
    const question = await screen.findByRole('dialog', { name: 'Combine with the loaded databases?' });
    expect(text(question)).toContain('Load the 2 selected databases alone to replace it');
    await user.click(within(question).getByRole('button', { name: 'Combine' }));
    expect(await screen.findByRole('heading', { name: '3 combined databases' })).toBeTruthy();

    await user.click(within(document.querySelector('.overview-header')).getByRole('button', { name: 'Clear databases' }));
    const clear = screen.getByRole('dialog', { name: 'Clear the loaded databases?' });
    expect(text(clear)).toContain('This closes the 3 loaded databases');
    await user.click(within(clear).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('heading', { name: '3 combined databases' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Browse catalog' }));
    catalog = screen.getByRole('dialog', { name: 'Browse database catalog' });
    await user.click(within(catalog).getByRole('button', { name: 'Close', exact: true }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('chosen files offer their databases in a picker, which closes to a panel and opens them', async () => {
    const user = openPage('/', {});
    const upload = (dbId) => new File([JSON.stringify(database(dbId))], `${dbId}.json`, { type: 'application/json' });
    await user.upload(document.getElementById('database-file-input'), [upload('alpha'), upload('beta')]);

    let picker = await screen.findByRole('dialog', { name: 'Choose databases from your files' });
    await user.click(within(picker).getByRole('button', { name: 'Close', exact: true }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('Found 2 databases in 2 files. Choose the ones you want to open.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Browse entries' }));
    picker = screen.getByRole('dialog', { name: 'Choose databases from your files' });
    await user.click(within(picker).getByRole('button', { name: 'Open 2 selected databases' }));
    expect(await screen.findByRole('heading', { name: '2 combined databases' })).toBeTruthy();
  });

  test('a list entry with its own filter asks before replacing FILTER, and each answer does what it says', async () => {
    const other = 'https://example.com/other.json';
    const withFilter = 'https://example.com/with-filter.json';
    const list = 'https://example.com/list.ini';
    const user = openPage(`/#db=${other}`, {
      [other]: { body: database('other_db') },
      [withFilter]: { body: database('with_filter_db') },
      [list]: { contentType: 'text/plain', body: `[MiSTer]\nfilter=ini-list-default\n\n[WithFilter]\ndb_url=${withFilter}\nfilter=arcade [mister]\n\n[Other]\ndb_url=${other}\n` },
    });
    expect(await screen.findByRole('heading', { name: 'other_db' })).toBeTruthy();
    await user.type(screen.getByLabelText('FILTER'), 'manual');
    const urlBox = screen.getByLabelText('URL');
    const fetchList = async () => {
      await user.clear(urlBox);
      await user.type(urlBox, list);
      await user.click(screen.getByRole('button', { name: 'Fetch database' }));
      return screen.findByRole('dialog', { name: 'Choose databases from this list' });
    };
    const openWithFilter = async () => {
      const picker = await fetchList();
      await user.click(within(picker).getByRole('button', { name: 'Select none' }));
      await user.click(within(picker).getByRole('checkbox', { name: 'WithFilter' }));
      await user.click(within(picker).getByRole('button', { name: 'Open selected database' }));
    };

    // Closed, the list's picker leaves a panel that names it.
    await user.click(within(await fetchList()).getByRole('button', { name: 'Close', exact: true }));
    expect(screen.getByText(`${list} contains 2 entries. Choose the ones you want to open.`)).toBeTruthy();

    await openWithFilter();
    await user.click(within(await screen.findByRole('dialog', { name: 'Combine with the loaded databases?' })).getByRole('button', { name: 'Load alone' }));
    let question = await screen.findByRole('dialog', { name: 'Replace the current filter?' });
    await user.click(within(question).getByRole('button', { name: 'Keep current' }));
    expect(await screen.findByRole('heading', { name: 'with_filter_db' })).toBeTruthy();
    expect(screen.getByLabelText('FILTER').value).toBe('manual');

    // The entry is loaded now, so only the FILTER question comes.
    await openWithFilter();
    question = await screen.findByRole('dialog', { name: 'Replace the current filter?' });
    await user.click(within(question).getByRole('button', { name: 'Replace filter' }));
    await waitFor(() => expect(screen.getByLabelText('FILTER').value).toBe('arcade ini-list-default'));
  });

  test('an anchor to an archive of combined databases opens at its row', async () => {
    const alpha = 'https://example.com/anchor-alpha.json';
    const beta = 'https://example.com/anchor-beta.json';
    const archives = {
      cheats: {
        description: 'Cheats',
        format: 'zip',
        extract: 'selective',
        target_folder: 'games/cheats/',
        archive_file: { url: 'https://example.com/cheats.zip', size: 4096, hash: 'ah' },
        summary_inline: { files: { 'games/cheats/a.bin': { arc_id: 'cheats', arc_at: 'a.bin', size: 1 } }, folders: {} },
      },
    };
    // Rows are below the window, so the page scrolls to the anchored one.
    const scrolledTo = [];
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ top: 5000, bottom: 5040, left: 0, right: 0, width: 0, height: 40, x: 0, y: 5000 });
    vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function scrollIntoView() {
      scrolledTo.push(this.id);
    });
    openPage(`/#db=${alpha}&db=${beta}&at=archives:alpha:cheats`, {
      [alpha]: { body: database('alpha', { archives }) },
      [beta]: { body: database('beta') },
    });

    expect(await screen.findByRole('heading', { name: '2 combined databases' })).toBeTruthy();
    await waitFor(() => expect(scrolledTo).toContain('row-archive[alpha]:cheats'));
  });

  test('a row shows the tags that fit its line, from the list’s hidden sample row, and fits them again when the list’s width changes', async () => {
    // jsdom has no layout, so the sample row's boxes are given as a browser lays them out: a tag of
    // four characters is 10 + 4 * 8 = 42px wide, 5px from the next, and "+3" 10 + 2 * 9 = 28px.
    let lineWidth = 400;
    const parts = {
      line: () => [0, lineWidth],
      indent: () => [0, 20],
      'empty-chip': () => [0, 10],
      'sample-chip': () => [15, 10 + 10 * 8],
      'empty-toggle': () => [0, 10],
      'sample-toggle': () => [0, 10 + 10 * 9],
    };
    const getBoundingClientRect = Element.prototype.getBoundingClientRect;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function boxOf() {
      const part = parts[this.dataset?.tagFit];
      if (!part) {
        return getBoundingClientRect.call(this);
      }
      const [left, width] = part();
      return { left, right: left + width, width, top: 0, bottom: 0, height: 0, x: left, y: 0 };
    });
    // The page's resize observers, to tell the sample row its width changed.
    const observers = [];
    vi.stubGlobal(
      'ResizeObserver',
      class ResizeObserver {
        constructor(callback) {
          Object.assign(this, { callback, targets: [] });
          observers.push(this);
        }
        observe(target) {
          this.targets.push(target);
        }
        unobserve() {}
        disconnect() {
          this.targets = [];
        }
      },
    );

    const url = 'https://example.com/fit.json';
    const names = ['aaaa', 'bbbb', 'cccc', 'dddd', 'eeee', 'ffff', 'gggg', 'hhhh', 'iiii', 'jjjj'];
    const tag_dictionary = Object.fromEntries(names.map((name, index) => [name, index]));
    const files = { 'cores/many.rbf': { size: 1, hash: 'm', tags: names.map((_, index) => index) } };
    openPage(`/#db=${url}`, { [url]: { body: database('fit_db', { tag_dictionary, files }) } });
    expect(await screen.findByRole('heading', { name: 'fit_db' })).toBeTruthy();
    const row = () => document.querySelector('[id="row-database:file:cores/many.rbf"]');
    const chips = () => [...row().querySelectorAll('.tag-chip')].map((chip) => chip.firstChild.textContent);
    await waitFor(() => expect(row()).not.toBeNull());

    // The file is one level deep: 400 - 20 - 2 = 378px, where seven tags and "+3" take 357px.
    expect(chips()).toEqual(names.slice(0, 7));
    expect(within(row()).getByRole('button', { name: '+3 more tags' })).toBeTruthy();
    // The sample row is not a row, and hidden from screen readers.
    const probe = document.querySelector('.tree-root > .tag-fit-probe');
    expect(probe.getAttribute('aria-hidden')).toBe('true');
    expect(probe.classList.contains('tree-entry')).toBe(false);

    // 250 - 20 - 2 = 228px: four tags and "+6" take 216px.
    lineWidth = 250;
    const sampleObserver = observers.find((observer) => observer.targets.some((target) => target.dataset?.tagFit === 'line'));
    act(() => sampleObserver.callback([]));
    expect(chips()).toEqual(names.slice(0, 4));
    expect(within(row()).getByRole('button', { name: '+6 more tags' })).toBeTruthy();
  });

  test('a row’s other tags show on request, and for a find-in-page match in one of them', async () => {
    const url = 'https://example.com/tags.json';
    const tag_dictionary = Object.fromEntries(['arcade', 'mra', 'console', 'retro', 'alpha', 'beta', 'hidden_gem'].map((name, index) => [name, index]));
    const files = { 'cores/many.rbf': { size: 1, hash: 'm', tags: [0, 1, 2, 3, 4, 5, 6] } };
    const user = openPage(`/#db=${url}`, { [url]: { body: database('tags_db', { tag_dictionary, files }) } });
    expect(await screen.findByRole('heading', { name: 'tags_db' })).toBeTruthy();
    const row = () => document.querySelector('[id="row-database:file:cores/many.rbf"]');
    const chips = () => [...row().querySelectorAll('.tag-chip')].map((chip) => chip.firstChild.textContent);
    await waitFor(() => expect(row()).not.toBeNull());
    expect(chips()).toEqual(['arcade', 'mra', 'console', 'retro']);

    await user.click(within(row()).getByRole('button', { name: '+3 more tags' }));
    expect(chips()).toHaveLength(7);
    await user.click(within(row()).getByRole('button', { name: 'Show fewer' }));
    expect(chips()).toHaveLength(4);

    await user.click(screen.getByRole('button', { name: /to search/ }));
    await user.type(screen.getByLabelText('Search text'), 'hidden_gem');
    await waitFor(() => expect(chips()).toContain('hidden_gem'));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(chips()).toHaveLength(4));
  });

  test('on a narrow screen a file leaves its tags to its details or a find-in-page match in one, a folder keeps its own, and on a wider one they show again', async () => {
    const screenSize = stubScreen('narrow');
    const url = 'https://example.com/narrow.json';
    const tag_dictionary = { arcade: 0, hidden_gem: 1 };
    const user = openPage(`/#db=${url}`, {
      [url]: { body: database('narrow_db', { tag_dictionary, files: { 'cores/game.rbf': { size: 1, hash: 'g', tags: [0, 1] } }, folders: { 'cores/': { tags: [0] } } }) },
    });
    expect(await screen.findByRole('heading', { name: 'narrow_db' })).toBeTruthy();
    const row = (name) => [...document.querySelectorAll('#section-files .tree-entry')].find((entry) => text(entry.querySelector('h3')) === name);
    const chips = (name) => [...row(name).querySelectorAll('.tag-chip')].map((chip) => chip.firstChild.textContent);
    await waitFor(() => expect(row('game.rbf')).toBeTruthy());
    expect(row('game.rbf').querySelector('.primary-row')).toBeNull();
    expect(chips('cores')).toEqual(['arcade']);

    // Rarest first: arcade is the folder's too.
    await user.click(within(row('game.rbf')).getByRole('button', { name: 'Show details' }));
    expect(chips('game.rbf')).toEqual(['hidden_gem', 'arcade']);
    await user.click(within(row('game.rbf')).getByRole('button', { name: 'Hide details' }));
    expect(row('game.rbf').querySelector('.primary-row')).toBeNull();

    await user.click(screen.getByRole('button', { name: /to search/ }));
    await user.type(screen.getByLabelText('Search text'), 'hidden_gem');
    await waitFor(() => expect(chips('game.rbf')).toEqual(['hidden_gem', 'arcade']));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(row('game.rbf').querySelector('.primary-row')).toBeNull());

    screenSize.resize('wide');
    expect(chips('game.rbf')).toEqual(['hidden_gem', 'arcade']);
    expect(chips('cores')).toEqual(['arcade']);
  });

  test('on a phone a row is its name, and a tap on it shows or hides its details, with its links; on a wider screen a click on it does not', async () => {
    const screenSize = stubScreen('phone');
    const url = 'https://example.com/phone.json';
    const user = openPage(`/#db=${url}`, { [url]: { body: database('phone_db') } });
    expect(await screen.findByRole('heading', { name: 'phone_db' })).toBeTruthy();
    const row = () => [...document.querySelectorAll('#section-files .tree-entry')].find((entry) => text(entry.querySelector('h3')) === 'arcade.rbf');
    await waitFor(() => expect(row()).toBeTruthy());
    expect(text(row().querySelector('.tree-title-row'))).toBe('arcade.rbf');
    expect(within(row()).queryByRole('button', { name: 'Download' })).toBeNull();

    await user.click(row().querySelector('h3'));
    expect(within(row()).getByText('MD5 HASH')).toBeTruthy();
    expect(within(row()).getByRole('button', { name: 'Download' })).toBeTruthy();
    expect(text(row().querySelector('.tree-identifier-inline'))).toBe('cores/arcade.rbf');
    await user.click(row().querySelector('h3'));
    expect(within(row()).queryByText('MD5 HASH')).toBeNull();

    // Wider, the row shows what it always did, and a click on its name is just a click.
    screenSize.resize('narrow');
    expect(within(row()).getByRole('button', { name: 'Download' })).toBeTruthy();
    await user.click(row().querySelector('h3'));
    expect(within(row()).queryByText('MD5 HASH')).toBeNull();
  });

  test('the top of the page shows the project’s repository, and folds to its title once a database is loaded', async () => {
    const url = 'https://example.com/hero.json';
    const user = openPage('/', { [url]: { body: database('hero_db') } });
    const hero = document.querySelector('.hero');
    expect(hero.classList.contains('hero-compact')).toBe(false);
    expect(hero.querySelectorAll('.hero-fold[inert]')).toHaveLength(0);
    expect(within(hero).getByRole('link', { name: 'theypsilon/DB-Inspector_MiSTer' }).getAttribute('href')).toBe(
      'https://github.com/theypsilon/DB-Inspector_MiSTer',
    );
    expect(within(hero).getByText('About MiSTer Downloader')).toBeTruthy();

    await user.type(screen.getByLabelText('URL'), url);
    await user.click(screen.getByRole('button', { name: 'Fetch database' }));
    expect(await screen.findByRole('heading', { name: 'hero_db' })).toBeTruthy();
    expect(hero.classList.contains('hero-compact')).toBe(true);
    // Everything but the title folds away, and cannot be reached.
    expect(hero.querySelectorAll('.hero-fold[inert]')).toHaveLength(3);
    expect(screen.getByRole('heading', { level: 1, name: 'Custom Database Inspector' }).closest('.hero-fold')).toBeNull();
  });

  test('a link that names a database opens with the top of the page folded', async () => {
    const url = 'https://example.com/folded.json';
    openPage(`/#db=${url}`, { [url]: { body: database('folded_db') } });
    expect(document.querySelector('.hero').classList.contains('hero-compact')).toBe(true);
    expect(await screen.findByRole('heading', { name: 'folded_db' })).toBeTruthy();
  });

  test('an old link opens its database, and the address becomes its link', async () => {
    const url = 'https://example.com/old-link.json';
    openPage(`/?database-url=${encodeURIComponent(url)}&filter=arcade`, { [url]: { body: database('old_link_db') } });
    expect(await screen.findByRole('heading', { name: 'old_link_db' })).toBeTruthy();

    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe(`#db=${url}`);
    expect(screen.getByLabelText('FILTER').value).toBe('');
  });

  test('the install dialog has its own link, which opens it, and closing the dialog takes it out of the link', async () => {
    const url = 'https://example.com/install.json';
    const user = openPage(`/#db=${url}&filter=arcade&at=install`, { [url]: { body: database('install_db') } });
    const dialog = await screen.findByRole('dialog', { name: 'Install \u201Cinstall_db\u201D on MiSTer' });

    await user.click(within(dialog).getByRole('button', { name: 'Copy install link to clipboard' }));
    expect(await navigator.clipboard.readText()).toBe(`${window.location.origin}/#db=${url}&filter=arcade&at=install`);

    await user.click(document.querySelector('.modal-overlay'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.location.hash).toBe(`#db=${url}&filter=arcade`);

    await user.click(screen.getByRole('button', { name: 'Install' }));
    expect(await screen.findByRole('dialog', { name: 'Install \u201Cinstall_db\u201D on MiSTer' })).toBeTruthy();
    expect(window.location.hash).toBe(`#db=${url}&filter=arcade&at=install`);
  });
  test('a tree row’s VIEW shows its image over the page, and closing it gives the focus back; a find bar left open steps aside for it, and Escape closes the image', async () => {
    const url = 'https://example.com/view.json';
    const user = openPage(`/#db=${url}`, { [url]: { body: database('view_db', { files: { 'docs/cover.png': { size: 1, hash: 'c' } }, folders: {} }) } });
    expect(await screen.findByRole('heading', { name: 'view_db' })).toBeTruthy();

    const row = within(document.getElementById('section-files')).getByRole('heading', { name: 'cover.png' }).closest('.tree-entry');
    const view = within(row).getByRole('button', { name: 'VIEW' });
    expect(row.querySelector('img')).toBeNull();
    await user.click(view);
    const dialog = screen.getByRole('dialog', { name: 'cover.png' });
    expect(within(dialog).getByRole('img', { name: 'Preview of cover.png' }).getAttribute('src')).toBe('https://example.com/view_db/docs/cover.png');
    expect(window.location.hash).toBe(`#db=${url}`);
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(view);
    // Escape closes it too, and gives the focus back as well.
    await user.click(view);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(view);

    // A find bar left open steps aside for it, and Escape closes the image, not the find bar.
    await user.keyboard('{Control>}f{/Control}');
    expect(await screen.findByRole('search', { name: 'Find in tree' })).toBeTruthy();
    await user.click(view);
    expect(screen.getByRole('dialog', { name: 'cover.png' })).toBeTruthy();
    expect(screen.queryByRole('search')).toBeNull();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('search', { name: 'Find in tree' })).toBeTruthy();
  });

  test('install_all() in the console opens the install dialog of every loaded database over the explorer, puts it in the link, and closing takes it out', async () => {
    const [alpha, beta] = ['https://example.com/install-alpha.json', 'https://example.com/install-beta.json'];
    const user = openPage(`/#db=${alpha}&db=${beta}&filter=arcade`, { [alpha]: { body: database('alpha') }, [beta]: { body: database('beta') } });
    expect(await screen.findByRole('heading', { name: '2 combined databases' })).toBeTruthy();
    await user.click(within(document.getElementById('section-files')).getByRole('button', { name: 'Explorer' }));
    expect(screen.getByRole('dialog', { name: 'Explorer' })).toBeTruthy();

    act(() => window.install_all());
    const dialog = screen.getByRole('dialog', { name: 'Install all loaded databases on MiSTer' });
    expect(screen.queryByRole('dialog', { name: 'Explorer' })).toBeNull();
    expect(window.location.hash).toBe(`#db=${alpha}&db=${beta}&filter=arcade&at=install-all`);
    await user.click(within(dialog).getByLabelText('Include the current filters in the INI file'));
    expect(within(dialog).getByRole('figure', { name: 'downloader.ini' }).querySelector('pre').textContent).toBe(
      `[mister]\nfilter=arcade\n\n[alpha]\ndb_url=${alpha}\n\n[beta]\ndb_url=${beta}\n`,
    );

    await user.click(document.querySelector('.modal-overlay'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.location.hash).toBe(`#db=${alpha}&db=${beta}&filter=arcade`);
  });

  test('a link to the install dialog of every loaded database opens it; with nothing loaded, install_all() says so', async () => {
    const url = 'https://example.com/install-all.json';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    openPage(`/#db=${url}&at=install-all`, { [url]: { body: database('install_db') } });
    const dialog = await screen.findByRole('dialog', { name: 'Install all loaded databases on MiSTer' });
    expect(within(dialog).getByRole('figure', { name: 'downloader.ini' }).querySelector('pre').textContent).toBe(`[install_db]\ndb_url=${url}\n`);
    cleanup();

    openPage('/', {});
    act(() => window.install_all());
    expect(warn).toHaveBeenCalledWith('install_all(): no databases are loaded. Open some first.');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.location.hash).toBe('');
  });

  test('the Explorer buttons of Files and folders and of Archives open the SD card, with archive files in their folders, and it opens again where it was left', async () => {
    const url = 'https://example.com/explorer.json';
    const user = openPage(`/#db=${url}`, { [url]: { body: database('explorer_db', EXPLORER_ARCHIVES) } });
    expect(await screen.findByRole('heading', { name: 'explorer_db' })).toBeTruthy();
    const filesButton = within(document.getElementById('section-files')).getByRole('button', { name: 'Explorer' });
    const archivesButton = within(document.getElementById('section-archives')).getByRole('button', { name: 'Explorer' });

    await user.click(filesButton);
    const dialog = screen.getByRole('dialog', { name: 'Explorer' });
    expect(window.location.hash).toBe(`#db=${url}&at=explorer`);
    const entries = () => within(screen.getByRole('dialog')).getAllByRole('option').map((entry) => entry.getAttribute('aria-label'));
    expect(entries()).toEqual(['cores, folder, 3.0 KB', 'games, folder, 100 B']);
    await user.dblClick(within(dialog).getByRole('option', { name: 'games, folder, 100 B' }));
    await user.dblClick(within(dialog).getByRole('option', { name: 'flows, folder, 100 B' }));
    // The archive's file, where it installs.
    expect(entries()).toEqual(['untagged.bin, file, 100 B']);
    expect(window.location.hash).toBe(`#db=${url}&at=explorer:games/flows`);

    // Closing takes it out of the link, and gives the focus back to the button that opened it.
    await user.click(within(dialog).getByRole('button', { name: 'Close explorer' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.location.hash).toBe(`#db=${url}`);
    expect(document.activeElement).toBe(filesButton);

    await user.click(archivesButton);
    expect(entries()).toEqual(['untagged.bin, file, 100 B']);
    expect(window.location.hash).toBe(`#db=${url}&at=explorer:games/flows`);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(archivesButton);
  });

  test('a link opens the explorer on a file’s details, and find-in-page stands aside while the explorer is open', async () => {
    const url = 'https://example.com/explorer-link.json';
    const user = openPage(`/#db=${url}&at=explorer:games/flows/untagged.bin`, { [url]: { body: database('explorer_link_db', EXPLORER_ARCHIVES) } });
    const dialog = await screen.findByRole('dialog', { name: 'Explorer' });
    const details = within(dialog).getByRole('complementary', { name: 'Details of untagged.bin' });
    expect(text(details.querySelector('.explorer-origins'))).toBe('Archive flows_archive');
    expect(within(dialog).getByRole('option', { name: 'untagged.bin, file, 100 B' }).getAttribute('aria-selected')).toBe('true');

    // Ctrl+F is the browser's own while the explorer covers the page.
    await user.keyboard('{Control>}f{/Control}');
    expect(screen.queryByRole('search')).toBeNull();
    await user.keyboard('{Escape}{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.location.hash).toBe(`#db=${url}`);

    // A find bar left open steps aside for the explorer, whose Escape is its own.
    await user.keyboard('{Control>}f{/Control}');
    expect(await screen.findByRole('search', { name: 'Find in tree' })).toBeTruthy();
    await user.click(within(document.getElementById('section-files')).getByRole('button', { name: 'Explorer' }));
    expect(screen.queryByRole('search')).toBeNull();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('search', { name: 'Find in tree' })).toBeTruthy();
  });
  test('the terms open from beside FILTER, in the link too, and keeping one writes FILTER and the link; the page no longer lists them', async () => {
    const url = 'https://example.com/terms.json';
    const user = openPage(`/#db=${url}`, { [url]: { body: database('terms_db') } });
    expect(await screen.findByRole('heading', { name: 'terms_db' })).toBeTruthy();
    // The section that listed the terms at the bottom of the page is gone.
    expect(document.getElementById('section-tags')).toBeNull();

    await user.click(within(document.getElementById('section-filter')).getByRole('button', { name: 'Terms' }));
    const dialog = screen.getByRole('dialog', { name: 'Filter terms' });
    expect(window.location.hash).toBe(`#db=${url}&at=terms`);
    expect(text(dialog.querySelector('.helper-copy'))).toBe("Keep or exclude terms_db's terms in FILTER. Choosing a term again takes it out.");
    expect([...dialog.querySelectorAll('.filter-term strong')].map(text)).toEqual(['arcade', 'essential']);
    await user.click(within(dialog).getByRole('button', { name: 'Keep arcade' }));
    expect(screen.getByLabelText('FILTER').value).toBe('arcade');
    await waitFor(() => expect(window.location.hash).toBe(`#db=${url}&filter=arcade&at=terms`), { timeout: 3000 });
    // Find-in-page stands aside while the terms cover the page.
    await user.keyboard('{Control>}f{/Control}');
    expect(screen.queryByRole('search')).toBeNull();

    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.location.hash).toBe(`#db=${url}&filter=arcade`);
  });

  test('a link to the terms opens them', async () => {
    const url = 'https://example.com/terms-anchor.json';
    openPage(`/#db=${url}&at=terms`, { [url]: { body: database('terms_anchor_db') } });
    const dialog = await screen.findByRole('dialog', { name: 'Filter terms' });
    expect(text(dialog.querySelector('.helper-copy'))).toBe("Keep or exclude terms_anchor_db's terms in FILTER. Choosing a term again takes it out.");
    expect(screen.getByLabelText('Search terms').value).toBe('');
    expect(window.location.hash).toBe(`#db=${url}&at=terms`);
  });

  test('the terms’ search is in the link: a link opens them with it, and what is typed reaches the link once typing pauses', async () => {
    const url = 'https://example.com/terms-search.json';
    const user = openPage(`/#db=${url}&at=terms?ess`, { [url]: { body: database('terms_search_db') } });
    const dialog = await screen.findByRole('dialog', { name: 'Filter terms' });
    const search = screen.getByLabelText('Search terms');
    expect(search.value).toBe('ess');
    expect([...dialog.querySelectorAll('.filter-term strong')].map(text)).toEqual(['essential']);
    expect(window.location.hash).toBe(`#db=${url}&at=terms?ess`);

    await user.clear(search);
    await user.type(search, 'arcade games');
    await waitFor(() => expect(window.location.hash).toBe(`#db=${url}&at=terms?arcade+games`), { timeout: 3000 });
    // Keeping a term keeps the search where it is.
    await user.clear(search);
    await user.type(search, 'arc');
    await waitFor(() => expect(window.location.hash).toBe(`#db=${url}&at=terms?arc`), { timeout: 3000 });
    await user.click(within(dialog).getByRole('button', { name: 'Keep arcade' }));
    await waitFor(() => expect(window.location.hash).toBe(`#db=${url}&filter=arcade&at=terms?arc`), { timeout: 3000 });
    // An emptied search leaves just the terms in the link, and closing them takes them out.
    await user.clear(search);
    await waitFor(() => expect(window.location.hash).toBe(`#db=${url}&filter=arcade&at=terms`), { timeout: 3000 });
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.location.hash).toBe(`#db=${url}&filter=arcade`);
  });

  test('going back to another database’s terms opens them with the search its link has', async () => {
    const first = 'https://example.com/terms-first.json';
    const second = 'https://example.com/terms-second.json';
    openPage(`/#db=${first}&at=terms?ess`, { [first]: { body: database('terms_first_db') }, [second]: { body: database('terms_second_db') } });
    await screen.findByRole('dialog', { name: 'Filter terms' });
    expect(screen.getByLabelText('Search terms').value).toBe('ess');

    window.history.pushState(null, '', `/#db=${second}&at=terms?arc`);
    window.dispatchEvent(new PopStateEvent('popstate'));
    // The second database's terms, opened afresh as the link says.
    await waitFor(() => expect(screen.getByLabelText('Search terms').value).toBe('arc'));
    expect(text(document.querySelector('.filter-terms-panel .helper-copy'))).toContain('terms_second_db');
    expect([...document.querySelectorAll('.filter-term strong')].map(text)).toEqual(['arcade']);
    expect(window.location.hash).toBe(`#db=${second}&at=terms?arc`);
  });

  test('a link to the section the terms were in opens them, as their own link, and closing them takes them out of the link', async () => {
    const url = 'https://example.com/terms-link.json';
    const user = openPage(`/#db=${url}&at=tags`, { [url]: { body: database('terms_link_db') } });
    expect(await screen.findByRole('dialog', { name: 'Filter terms' })).toBeTruthy();
    expect(window.location.hash).toBe(`#db=${url}&at=terms`);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.location.hash).toBe(`#db=${url}`);
  });

  test('combined databases: the shared filter’s terms are all of theirs, and a database’s own filter has its own', async () => {
    const alpha = 'https://example.com/terms-alpha.json';
    const beta = 'https://example.com/terms-beta.json';
    const user = openPage(`/#db=${alpha}&db=${beta}&filter.beta=console`, {
      [alpha]: { body: database('alpha', { tag_dictionary: { arcade: 0 }, files: { 'a.rbf': { size: 1, hash: 'a', tags: [0] } } }) },
      [beta]: { body: database('beta', { tag_dictionary: { arcade: 0, console: 1 }, files: { 'b.rbf': { size: 1, hash: 'b', tags: [0] }, 'b.rom': { size: 1, hash: 'c', tags: [1] } } }) },
    });
    expect(await screen.findByRole('heading', { name: '2 combined databases' })).toBeTruthy();
    const filters = document.getElementById('section-filter');

    // The dialog opens with its terms; it counts the loaded files once it is on screen.
    fireEvent.click(within(filters).getByRole('button', { name: 'Terms' }));
    let dialog = screen.getByRole('dialog', { name: 'Filter terms' });
    expect(new URLSearchParams(window.location.hash.slice(1)).get('at')).toBe('terms');
    const lines = (term) => [...term.querySelectorAll('p')].map(text).join(' ');
    expect([...dialog.querySelectorAll('.filter-term-text')].map(lines)).toEqual(['arcade 2 entries alpha beta', 'console 1 entry beta']);
    expect(text(dialog.querySelector('.filter-terms-matches'))).toBe('Counting matches…');
    // Beta's own filter keeps only its console file.
    await waitFor(() => expect(text(dialog.querySelector('.filter-terms-matches'))).toBe('Matches 2 of 3 files'));
    await user.click(within(dialog).getByRole('button', { name: 'Exclude arcade' }));
    expect(screen.getByLabelText('FILTER').value).toBe('!arcade');
    // The count waits for FILTER to settle, then counts every database's files.
    expect(text(dialog.querySelector('.filter-terms-matches'))).toBe('Counting matches…');
    await waitFor(() => expect(text(dialog.querySelector('.filter-terms-matches'))).toBe('Matches 1 of 3 files'), { timeout: 3000 });
    // The shared filter has nothing to include.
    expect(within(dialog).queryByRole('checkbox')).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));

    await user.click(within(filters).getByRole('button', { name: 'Terms for beta' }));
    dialog = screen.getByRole('dialog', { name: 'Filter terms' });
    expect(new URLSearchParams(window.location.hash.slice(1)).get('at')).toBe('terms:beta');
    expect(text(dialog.querySelector('.helper-copy'))).toBe("Keep or exclude beta's terms in its own filter. Choosing a term again takes it out.");
    // Only beta's: its own entries, its own name.
    expect([...dialog.querySelectorAll('.filter-term-text')].map(lines)).toEqual(['arcade 1 entry beta', 'console 1 entry beta']);
    expect(within(dialog).getByRole('button', { name: 'Keep console' }).getAttribute('aria-pressed')).toBe('true');
    await user.click(within(dialog).getByRole('button', { name: 'Keep arcade' }));
    expect(screen.getByLabelText('FILTER for beta').value).toBe('console arcade');
    expect(screen.getByLabelText('FILTER').value).toBe('!arcade');
    await waitFor(() => expect(text(dialog.querySelector('.filter-terms-matches'))).toBe('Matches 2 of 3 files'), { timeout: 3000 });
    // It can include the shared filter, which then applies to beta too: !arcade leaves its console file.
    await user.click(within(dialog).getByRole('checkbox', { name: 'Include the shared filter ([mister]) !arcade' }));
    expect(screen.getByLabelText('FILTER for beta').value).toBe('[mister] console arcade');
    await waitFor(() => expect(text(dialog.querySelector('.filter-terms-matches'))).toBe('Matches 1 of 3 files'), { timeout: 3000 });
  });
  test('a link to a database’s own filter’s terms opens them, while it has one; else the shared filter’s', async () => {
    const alpha = 'https://example.com/terms-own-alpha.json';
    const beta = 'https://example.com/terms-own-beta.json';
    const routes = {
      [alpha]: { body: database('alpha', { tag_dictionary: { arcade: 0 }, files: { 'a.rbf': { size: 1, hash: 'a', tags: [0] } } }) },
      [beta]: { body: database('beta', { tag_dictionary: { console: 0 }, files: { 'b.rom': { size: 1, hash: 'b', tags: [0] } } }) },
    };
    const anchor = () => new URLSearchParams(window.location.hash.slice(1)).get('at');
    const user = openPage(`/#db=${alpha}&db=${beta}&filter.beta=console&at=terms:beta?cons`, routes);
    const dialog = await screen.findByRole('dialog', { name: 'Filter terms' });
    expect(text(dialog.querySelector('.helper-copy'))).toBe("Keep or exclude beta's terms in its own filter. Choosing a term again takes it out.");
    expect(screen.getByLabelText('Search terms').value).toBe('cons');
    expect(anchor()).toBe('terms:beta?cons');
    // What is typed stays with beta's terms.
    await user.type(screen.getByLabelText('Search terms'), 'ole');
    await waitFor(() => expect(anchor()).toBe('terms:beta?console'), { timeout: 3000 });
  });

  test('a link to the terms of a database’s own filter it does not have opens the shared filter’s, and says so', async () => {
    const alpha = 'https://example.com/terms-none-alpha.json';
    const beta = 'https://example.com/terms-none-beta.json';
    openPage(`/#db=${alpha}&db=${beta}&at=terms:alpha?arc`, {
      [alpha]: { body: database('alpha') },
      [beta]: { body: database('beta') },
    });
    const dialog = await screen.findByRole('dialog', { name: 'Filter terms' });
    expect(text(dialog.querySelector('.helper-copy'))).toBe('Keep or exclude the terms of all databases in the filter they share ([mister]). Choosing a term again takes it out.');
    // The search comes along.
    expect(screen.getByLabelText('Search terms').value).toBe('arc');
    expect(new URLSearchParams(window.location.hash.slice(1)).get('at')).toBe('terms?arc');
  });
});
