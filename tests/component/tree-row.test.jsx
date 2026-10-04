import { describe, expect, test, vi } from 'vitest';
import { render, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import TreeEntryRow from '../../src/components/tree/TreeEntryRow.jsx';
import { archiveRows, filesystemRows, text } from './support.js';

const DOWNLOADS = {
  db_id: 'download_actions',
  v: 1,
  timestamp: 1710000000,
  files: Object.fromEntries(
    ['docs/notes.txt', 'docs/settings.ini', 'docs/readme.md', 'docs/manual.pdf', 'images/cover.png', 'cores/core.rbf'].map((path) => [
      path,
      { url: `https://example.com/files/${path.split('/').at(-1)}`, hash: 'abc', size: 10 },
    ]),
  ),
  folders: {},
};

// Files with eleven, six, five and three tags; some tags have a second name in the dictionary.
const TAGGED = {
  db_id: 'tagged',
  v: 1,
  timestamp: 1710000000,
  tag_dictionary: {
    screenrotationverticalcw: 0, screentatecw: 0, screenrotationflip: 1, arcade: 2, arcadecores: 2, mra: 3,
    controls2buttons: 4, controls2players: 5, controlsmove8way: 6, scanrate15khz: 7, arcadejtcps2: 8, alternatives: 9, extra: 10,
  },
  files: {
    'eleven.mra': { size: 1, hash: 'a', tags: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
    'six.mra': { size: 1, hash: 'b', tags: [2, 3, 4, 5, 6, 7] },
    'five.mra': { size: 1, hash: 'c', tags: [2, 3, 4, 5, 6] },
    'three.mra': { size: 1, hash: 'd', tags: [0, 2, 3] },
  },
  folders: {},
};

// The text of each tag chip, without its tooltip.
function chipNames(element) {
  return [...element.querySelectorAll('.tag-chip')].map((chip) => chip.firstChild.textContent);
}

function renderRow(row, props = {}) {
  const handlers = { onToggleCollapsed: vi.fn(), onToggleDetails: vi.fn(), onToggleTags: vi.fn(), onSetRowState: vi.fn(), onAnchorRow: vi.fn() };
  const { container, unmount } = render(
    <TreeEntryRow row={row} collapsed={false} detailsVisible={false} highlighted={false} {...handlers} {...props} />,
  );
  return { ...handlers, element: container.firstElementChild, unmount, user: userEvent.setup() };
}

describe('a tree row', () => {
  test('files the browser can show get an OPEN link next to Download, and binaries only Download', async () => {
    const { row } = await filesystemRows(DOWNLOADS);
    for (const name of ['notes.txt', 'settings.ini', 'readme.md', 'manual.pdf', 'cover.png']) {
      const { element, unmount } = renderRow(row(name));
      const open = within(element).getByRole('link', { name: 'OPEN' });
      expect(open.getAttribute('href')).toBe(`https://example.com/files/${name}`);
      expect(open.getAttribute('target')).toBe('_blank');
      expect(within(element).getByRole('button', { name: 'Download' })).toBeTruthy();
      unmount();
    }

    const { element } = renderRow(row('core.rbf'));
    expect(within(element).queryByRole('link', { name: 'OPEN' })).toBeNull();
    expect(element.querySelector('.open-button')).toBeNull();
    expect(within(element).getByRole('button', { name: 'Download' })).toBeTruthy();
  });

  test('shows its details only when asked, and the toggle asks', async () => {
    const { row } = await filesystemRows(DOWNLOADS);
    const hidden = renderRow(row('core.rbf'));
    expect(text(hidden.element)).not.toContain('MD5 HASH');
    await hidden.user.click(within(hidden.element).getByRole('button', { name: 'Show details' }));
    expect(hidden.onToggleDetails).toHaveBeenCalledWith(row('core.rbf').id);
    // Only the link icon puts a row in the address.
    expect(hidden.onAnchorRow).not.toHaveBeenCalled();
    hidden.unmount();

    const shown = renderRow(row('core.rbf'), { detailsVisible: true });
    expect(text(shown.element)).toContain('MD5 HASH');
    expect(within(shown.element).getByRole('button', { name: 'Hide details' })).toBeTruthy();
  });

  test('a collapsed file opens with its details', async () => {
    const { row } = await filesystemRows(DOWNLOADS);
    const { element, user, onSetRowState, onToggleDetails } = renderRow(row('core.rbf'), { collapsed: true });
    await user.click(within(element).getByRole('button', { name: 'Show details' }));
    expect(onSetRowState).toHaveBeenCalledWith(row('core.rbf').id, { collapsed: false, detailsVisible: true });
    expect(onToggleDetails).not.toHaveBeenCalled();
  });

  test('folders collapse, files have no collapse button, and the link icon anchors the row', async () => {
    const { row } = await filesystemRows(DOWNLOADS);
    const folder = renderRow(row('docs'));
    await folder.user.click(folder.element.querySelector('.collapse-button'));
    expect(folder.onToggleCollapsed).toHaveBeenCalledWith(row('docs').id);
    await folder.user.click(folder.element.querySelector('.copy-link-button'));
    expect(folder.onAnchorRow).toHaveBeenCalledWith(row('docs').id);
    folder.unmount();

    const file = renderRow(row('core.rbf'));
    expect(file.element.querySelector('.collapse-button')).toBeNull();
    expect(file.element.id).toBe(`row-${row('core.rbf').id}`);
  });

  test('archive cards are anchored by their link icon too', async () => {
    const { row } = await archiveRows({
      ...DOWNLOADS,
      archives: {
        test_archive: {
          description: 'Test archive',
          format: 'zip',
          extract: 'selective',
          target_folder: 'games/test/',
          archive_file: { url: 'https://example.com/test.zip', size: 4096, hash: 'ah' },
          summary_inline: { files: { 'games/test/a.bin': { arc_id: 'test_archive', arc_at: 'a.bin', size: 1 } }, folders: {} },
        },
      },
    });
    const archive = row('test_archive');
    const { element, user, onAnchorRow } = renderRow(archive);
    expect(element.classList.contains('archive-card')).toBe(true);
    await user.click(element.querySelector('.copy-link-button'));
    expect(onAnchorRow).toHaveBeenCalledWith(archive.id);
  });

  test('rows of combined databases name their database', async () => {
    const { row } = await filesystemRows(DOWNLOADS);
    const { element } = renderRow({ ...row('core.rbf'), node: { ...row('core.rbf').node, dbId: 'alpha' } });
    expect(text(element.querySelector('.db-chip'))).toBe('alpha');
  });

  test('a row shows its four rarest tags, one name each, and how many more it has', async () => {
    const { row } = await filesystemRows(TAGGED);
    const { element, user, onToggleTags, unmount } = renderRow(row('eleven.mra'));
    // The tags only this file has come first, in the database's order.
    expect(chipNames(element)).toEqual(['screenrotationflip', 'arcadejtcps2', 'alternatives', 'extra']);
    await user.click(within(element).getByRole('button', { name: '+7 more tags' }));
    expect(onToggleTags).toHaveBeenCalledWith(row('eleven.mra').id);
    unmount();

    // A tag's other names are in its tooltip.
    const three = renderRow(row('three.mra'));
    expect(chipNames(three.element)).toEqual(['screenrotationverticalcw', 'arcade', 'mra']);
    expect(text(three.element.querySelectorAll('.tag-chip')[1].querySelector('.chip-tooltip'))).toBe('Tag 2: arcade / arcadecores');
    three.unmount();

    // One more tag than four is shown rather than counted.
    for (const [name, count, more] of [['six.mra', 4, '+2 more tags'], ['five.mra', 5, null], ['three.mra', 3, null]]) {
      const shown = renderRow(row(name));
      expect(chipNames(shown.element)).toHaveLength(count);
      expect(within(shown.element).queryByRole('button', { name: /more tags/ })?.getAttribute('aria-label') ?? null).toBe(more);
      shown.unmount();
    }
  });

  test('all its tags show, with their other names, when asked for, with details, or for a find-in-page match', async () => {
    const { row } = await filesystemRows(TAGGED);
    // Rarest first: used by this file only, then by two, three and four files.
    const all = ['screenrotationflip', 'arcadejtcps2', 'alternatives', 'extra', 'screenrotationverticalcw / screentatecw', 'scanrate15khz',
      'controls2buttons', 'controls2players', 'controlsmove8way', 'arcade / arcadecores', 'mra'];

    const expanded = renderRow(row('eleven.mra'), { tagsExpanded: true });
    expect(chipNames(expanded.element)).toEqual(all);
    await expanded.user.click(within(expanded.element).getByRole('button', { name: 'Show fewer' }));
    expect(expanded.onToggleTags).toHaveBeenCalledWith(row('eleven.mra').id);
    expanded.unmount();

    for (const props of [{ detailsVisible: true }, { tagsRevealed: true }, { detailsVisible: true, tagsExpanded: true }]) {
      const { element, unmount } = renderRow(row('eleven.mra'), props);
      expect(chipNames(element)).toEqual(all);
      expect(within(element).queryByRole('button', { name: /more tags|Show fewer/ })).toBeNull();
      unmount();
    }
  });

  test('a highlighted row says so', async () => {
    const { row } = await filesystemRows(DOWNLOADS);
    const { element } = renderRow(row('core.rbf'), { highlighted: true });
    expect(element.classList.contains('tree-entry-highlighted')).toBe(true);
  });
});
