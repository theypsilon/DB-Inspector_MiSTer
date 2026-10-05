import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import ExplorerModal from '../../src/components/explorer/ExplorerModal.jsx';
import { applyInspectionFilter } from '../../src/lib/database.js';
import { combineDatabaseViews } from '../../src/lib/combine.js';
import { buildExplorerTree } from '../../src/lib/explorer.js';
import { inspect, text } from './support.js';

// The explorer dialog: what it lists and shows, and what each click and key does. jsdom has no
// layout, so it renders the first rows of a folder and never folds the path; the journeys check
// scrolling, folding and phones in a browser.

const DATABASE = {
  db_id: 'sd_db',
  v: 1,
  timestamp: 1710000000,
  base_files_url: 'https://example.com/files/',
  tag_dictionary: { arcade: 0, cheats: 1 },
  files: {
    '_Arcade/cores/Arkanoid_20240525.rbf': { size: 3 * 1024 * 1024, hash: 'core-hash', tags: [0] },
    '_Arcade/720 Degrees (rev 4).mra': { size: 8294, hash: '29e9fd50378f944056f21f96980ca02b', tags: [0] },
    '_Arcade/notes.txt': { size: 10, hash: 'notes' },
    'menu.rbf': { size: 100, hash: 'menu' },
  },
  folders: { '_Arcade/': { tags: [0] }, '_Arcade/cores/': {}, 'empty/': {} },
  archives: {
    mra_alternatives: {
      description: 'Alternatives',
      format: 'zip',
      extract: 'all',
      target_folder: '_Arcade/',
      archive_file: { url: 'https://example.com/alternatives.zip', size: 1000, hash: 'zip' },
      summary_inline: {
        files: {
          '_Arcade/_alternatives/_720_Degrees/720 Degrees (German, rev 1).mra': { arc_id: 'mra_alternatives', size: 40, hash: 'alt-1' },
          '_Arcade/_alternatives/_720_Degrees/720 Degrees (rev 1).mra': { arc_id: 'mra_alternatives', size: 41, hash: 'alt-2' },
        },
        folders: { '_Arcade/_alternatives/': { arc_id: 'mra_alternatives', tags: [0] } },
      },
    },
  },
};

async function sdCard(database = DATABASE, filter = '') {
  return buildExplorerTree(applyInspectionFilter(await inspect(database), filter));
}

function openExplorer(tree, props = {}) {
  const handlers = { onLocationChange: vi.fn(), onClose: vi.fn(), onDownloadError: vi.fn() };
  const result = render(<ExplorerModal tree={tree} initialPath="" filtering={false} {...handlers} {...props} />);
  return { ...handlers, ...result, user: userEvent.setup() };
}

// An entry's name, in full in its tooltip however it is cut short.
function nameOf(entry) {
  return entry.querySelector('.explorer-name, .explorer-tile-name').title;
}

// The entries listed, by name.
function listed() {
  return screen.getAllByRole('option').map(nameOf);
}

function option(name) {
  return screen.getAllByRole('option').find((candidate) => nameOf(candidate) === name);
}

// The details' facts, as [label, value]; tags by the name each chip shows.
function facts(details) {
  return [...details.querySelectorAll('.explorer-fact')].map((fact) => {
    const chips = [...fact.querySelectorAll('.tag-chip')];
    const value = chips.length ? chips.map((chip) => chip.firstChild.textContent).join(' ') : text(fact.querySelector('dd'));
    return [text(fact.querySelector('dt')), value];
  });
}

function shown() {
  return text(document.querySelector('.explorer-crumb-current'));
}

