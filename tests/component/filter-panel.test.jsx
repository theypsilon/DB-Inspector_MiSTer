import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import FilterPanel from '../../src/components/FilterPanel.jsx';
import { applyInspectionFilter } from '../../src/lib/database.js';
import { CLUSTER_SIZE_TIP, DEFAULT_CLUSTER_SIZE_BYTES } from '../../src/lib/utils.js';
import { buildStorageSummary } from '../../src/model/views.js';
import { inspect, text } from './support.js';

const DATABASE = {
  db_id: 'sizes_db',
  v: 1,
  timestamp: 1710000000,
  base_files_url: 'https://example.com/base/',
  tag_dictionary: { essential: 0, arcade: 1 },
  files: {
    'cores/essential.rbf': { size: 1024, hash: 'h1', tags: [0] },
    'cores/arcade.rbf': { size: 2048, hash: 'h2', tags: [1] },
  },
  folders: { 'cores/': {} },
  archives: {
    flows_archive: {
      description: 'Flows archive',
      format: 'zip',
      extract: 'selective',
      target_folder: 'games/flows/',
      archive_file: { url: 'https://example.com/flows.zip', size: 4096, hash: 'ah' },
      summary_inline: {
        files: { 'games/flows/untagged.bin': { arc_id: 'flows_archive', arc_at: 'untagged.bin', size: 100 } },
        folders: {},
      },
    },
  },
};

async function renderPanel({ filter = '', clusterSizeBytes = DEFAULT_CLUSTER_SIZE_BYTES, ...props } = {}) {
  const displayed = applyInspectionFilter(await inspect(DATABASE), filter);
  const handlers = { onFilterInputChange: vi.fn(), onReset: vi.fn(), onSearchEssential: vi.fn(), onClusterSizeChange: vi.fn(), onBrowseTerms: vi.fn() };
  render(
    <FilterPanel
      filterInput={filter}
      canReset={false}
      hasEssentialHint
      hasUntaggedItems
      defaultFilter=""
      filterPending={false}
      activeFilter={displayed.activeFilter}
      storageSummary={buildStorageSummary({ combinedView: null, displayedInspection: displayed, clusterSizeBytes })}
      clusterSizeBytes={clusterSizeBytes}
      {...handlers}
      {...props}
    />,
  );
  return { ...handlers, panel: document.querySelector('#section-filter'), user: userEvent.setup() };
}

describe('the FILTER panel', () => {
  test('passes what is typed on, and Enter leaves the box without adding a line', async () => {
    const { user, onFilterInputChange } = await renderPanel();
    const box = screen.getByLabelText('FILTER');
    await user.click(box);
    await user.keyboard('x{Enter}');
    expect(onFilterInputChange).toHaveBeenCalledWith('x');
    expect(onFilterInputChange).not.toHaveBeenCalledWith('\n');
    expect(document.activeElement).not.toBe(box);
  });

  test('offers the terms to choose from, beside the box', async () => {
    const { user, onBrowseTerms, panel } = await renderPanel();
    const toolbar = panel.querySelector('.filter-toolbar');
    await user.click(within(toolbar).getByRole('button', { name: 'Terms' }));
    expect(onBrowseTerms).toHaveBeenCalledTimes(1);
  });

  test('offers Clear when FILTER differs from its default', async () => {
    const { user, onReset } = await renderPanel({ filter: 'b', canReset: true });
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  test('has no Clear when FILTER is its default, and names the database default', async () => {
    await renderPanel({ defaultFilter: 'arcade' });
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
    expect(text(document.querySelector('#section-filter'))).toContain('Database default: arcade.');
  });

  test('explains the terms for the content: essential and untagged items', async () => {
    const { panel, user, onSearchEssential } = await renderPanel();
    expect(text(panel.querySelector('.helper-copy'))).toBe(
      'Filter content with terms (a.k.a. tags) like console, arcade, or !cheats. Positive terms keep matching tagged items, negative terms remove them, untagged items remain visible, and essential stays included unless you exclude it. Read the official guide.',
    );
    await user.click(screen.getByRole('button', { name: 'essential' }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'essential' }), { key: 'Enter' });
    expect(onSearchEssential).toHaveBeenCalledTimes(2);
    expect(within(panel).getByRole('link', { name: 'Read the official guide' }).getAttribute('href')).toBe(
      'https://github.com/MiSTer-devel/Downloader_MiSTer/blob/main/docs/download-filters.md',
    );
  });

  test('without essential, untagged items close the sentence; with neither, it ends after the terms', async () => {
    await renderPanel({ hasEssentialHint: false });
    expect(text(document.querySelector('#section-filter .helper-copy'))).toBe(
      'Filter content with terms (a.k.a. tags) like console, arcade, or !cheats. Positive terms keep matching tagged items, negative terms remove them, and untagged items remain visible. Read the official guide.',
    );
  });

  test('without either, the sentence ends after the terms', async () => {
    await renderPanel({ hasEssentialHint: false, hasUntaggedItems: false });
    expect(text(document.querySelector('#section-filter .helper-copy'))).toBe(
      'Filter content with terms (a.k.a. tags) like console, arcade, or !cheats. Positive terms keep matching tagged items, negative terms remove them. Read the official guide.',
    );
  });

  test('summarizes what the filter leaves, archive contents included', async () => {
    const { panel } = await renderPanel({ filter: 'arcade' });
    expect(text(panel)).toContain('Showing 3 files, 1 folders, and 1 archives for this filter.');
  });

  test('says the preview is updating while FILTER settles', async () => {
    const { panel } = await renderPanel({ filterPending: true });
    expect(text(panel)).toContain('Updating preview...');
    expect(panel.querySelector('.disk-usage-value')).toBeNull();
  });

  test('size hints open on click and close when the pointer leaves or focus moves away', async () => {
    const { panel, user, onClusterSizeChange } = await renderPanel();
    const size = panel.querySelector('.disk-usage-value');
    expect(text(size)).toContain('384 KB');
    expect(text(size.querySelector('.info-tip'))).toBe('Raw file sizes: 3.1 KB 3,172 bytes');

    await user.click(size);
    expect(size.hasAttribute('data-open')).toBe(true);
    fireEvent.mouseLeave(size);
    expect(size.hasAttribute('data-open')).toBe(false);
    await user.click(size);
    fireEvent.blur(size);
    expect(size.hasAttribute('data-open')).toBe(false);

    await user.selectOptions(screen.getByLabelText('Cluster size'), '4096');
    expect(onClusterSizeChange).toHaveBeenCalledWith(4096);
    const info = screen.getByLabelText('Cluster size info');
    await user.click(info);
    expect(info.hasAttribute('data-open')).toBe(true);
    expect(text(info.querySelector('.info-tip'))).toBe(CLUSTER_SIZE_TIP);
  });

  test('the size follows the cluster size it is given', async () => {
    const { panel } = await renderPanel({ clusterSizeBytes: 4096 });
    expect(text(panel.querySelector('.disk-usage-value'))).toContain('12.0 KB');
  });
});
