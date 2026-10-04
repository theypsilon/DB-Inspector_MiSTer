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

function renderRow(row, props = {}) {
  const handlers = { onToggleCollapsed: vi.fn(), onToggleDetails: vi.fn(), onSetRowState: vi.fn(), onAnchorRow: vi.fn() };
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

  test('a highlighted row says so', async () => {
    const { row } = await filesystemRows(DOWNLOADS);
    const { element } = renderRow(row('core.rbf'), { highlighted: true });
    expect(element.classList.contains('tree-entry-highlighted')).toBe(true);
  });
});
