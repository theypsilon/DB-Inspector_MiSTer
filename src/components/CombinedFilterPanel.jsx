import CollapsibleSection from './ui/CollapsibleSection.jsx';
import FilterInput from './FilterInput.jsx';
import FilterHelp from './FilterHelp.jsx';
import FilterResults from './FilterResults.jsx';
import { describeAppliedFilter } from '../lib/combinedFilters.js';

// FILTER for combined databases, as in downloader.ini: a shared filter for all of them (the
// [mister] filter), filters of their own for some, and the filter that ends up applying to each.
function CombinedFilterPanel({
  databases,
  sharedFilter,
  overrides,
  onSharedFilterChange,
  onSharedFilterReset,
  onOverrideChange,
  onOverrideAdd,
  onOverrideRemove,
  hasEssentialHint,
  hasUntaggedItems,
  onSearchEssential,
  filterPending,
  summary,
  storageSummary,
  clusterSizeBytes,
  onClusterSizeChange,
}) {
  const withOwnFilter = databases.filter(({ dbId }) => Object.hasOwn(overrides, dbId));
  const withoutOwnFilter = databases.filter(({ dbId }) => !Object.hasOwn(overrides, dbId));

  return (
    <CollapsibleSection
      label="FILTER"
      title="Enter terms to filter by"
      defaultOpen
      className="filter-panel"
      anchor="filter"
    >
      <span className="catalog-meta-label">All databases ([mister])</span>
      <div className="filter-toolbar">
        <div className="catalog-search">
          <FilterInput
            id="inspection-filter"
            label="FILTER"
            placeholder={sharedFilter.isSet ? 'console !cheats' : 'Not set'}
            value={sharedFilter.value}
            onChange={onSharedFilterChange}
          />
        </div>
        {sharedFilter.isSet ? (
          <button type="button" className="secondary-button" onClick={onSharedFilterReset}>
            Clear
          </button>
        ) : null}
      </div>
      <p className="helper-copy">
        Applies to every database, like the <code>[mister]</code> filter in downloader.ini. A
        database&apos;s own filter replaces it there, and can include it with the{' '}
        <code>[mister]</code> term.
      </p>

      <div className="database-filters">
        {withOwnFilter.map(({ dbId }) => (
          <div key={dbId} className="database-filter-row">
            <span className="db-chip">{dbId}</span>
            <div className="catalog-search">
              <FilterInput
                label={`FILTER for ${dbId}`}
                placeholder="[mister] !cheats"
                value={overrides[dbId]}
                onChange={(value) => onOverrideChange(dbId, value)}
              />
            </div>
            <button type="button" className="secondary-button" onClick={() => onOverrideRemove(dbId)}>
              Remove
            </button>
          </div>
        ))}
        {withoutOwnFilter.length ? (
          <select
            aria-label="Give a database its own filter"
            className="cluster-size-select"
            value=""
            onChange={(event) => {
              if (event.target.value) {
                onOverrideAdd(event.target.value);
              }
            }}
          >
            <option value="">+ Give a database its own filter</option>
            {withoutOwnFilter.map(({ dbId }) => (
              <option key={dbId} value={dbId}>
                {dbId}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      <ul className="effective-filter-list" aria-label="Filter applied to each database">
        {databases.map((database) => {
          const applied = describeAppliedFilter(database);
          return (
            <li key={database.dbId}>
              <span className="db-chip">{database.dbId}</span>
              <code>{applied.filter}</code>
              <span className="effective-filter-source">{applied.source}</span>
            </li>
          );
        })}
      </ul>

      <FilterHelp
        hasEssentialHint={hasEssentialHint}
        hasUntaggedItems={hasUntaggedItems}
        onSearchEssential={onSearchEssential}
      />
      <FilterResults
        filterPending={filterPending}
        summary={summary}
        storageSummary={storageSummary}
        clusterSizeBytes={clusterSizeBytes}
        onClusterSizeChange={onClusterSizeChange}
      />
    </CollapsibleSection>
  );
}

export default CombinedFilterPanel;
