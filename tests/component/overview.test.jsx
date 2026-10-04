import { describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import DatabaseOverview from '../../src/components/DatabaseOverview.jsx';
import CombinedOverview from '../../src/components/CombinedOverview.jsx';
import CombinedFilterPanel from '../../src/components/CombinedFilterPanel.jsx';
import IssuesSection from '../../src/components/IssuesSection.jsx';
import { buildCombinedView } from '../../src/model/views.js';
import { NO_COMBINED_FILTERS } from '../../src/lib/combinedFilters.js';
import { inspect, text } from './support.js';

const database = (dbId, files = {}, extra = {}) => ({
  db_id: dbId,
  v: 1,
  timestamp: 1710000000,
  base_files_url: `https://example.com/${dbId}/`,
  tag_dictionary: { arcade: 0, console: 1 },
  files,
  folders: {},
  ...extra,
});

// A database loaded from a URL, as the page shows it.
async function fromUrl(json, url) {
  const inspection = await inspect(json);
  return { ...inspection, source: { ...inspection.source, sourceKind: 'url', sourceLabel: url, requestedUrl: url } };
}

describe('the database overview', () => {
  test('names the database, links its GitHub repository, and toggles details', async () => {
    const inspection = await fromUrl(database('github_db'), 'https://raw.githubusercontent.com/example-owner/example-repo/main/db.json');
    const onDetailedChange = vi.fn();
    const onInstall = vi.fn();
    const { rerender } = render(<DatabaseOverview inspection={inspection} detailed={false} onDetailedChange={onDetailedChange} onInstall={onInstall} />);
    const user = userEvent.setup();

    expect(screen.getByRole('heading', { name: 'github_db' })).toBeTruthy();
    const repo = screen.getByRole('link', { name: 'example-owner/example-repo' });
    expect(repo.getAttribute('href')).toBe('https://github.com/example-owner/example-repo');

    const toggle = screen.getByRole('button', { name: 'Detailed toggle' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByText('base_files_url')).toBeNull();
    await user.click(toggle);
    expect(onDetailedChange).toHaveBeenCalledWith(true);

    rerender(<DatabaseOverview inspection={inspection} detailed onDetailedChange={onDetailedChange} onInstall={onInstall} />);
    expect(screen.getByRole('button', { name: 'Detailed toggle' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('base_files_url')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Install' }));
    expect(onInstall).toHaveBeenCalledTimes(1);
  });

  test('uploaded databases have no Install button', async () => {
    render(<DatabaseOverview inspection={await inspect(database('mine'))} detailed={false} onDetailedChange={() => {}} onInstall={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull();
  });

  test('section anchors put the section in the address and open it when it is collapsed', async () => {
    render(<IssuesSection issues={[]} />);
    const section = document.querySelector('#section-issues');
    section.open = false;
    const user = userEvent.setup();
    await user.click(section.querySelector('.section-anchor-button'));
    expect(window.location.hash).toBe('#issues');
    expect(section.open).toBe(true);
  });
});

describe('combined databases', () => {
  async function combined(filters = NO_COMBINED_FILTERS) {
    const alpha = { inspection: await fromUrl(database('alpha', { 'cores/alpha.rbf': { size: 10, hash: 'a1', tags: [0] } }), 'https://example.com/alpha.json'), filterDefaults: {} };
    const beta = {
      inspection: await fromUrl(
        database('beta', { 'cores/beta.rbf': { size: 20, hash: 'b1', tags: [1] } }, { default_options: { filter: '!console' } }),
        'https://example.com/beta.json',
      ),
      filterDefaults: {},
    };
    return { databases: [alpha, beta], view: buildCombinedView([alpha, beta], filters) };
  }

  test('show a card per database under their count', async () => {
    const { databases } = await combined();
    render(<CombinedOverview databases={databases} detailed={false} onDetailedChange={() => {}} onInstall={() => {}} />);
    expect(screen.getByRole('heading', { name: '2 combined databases' })).toBeTruthy();
    expect([...document.querySelectorAll('.combined-database-card h3')].map(text)).toEqual(['alpha', 'beta']);
  });

  test('share a FILTER, can have their own, and list the filter each one gets', async () => {
    const { view } = await combined({ shared: { isSet: true, value: 'arcade' }, overrides: { beta: '[mister] console' } });
    const handlers = { onSharedFilterChange: vi.fn(), onSharedFilterReset: vi.fn(), onOverrideChange: vi.fn(), onOverrideAdd: vi.fn(), onOverrideRemove: vi.fn() };
    render(
      <CombinedFilterPanel
        databases={view.databases}
        sharedFilter={{ isSet: true, value: 'arcade' }}
        overrides={{ beta: '[mister] console' }}
        hasEssentialHint={false}
        hasUntaggedItems={false}
        onSearchEssential={() => {}}
        filterPending={false}
        summary=""
        storageSummary={null}
        clusterSizeBytes={131072}
        onClusterSizeChange={() => {}}
        {...handlers}
      />,
    );
    const user = userEvent.setup();

    const applied = within(screen.getByRole('list', { name: 'Filter applied to each database' })).getAllByRole('listitem');
    expect(applied.map(text)).toEqual(['alphaarcadeshared filter', 'betaarcade consoleits own filter']);

    expect(screen.getByLabelText('FILTER').value).toBe('arcade');
    await user.type(screen.getByLabelText('FILTER'), '!');
    expect(handlers.onSharedFilterChange).toHaveBeenLastCalledWith('arcade!');
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(handlers.onSharedFilterReset).toHaveBeenCalledTimes(1);

    expect(screen.getByLabelText('FILTER for beta').value).toBe('[mister] console');
    await user.type(screen.getByLabelText('FILTER for beta'), 'x');
    expect(handlers.onOverrideChange).toHaveBeenLastCalledWith('beta', '[mister] consolex');
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(handlers.onOverrideRemove).toHaveBeenCalledWith('beta');

    await user.selectOptions(screen.getByLabelText('Give a database its own filter'), 'alpha');
    expect(handlers.onOverrideAdd).toHaveBeenCalledWith('alpha');
  });

  test('without a shared filter, each database gets its default or everything', async () => {
    const { view } = await combined();
    render(
      <CombinedFilterPanel
        databases={view.databases}
        sharedFilter={NO_COMBINED_FILTERS.shared}
        overrides={{}}
        hasEssentialHint={false}
        hasUntaggedItems={false}
        onSearchEssential={() => {}}
        filterPending={false}
        summary=""
        storageSummary={null}
        clusterSizeBytes={131072}
        onClusterSizeChange={() => {}}
        onSharedFilterChange={() => {}}
        onSharedFilterReset={() => {}}
        onOverrideChange={() => {}}
        onOverrideAdd={() => {}}
        onOverrideRemove={() => {}}
      />,
    );
    const applied = within(screen.getByRole('list', { name: 'Filter applied to each database' })).getAllByRole('listitem');
    expect(applied.map(text)).toEqual(['alphaEverythingno filter', 'beta!consoledatabase default']);
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
  });

  test('issues name their database', async () => {
    render(<IssuesSection issues={[{ id: 'c', level: 'warning', context: 'collisions', message: '1 path is claimed by more than one database: alpha, beta.', dbId: null }, { id: 'd', level: 'error', context: 'files', message: 'Broken.', dbId: 'beta' }]} />);
    const items = [...document.querySelectorAll('#section-issues .issue')];
    expect(items.map(text)).toEqual([
      'warningcollisions1 path is claimed by more than one database: alpha, beta.',
      'errorbetafilesBroken.',
    ]);
    expect(items[0].querySelector('.db-chip')).toBeNull();
    expect(text(items[1].querySelector('.db-chip'))).toBe('beta');
  });
});