function lastLocation(onLocationChange) {
  return onLocationChange.mock.calls.at(-1)[0];
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the explorer', () => {
  test('lists a folder’s folders, then its files, with their sizes; Back, Forward and Up wait for somewhere to go', async () => {
    const { onLocationChange } = openExplorer(await sdCard());

    expect(screen.getByRole('dialog', { name: 'Explorer' })).toBeTruthy();
    expect(shown()).toBe('SD card');
    expect(listed()).toEqual(['_Arcade', 'empty', 'menu.rbf']);
    expect(option('_Arcade').getAttribute('aria-label')).toBe('_Arcade, folder, 3.0 MB');
    expect(option('menu.rbf').getAttribute('aria-label')).toBe('menu.rbf, file, 100 B');
    // An empty folder shows no size.
    expect(option('empty').getAttribute('aria-label')).toBe('empty, folder');
    for (const name of ['Back', 'Forward', 'Up']) {
      expect(screen.getByRole('button', { name }).disabled).toBe(true);
    }
    expect(screen.getByRole('button', { name: 'Back' }).title).toBe('Back (Alt+←)');
    expect(onLocationChange).toHaveBeenLastCalledWith('');
    // The list has the focus, for the keyboard.
    expect(document.activeElement).toBe(screen.getByRole('listbox', { name: 'SD card contents' }));
  });

  test('a click shows an entry’s details, and the link names a file while its details are shown', async () => {
    const { onLocationChange, user } = openExplorer(await sdCard(), { initialPath: '_Arcade' });
    expect(listed()).toEqual(['_alternatives', 'cores', '720 Degrees (rev 4).mra', 'notes.txt']);

    await user.click(option('720 Degrees (rev 4).mra'));
    expect(option('720 Degrees (rev 4).mra').getAttribute('aria-selected')).toBe('true');
    const details = screen.getByRole('complementary', { name: 'Details of 720 Degrees (rev 4).mra' });
    expect(text(details.querySelector('.explorer-details-summary'))).toBe('File · 8.1 KB');
    expect(facts(details)).toEqual([
      ['Path', '_Arcade/720 Degrees (rev 4).mra'],
      ['From', 'Database files'],
      ['Hash', '29e9fd50378f944056f21f96980ca02b'],
      ['Tags', 'arcade'],
      ['URL', 'https://example.com/files/_Arcade/720%20Degrees%20(rev%204).mra'],
    ]);
    expect(within(details).getByRole('button', { name: 'Download' })).toBeTruthy();
    // A file the browser cannot show itself has no OPEN.
    expect(within(details).queryByRole('link', { name: 'OPEN' })).toBeNull();
    expect(lastLocation(onLocationChange)).toBe('_Arcade/720 Degrees (rev 4).mra');

    await user.click(option('notes.txt'));
    expect(within(screen.getByRole('complementary')).getByRole('link', { name: 'OPEN' }).getAttribute('href')).toBe('https://example.com/files/_Arcade/notes.txt');

    await user.click(within(screen.getByRole('complementary')).getByRole('button', { name: 'Close details' }));
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(lastLocation(onLocationChange)).toBe('_Arcade');
  });

  test('a double click goes into a folder; Back, Forward, Up and the path move through the folders, and going up selects the folder left', async () => {
    const { onLocationChange, user } = openExplorer(await sdCard());

    await user.dblClick(option('_Arcade'));
    await user.dblClick(option('_alternatives'));
    await user.dblClick(option('_720_Degrees'));
    expect(shown()).toBe('_720_Degrees');
    expect(listed()).toEqual(['720 Degrees (German, rev 1).mra', '720 Degrees (rev 1).mra']);
    expect(lastLocation(onLocationChange)).toBe('_Arcade/_alternatives/_720_Degrees');
    expect([...document.querySelectorAll('.explorer-crumb-button')].map(text)).toEqual(['SD card', '_Arcade', '_alternatives']);
    expect(screen.getByRole('button', { name: 'Up to _alternatives' }).title).toBe('Up to _alternatives (Alt+↑)');
    // The first click of a double click shows the folder's details; they stay, showing the folder
    // gone into.
    expect(screen.getByRole('complementary', { name: 'Details of _720_Degrees' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(shown()).toBe('_alternatives');
    expect(option('_720_Degrees').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('button', { name: 'Forward' }).disabled).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Forward' }));
    expect(shown()).toBe('_720_Degrees');
    expect(screen.getByRole('button', { name: 'Forward' }).disabled).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Up to _alternatives' }));
    expect(shown()).toBe('_alternatives');
    expect(option('_720_Degrees').getAttribute('aria-selected')).toBe('true');
    // Visiting a folder from there drops the one ahead.
    expect(screen.getByRole('button', { name: 'Forward' }).disabled).toBe(true);

    await user.click(screen.getByRole('button', { name: 'SD card' }));
    expect(shown()).toBe('SD card');
    expect(option('_Arcade').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('button', { name: 'Up' }).disabled).toBe(true);
  });

  test('the keyboard: arrows select, Enter goes in or shows details, Backspace and Alt+arrows move, Escape closes the details, then the explorer', async () => {
    const { onClose, onLocationChange, user } = openExplorer(await sdCard());

    await user.keyboard('{ArrowDown}');
    expect(option('_Arcade').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('listbox').getAttribute('aria-activedescendant')).toBe(option('_Arcade').id);
    await user.keyboard('{Enter}');
    expect(shown()).toBe('_Arcade');
    await user.keyboard('{End}');
    expect(option('notes.txt').getAttribute('aria-selected')).toBe('true');
    await user.keyboard('{ArrowUp}{Enter}');
    expect(screen.getByRole('complementary', { name: 'Details of 720 Degrees (rev 4).mra' })).toBeTruthy();
    expect(lastLocation(onLocationChange)).toBe('_Arcade/720 Degrees (rev 4).mra');

    await user.keyboard('{Backspace}');
    expect(shown()).toBe('SD card');
    await user.keyboard('{Alt>}{ArrowLeft}{/Alt}');
    expect(shown()).toBe('_Arcade');
    await user.keyboard('{Alt>}{ArrowRight}{/Alt}');
    expect(shown()).toBe('SD card');
    await user.keyboard('{Alt>}{ArrowLeft}{/Alt}{Alt>}{ArrowUp}{/Alt}');
    expect(shown()).toBe('SD card');

    // The details of the folder left are open: the first Escape closes them.
    expect(screen.getByRole('complementary')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);

    // The browser is told to leave Alt+← and Backspace to the explorer rather than leave the page
    // (a browser's own shortcuts cannot be pressed from a test, even in the journeys).
    expect(fireEvent.keyDown(window, { key: 'ArrowLeft', altKey: true })).toBe(false);
    expect(fireEvent.keyDown(window, { key: 'Backspace' })).toBe(false);
  });

  test('on a touch screen a tap goes into a folder, and the info button shows a folder’s details', async () => {
    openExplorer(await sdCard());
    const tap = (element) => {
      const event = new MouseEvent('click', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'pointerType', { value: 'touch' });
      act(() => {
        element.dispatchEvent(event);
      });
    };

    tap(option('_Arcade'));
    expect(shown()).toBe('_Arcade');
    expect(screen.queryByRole('complementary')).toBeNull();
    tap(option('notes.txt'));
    expect(screen.getByRole('complementary', { name: 'Details of notes.txt' })).toBeTruthy();
    tap(within(option('cores')).getByRole('button', { name: 'Details of cores' }));
    expect(shown()).toBe('_Arcade');
    expect(screen.getByRole('complementary', { name: 'Details of cores' })).toBeTruthy();
  });

  test('a folder’s details: what it holds, where it is declared, its tags, and Open folder', async () => {
    const { user } = openExplorer(await sdCard(), { initialPath: '_Arcade' });

    await user.click(option('_alternatives'));
    const details = screen.getByRole('complementary', { name: 'Details of _alternatives' });
    expect(text(details.querySelector('.explorer-details-summary'))).toBe('Folder · 2 files · 81 B');
    expect(facts(details)).toEqual([
      ['Path', '_Arcade/_alternatives'],
      ['From', 'Archive mra_alternatives'],
      ['Tags', 'arcade'],
    ]);

    await user.click(within(details).getByRole('button', { name: 'Open folder' }));
    expect(shown()).toBe('_alternatives');
    // The folder shown has nothing to open.
    expect(within(screen.getByRole('complementary')).queryByRole('button', { name: 'Open folder' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'SD card' }));
    await user.click(screen.getByRole('button', { name: 'Close details' }));
    await user.click(option('menu.rbf'));
    await user.click(screen.getByRole('button', { name: 'Close details' }));
    // The SD card's own details, with nothing selected.
    await user.click(option('empty'));
    expect(text(screen.getByRole('complementary').querySelector('.explorer-details-summary'))).toBe('Folder · no files');
    await user.dblClick(option('empty'));
    expect(screen.getByText('This folder is empty.')).toBeTruthy();
  });

  test('a link to a file opens its folder with its details; to something not there, the deepest folder on its way', async () => {
    const tree = await sdCard();
    const { unmount } = openExplorer(tree, { initialPath: '_Arcade/cores/Arkanoid_20240525.rbf' });
    expect(shown()).toBe('cores');
    expect(option('Arkanoid_20240525.rbf').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('complementary', { name: 'Details of Arkanoid_20240525.rbf' })).toBeTruthy();
    unmount();

    const { onLocationChange } = openExplorer(tree, { initialPath: '_arcade/gone/file.rbf' });
    expect(shown()).toBe('_Arcade');
    expect(screen.queryByRole('complementary')).toBeNull();
    // The link then names where it opened.
    expect(lastLocation(onLocationChange)).toBe('_Arcade');
  });

  test('a folder the filter emptied says so', async () => {
    openExplorer(await sdCard(DATABASE, '!arcade'), { initialPath: '_Arcade/cores', filtering: true });
    expect(screen.getByText('Nothing in this folder is installed with the current filter.')).toBeTruthy();
    expect(screen.queryByRole('listbox')).toBeNull();
    // The dialog still has the focus, for Escape and the Alt keys.
    expect(document.activeElement).toBe(screen.getByRole('dialog'));
  });

  test('the view button switches to icons and back, and this browser remembers icons', async () => {
    const tree = await sdCard();
    const { user, unmount } = openExplorer(tree);
    expect(screen.getByRole('listbox').className).toContain('explorer-list');

    await user.click(screen.getByRole('button', { name: 'Show as icons' }));
    expect(screen.getByRole('listbox').className).toContain('explorer-icons');
    expect(listed()).toEqual(['_Arcade', 'empty', 'menu.rbf']);
    expect(window.localStorage.getItem('inspector-explorer-view')).toBe('icons');
    unmount();

    openExplorer(tree);
    expect(screen.getByRole('listbox').className).toContain('explorer-icons');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Show as list' }));
    expect(screen.getByRole('listbox').className).toContain('explorer-list');
    expect(window.localStorage.getItem('inspector-explorer-view')).toBeNull();
  });

  test('a long name keeps its end in view as it gives way', async () => {
    openExplorer(await sdCard(), { initialPath: '_Arcade/cores' });
    const name = option('Arkanoid_20240525.rbf').querySelector('.explorer-name');
    expect(name.title).toBe('Arkanoid_20240525.rbf');
    expect([...name.children].map((part) => [part.className, part.textContent])).toEqual([
      ['explorer-name-start', 'Arkanoid'],
      ['explorer-name-end', '_20240525.rbf'],
    ]);
  });

  test('a path several databases install lists each database’s version', async () => {
    const alpha = { ...DATABASE, db_id: 'alpha', archives: {}, files: { 'cores/shared.rbf': { size: 10, hash: 'same' } }, folders: {} };
    const beta = { ...DATABASE, db_id: 'Coin-OpCollection/Distribution-MiSTerFPGA', archives: {}, files: { 'cores/shared.rbf': { size: 10, hash: 'same' } }, folders: {} };
    const combined = combineDatabaseViews([
      { dbId: 'alpha', view: applyInspectionFilter(await inspect(alpha), '') },
      { dbId: beta.db_id, view: applyInspectionFilter(await inspect(beta), '') },
    ]);
    const { user } = openExplorer(buildExplorerTree(combined), { initialPath: 'cores' });

    expect(option('shared.rbf').getAttribute('aria-label')).toBe('shared.rbf, file, 2 versions, 10 B');
    expect(text(option('shared.rbf').querySelector('.explorer-versions'))).toBe('2 versions');
    await user.click(option('shared.rbf'));
    const details = screen.getByRole('complementary');
    expect(text(details.querySelector('.explorer-details-summary'))).toBe('File · 2 identical copies');
    const versions = within(details).getAllByRole('region');
    expect(versions.map((version) => text(version.querySelector('.explorer-origins')))).toEqual([
      'alpha Database files',
      'Coin-OpCollection/Distribution-MiSTerFPGA Database files',
    ]);
    expect(versions.map((version) => within(version).getAllByRole('button', { name: 'Download' }).length)).toEqual([1, 1]);
  });

  test('a download that fails is reported, and while another dialog is on top the keys are its own', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const { onClose, onDownloadError, user, rerender } = openExplorer(await sdCard(), { initialPath: 'menu.rbf' });

    await user.click(within(screen.getByRole('complementary')).getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(onDownloadError).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://example.com/files/menu.rbf', reason: 'network' })));

    rerender(<ExplorerModal tree={await sdCard()} initialPath="menu.rbf" filtering={false} suspended onLocationChange={vi.fn()} onClose={onClose} onDownloadError={onDownloadError} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('complementary')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  test('a click outside the explorer, or its close button, closes it', async () => {
    const { onClose, user } = openExplorer(await sdCard());
    await user.click(screen.getByRole('button', { name: 'Close explorer' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.click(document.querySelector('.explorer-overlay'));
    expect(onClose).toHaveBeenCalledTimes(2);
    await user.click(option('menu.rbf'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
