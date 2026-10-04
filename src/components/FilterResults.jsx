import InfoHint from './ui/InfoHint.jsx';
import { formatBytes } from '../lib/database.js';
import { CLUSTER_SIZE_OPTIONS, CLUSTER_SIZE_TIP, buildRawByteHoverCopy } from '../lib/utils.js';

// What the filters leave: counts, and the size it would take at the chosen cluster size.
function FilterResults({ filterPending, summary, storageSummary, clusterSizeBytes, onClusterSizeChange }) {
  return (
    <p className="catalog-count-inline disk-usage-inline">
      {filterPending ? (
        'Updating preview...'
      ) : (
        <>
          <span>{summary}</span>
          {storageSummary ? (
            <>
              <span>Size:</span>
              <InfoHint className="disk-usage-value" tip={buildRawByteHoverCopy(storageSummary)}>
                {formatBytes(storageSummary.clusteredBytes)}
              </InfoHint>
              <span>at</span>
              <select
                aria-label="Cluster size"
                className="cluster-size-select"
                value={clusterSizeBytes}
                onChange={(event) => onClusterSizeChange(Number(event.target.value))}
              >
                {CLUSTER_SIZE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {formatBytes(option)}
                  </option>
                ))}
              </select>
              <span>clusters.</span>
              <InfoHint label="Cluster size info" tip={CLUSTER_SIZE_TIP}>
                &#9432;
              </InfoHint>
            </>
          ) : null}
        </>
      )}
    </p>
  );
}

export default FilterResults;
