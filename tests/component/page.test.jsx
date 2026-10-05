import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import App from '../../src/App.jsx';
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

function openPage(path, routes) {
  window.history.replaceState(null, '', path);
  serve(routes);
  render(<App />);
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
    const question = await screen.findByRole('dialog', { name: 'Combine with the loaded databases?' });
    await user.click(within(question).getByRole('button', { name: 'Combine' }));

    expect(await screen.findByRole('heading', { name: '2 combined databases' })).toBeTruthy();
    await waitFor(() => expect(window.location.hash).toBe(`#db=${alpha}&db=${beta}`));
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
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('search')).toBeNull();
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
