import { useRef } from 'react';
import CollapsibleSection from './ui/CollapsibleSection.jsx';
import FilterInput from './FilterInput.jsx';
import OwnFilterPicker from './OwnFilterPicker.jsx';
import FilterHelp from './FilterHelp.jsx';
import FilterResults from './FilterResults.jsx';
import { describeAppliedFilter, listAppliedFilters } from '../lib/combinedFilters.js';
import { COMBINED_DATABASES_IN_FULL_MAX } from '../lib/utils.js';

// How a group of databases that get the same filter is named in the applied filter list.
function describeRest(count, { others, grouped }) {
  if (grouped) {
    return `${count} ${count === 1 ? 'database' : 'databases'}`;
  }
  if (!others) {
    return `All ${count} databases`;
  }
  return count === 1 ? 'The other database' : `The other ${count} databases`;
}

// FILTER for combined databases, as in downloader.ini: a shared filter for all of them (the
// [mister] filter), filters of their own for some, and the filter that ends up applying to each.
// Each FILTER box has its terms to choose from: `onBrowseTerms` gets 'shared', or the db_id of a
// database's own filter.
function CombinedFilterPanel({
  databases,
  sharedFilter,
  overrides,
  onSharedFilterChange,
  onSharedFilterReset,
  onOverrideChange,
  onOverrideAdd,
  onOverrideRemove,
  onBrowseTerms,
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
  // With many databases, only those with a filter or a default of their own are listed; the rest,
  // which all get the shared filter (or none), are counted in a line.
  const applied = listAppliedFilters(databases, { listEach: databases.length <= COMBINED_DATABASES_IN_FULL_MAX });
  // The database just given its own filter: its box takes the cursor, after the filter it had.
  const pickedRef = useRef(null);
  const focusPicked = (dbId) => (element) => {
    if (element && pickedRef.current === dbId) {
      pickedRef.current = null;
      element.focus();
      element.setSelectionRange(element.value.length, element.value.length);
    }
  };

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
        <div className="button-row filter-toolbar-actions">
          <button type="button" className="secondary-button" onClick={() => onBrowseTerms('shared')}>
            Terms
          </button>
          {sharedFilter.isSet ? (
            <button type="button" className="secondary-button" onClick={onSharedFilterReset}>
              Clear
            </button>
          ) : null}
        </div>
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
                ref={focusPicked(dbId)}
                label={`FILTER for ${dbId}`}
                placeholder="[mister] !cheats"
                value={overrides[dbId]}
                onChange={(value) => onOverrideChange(dbId, value)}
              />
            </div>
            <div className="button-row filter-toolbar-actions">
              <button type="button" className="secondary-button" aria-label={`Terms for ${dbId}`} onClick={() => onBrowseTerms(dbId)}>
                Terms
              </button>
              <button type="button" className="secondary-button" onClick={() => onOverrideRemove(dbId)}>
                Remove
              </button>
            </div>
          </div>
        ))}
        {withoutOwnFilter.length ? (
          <OwnFilterPicker
            databases={withoutOwnFilter}
            onPick={(dbId) => {
              pickedRef.current = dbId;
              onOverrideAdd(dbId);
            }}
          />
        ) : null}
      </div>

      <ul className="effective-filter-list" aria-label="Filter applied to each database">
        {applied.listed.map((database) => {
          const { filter, source } = describeAppliedFilter(database);
          return (
            <li key={database.dbId}>
              <span className="db-chip">{database.dbId}</span>
              <code>{filter}</code>
              <span className="effective-filter-source">{source}</span>
            </li>
          );
        })}
        {applied.rest.map(({ filter, source, count }) => (
          <li key={`${source}:${filter}`} className="effective-filter-rest">
            <span className="effective-filter-count">
              {describeRest(count, { others: applied.listed.length > 0, grouped: applied.rest.length > 1 })}
            </span>
            <code>{filter}</code>
            <span className="effective-filter-source">{source}</span>
          </li>
        ))}
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
