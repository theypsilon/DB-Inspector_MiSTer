import CollapsibleSection from './ui/CollapsibleSection.jsx';
import FilterInput from './FilterInput.jsx';
import FilterHelp from './FilterHelp.jsx';
import FilterResults from './FilterResults.jsx';
import { buildFilterSummaryCopy } from '../lib/utils.js';

// The FILTER box of a single database, its help text, and the resulting counts and size estimate.
function FilterPanel({
  filterInput,
  onFilterInputChange,
  canReset,
  onReset,
  hasEssentialHint,
  hasUntaggedItems,
  onSearchEssential,
  defaultFilter,
  filterPending,
  activeFilter,
  storageSummary,
  clusterSizeBytes,
  onClusterSizeChange,
}) {
  return (
    <CollapsibleSection
      label="FILTER"
      title="Enter terms to filter by"
      defaultOpen
      className="filter-panel"
      anchor="filter"
    >
      <div className="filter-toolbar">
        <div className="catalog-search">
          <FilterInput id="inspection-filter" label="FILTER" value={filterInput} onChange={onFilterInputChange} />
        </div>
        {canReset ? (
          <button
            type="button"
            className="secondary-button"
            onClick={onReset}
          >
            Clear
          </button>
        ) : null}
      </div>
      <FilterHelp
        hasEssentialHint={hasEssentialHint}
        hasUntaggedItems={hasUntaggedItems}
        onSearchEssential={onSearchEssential}
      />
      {defaultFilter ? (
        <p className="helper-copy">
          Database default: <code>{defaultFilter}</code>.
        </p>
      ) : null}
      <FilterResults
        filterPending={filterPending}
        summary={buildFilterSummaryCopy(activeFilter)}
        storageSummary={storageSummary}
        clusterSizeBytes={clusterSizeBytes}
        onClusterSizeChange={onClusterSizeChange}
      />
    </CollapsibleSection>
  );
}

export default FilterPanel;
