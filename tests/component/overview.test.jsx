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

  // Loaded from URLs, so they can be installed; gamma has a GitHub repository.
  async function several(count) {
    const urls = { gamma: 'https://raw.githubusercontent.com/example-owner/gamma-repo/main/db.json' };
    return Promise.all(
      ['alpha', 'beta', 'gamma', 'delta', 'epsilon'].slice(0, count).map(async (dbId, index) => ({
        inspection: await fromUrl(
          database(dbId, Object.fromEntries(Array.from({ length: index + 1 }, (_, file) => [`${dbId}/f${file}.rbf`, { size: 1, hash: 'h' }]))),
          urls[dbId] ?? `https://example.com/${dbId}.json`,
        ),
        filterDefaults: {},
      })),
    );
  }

  test('show cards for up to three databases, and a compact list for more', async () => {
    const three = render(<CombinedOverview databases={await several(3)} detailed={false} onDetailedChange={() => {}} onInstall={() => {}} />);
    expect(document.querySelector('#section-database').tagName).toBe('SECTION');
    expect(document.querySelectorAll('article.combined-database-card')).toHaveLength(3);
    three.unmount();

    render(<CombinedOverview databases={await several(4)} detailed={false} onDetailedChange={() => {}} onInstall={() => {}} />);
    expect(document.querySelector('#section-database').tagName).toBe('DETAILS');
    expect(document.querySelectorAll('article.combined-database-card')).toHaveLength(0);
    expect([...document.querySelectorAll('.combined-database-row h3')].map(text)).toEqual(['alpha', 'beta', 'gamma', 'delta']);
  });

  test('in the compact list, each database opens on its own, and the list collapses with the Detailed toggle at hand', async () => {
    const onDetailedChange = vi.fn();
    const onInstall = vi.fn();
    const view = render(<CombinedOverview databases={await several(5)} detailed={false} onDetailedChange={onDetailedChange} onInstall={onInstall} />);
    const section = document.querySelector('#section-database');
    expect(section.open).toBe(true);
    expect(screen.getByRole('heading', { name: '5 combined databases' })).toBeTruthy();

    // A row shows its db_id and counts, and nothing in it but the row itself can be clicked.
    const rows = [...document.querySelectorAll('.combined-database-row')];
    expect(rows.map((row) => [text(row.querySelector('summary h3')), text(row.querySelector('summary .combined-database-row-counts'))])).toEqual([
      ['alpha', '1 files, 0 folders, 0 archives'],
      ['beta', '2 files, 0 folders, 0 archives'],
      ['gamma', '3 files, 0 folders, 0 archives'],
      ['delta', '4 files, 0 folders, 0 archives'],
      ['epsilon', '5 files, 0 folders, 0 archives'],
    ]);
    expect(rows.every((row) => row.querySelector('summary').children.length === 2)).toBe(true);
    expect(document.querySelector('.combined-database-row summary a, .combined-database-row summary button')).toBeNull();
    expect(rows.every((row) => !row.open)).toBe(true);

    // Open, a row shows what its card would: Install, its repository, and its details.
    const gamma = rows[2];
    gamma.open = true;
    const body = within(gamma.querySelector('.combined-database-row-body'));
    const user = userEvent.setup();
    await user.click(body.getByRole('button', { name: 'Install' }));
    expect(onInstall).toHaveBeenCalledWith('gamma');
    expect(body.getByRole('link', { name: 'example-owner/gamma-repo' }).getAttribute('href')).toBe('https://github.com/example-owner/gamma-repo');
    expect(text(gamma.querySelector('.metadata-list'))).toContain('https://raw.githubusercontent.com/example-owner/gamma-repo/main/db.json');
    expect(text(gamma.querySelector('.metadata-list'))).not.toContain('Default filter');

    // The Detailed toggle is in the section's summary, so it is there while the list is collapsed.
    const toggle = within(section.querySelector('summary')).getByRole('button', { name: 'Detailed toggle' });
    await user.click(toggle);
    expect(onDetailedChange).toHaveBeenCalledWith(true);
    view.rerender(<CombinedOverview databases={await several(5)} detailed onDetailedChange={onDetailedChange} onInstall={onInstall} />);
    expect(text(document.querySelectorAll('.combined-database-row')[2].querySelector('.metadata-list'))).toContain('Default filter');
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

  test('with more than three databases, list only those with a filter or a default of their own, and count the rest', async () => {
    const item = async (dbId, extra = {}) => ({ inspection: await fromUrl(database(dbId, {}, extra), `https://example.com/${dbId}.json`), filterDefaults: {} });
    const items = [await item('alpha'), await item('beta', { default_options: { filter: '!console' } }), await item('gamma'), await item('delta'), await item('epsilon')];
    const listed = (filters) => {
      const view = buildCombinedView(items, filters);
      const { unmount } = render(
        <CombinedFilterPanel
          databases={view.databases}
          sharedFilter={filters.shared}
          overrides={filters.overrides}
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
      const rows = within(screen.getByRole('list', { name: 'Filter applied to each database' })).getAllByRole('listitem').map(text);
      unmount();
      return rows;
    };

    // Beta's default and gamma's own filter stand out; the other databases get everything.
    expect(listed({ shared: NO_COMBINED_FILTERS.shared, overrides: { gamma: 'arcade' } })).toEqual([
      'beta!consoledatabase default',
      'gammaarcadeits own filter',
      'The other 3 databasesEverythingno filter',
    ]);
    // A shared filter replaces beta's default, which does not include [mister].
    expect(listed({ shared: { isSet: true, value: 'arcade' }, overrides: { gamma: 'console' } })).toEqual([
      'gammaconsoleits own filter',
      'The other 4 databasesarcadeshared filter',
    ]);
    expect(listed({ shared: { isSet: true, value: 'arcade' }, overrides: {} })).toEqual(['All 5 databasesarcadeshared filter']);
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
