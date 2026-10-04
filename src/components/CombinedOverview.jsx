import DetailedToggle from './ui/DetailedToggle.jsx';
import SectionAnchor from './ui/SectionAnchor.jsx';
import GitHubRepoLink from './ui/GitHubRepoLink.jsx';
import MetadataList from './ui/MetadataList.jsx';

// Several combined databases: a card for each, with the Detailed toggle for all of them.
function CombinedOverview({ databases, detailed, onDetailedChange, onInstall }) {
  return (
    <section id="section-database" className="panel overview-panel">
      <div className="overview-header">
        <div>
          <p className="section-label">Databases</p>
          <h2>
            <SectionAnchor anchor="database" />
            {databases.length} combined databases
          </h2>
        </div>
        <div className="overview-side">
          <div className="overview-controls">
            <DetailedToggle detailed={detailed} onDetailedChange={onDetailedChange} />
          </div>
        </div>
      </div>

      <div className="combined-database-grid">
        {databases.map(({ inspection }) => (
          <article key={inspection.overview.dbId} className="metadata-card combined-database-card">
            <div className="combined-database-heading">
              <h3 className="db-chip">{inspection.overview.dbId}</h3>
              <GitHubRepoLink source={inspection.source} dbId={inspection.overview.dbId} />
              {inspection.source.sourceKind === 'url' && inspection.source.requestedUrl ? (
                <button
                  type="button"
                  className="install-button"
                  onClick={() => onInstall(inspection.overview.dbId)}
                >
                  Install
                </button>
              ) : null}
            </div>
            <MetadataList
              fields={[
                { label: 'Version', value: `v${inspection.overview.version}` },
                { label: 'Timestamp', value: inspection.overview.timestampLabel },
                { label: 'Loaded from', value: inspection.source.sourceLabel, kind: 'url' },
                {
                  label: 'Counts',
                  value:
                    `${inspection.overview.counts.files.toLocaleString()} files, ` +
                    `${inspection.overview.counts.folders.toLocaleString()} folders, ` +
                    `${inspection.overview.counts.archives.toLocaleString()} archives`,
                },
                ...(detailed
                  ? [
                      { label: 'base_files_url', value: inspection.overview.baseFilesUrl || 'None', kind: 'url' },
                      { label: 'Default filter', value: inspection.overview.defaultFilter || 'None' },
                    ]
                  : []),
              ]}
            />
          </article>
        ))}
      </div>
    </section>
  );
}

export default CombinedOverview;
