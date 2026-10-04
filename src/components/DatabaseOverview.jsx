import HighlightCard from './ui/HighlightCard.jsx';
import MetadataCard from './ui/MetadataCard.jsx';
import DetailedToggle from './ui/DetailedToggle.jsx';
import SectionAnchor from './ui/SectionAnchor.jsx';
import GitHubRepoLink from './ui/GitHubRepoLink.jsx';

// The loaded database: its identity, source, counts and options, with the Detailed toggle and
// the Install button.
function DatabaseOverview({ inspection, detailed, onDetailedChange, onInstall }) {
  return (
    <section id="section-database" className="panel overview-panel">
      <div className="overview-header">
        <div>
          <p className="section-label">Database</p>
          <h2>
            <SectionAnchor anchor="database" />
            {inspection.overview.dbId}
          </h2>
          <GitHubRepoLink source={inspection.source} dbId={inspection.overview.dbId} />
        </div>
        <div className="overview-side">
          <div className="highlight-row">
            <HighlightCard
              label="Version"
              value={`v${inspection.overview.version}`}
              accent="version"
            />
            <HighlightCard
              label="Timestamp"
              value={inspection.overview.timestampLabel}
              subvalue={`Epoch ${inspection.overview.timestamp}`}
              accent="timestamp"
            />
          </div>
          <div className="overview-controls">
            <DetailedToggle
              detailed={detailed}
              onDetailedChange={onDetailedChange}
            />
            {inspection.source.sourceKind === 'url' && inspection.source.requestedUrl ? (
              <button
                type="button"
                className="install-button"
                onClick={onInstall}
              >
                Install
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="overview-grid">
        <MetadataCard
          title="Source"
          fields={[
            { label: 'Loaded from', value: inspection.source.sourceLabel, kind: 'url' },
            {
              label: 'Container',
              value:
                inspection.source.containerType === 'zip'
                  ? `ZIP file (${inspection.source.extractedEntry})`
                  : 'JSON file',
            },
          ]}
        />
        <MetadataCard
          title="Counts"
          fields={[
            { label: 'Files', value: inspection.overview.counts.files.toLocaleString() },
            { label: 'Folders', value: inspection.overview.counts.folders.toLocaleString() },
            {
              label: 'Archives',
              value: inspection.overview.counts.archives.toLocaleString(),
            },
          ]}
        />
        {detailed ? (
          <MetadataCard
            title="Options"
            fields={[
              {
                label: 'base_files_url',
                value: inspection.overview.baseFilesUrl || 'None',
                kind: 'url',
              },
              {
                label: 'Default filter',
                value: inspection.overview.defaultFilter || 'None',
              },
              {
                label: 'Imported db_files',
                value: inspection.overview.importedDatabases.length
                  ? inspection.overview.importedDatabases
                  : ['None'],
              },
            ]}
          />
        ) : null}
      </div>
    </section>
  );
}

export default DatabaseOverview;
