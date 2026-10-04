import CollapsibleSection from './ui/CollapsibleSection.jsx';
import DetailedToggle from './ui/DetailedToggle.jsx';
import SectionAnchor from './ui/SectionAnchor.jsx';
import GitHubRepoLink from './ui/GitHubRepoLink.jsx';
import MetadataList from './ui/MetadataList.jsx';
import { COMBINED_DATABASES_IN_FULL_MAX, readThroughFields } from '../lib/utils.js';

// Up to COMBINED_DATABASES_IN_FULL_MAX combined databases show as cards. More show as a compact
// list in columns, a row each that opens on its own, in a section that collapses. A row shows only
// what tells it apart (its db_id, in full in its tooltip when cut short, and its counts), so the
// whole row opens it; its links and buttons are inside.

function formatCounts(counts) {
  return (
    `${counts.files.toLocaleString()} files, ` +
    `${counts.folders.toLocaleString()} folders, ` +
    `${counts.archives.toLocaleString()} archives`
  );
}

// What a database's card shows, and what its row in the compact list opens to.
function databaseFields(inspection, detailed) {
  return [
    { label: 'Version', value: `v${inspection.overview.version}` },
    { label: 'Timestamp', value: inspection.overview.timestampLabel },
    { label: 'Loaded from', value: inspection.source.sourceLabel, kind: 'url' },
    ...readThroughFields(inspection.source),
    { label: 'Counts', value: formatCounts(inspection.overview.counts) },
    ...(detailed
      ? [
          { label: 'base_files_url', value: inspection.overview.baseFilesUrl || 'None', kind: 'url' },
          { label: 'Default filter', value: inspection.overview.defaultFilter || 'None' },
        ]
      : []),
  ];
}

// A db_id that can break after its _ and / separators, as a long one must on a narrow screen.
function breakableId(id) {
  return id.split(/(?<=[_/])/).flatMap((part, index) => (index ? [<wbr key={index} />, part] : [part]));
}

// Databases loaded from a URL can be installed; uploads cannot.
function InstallButton({ inspection, onInstall }) {
  if (inspection.source.sourceKind !== 'url' || !inspection.source.requestedUrl) {
    return null;
  }

  return (
    <button type="button" className="install-button" onClick={() => onInstall(inspection.overview.dbId)}>
      Install
    </button>
  );
}

/**
 * Several combined databases: a card for each, or a compact list when there are many, with the
 * Detailed toggle for all of them.
 * @param {{
 *   databases: { inspection: any }[],
 *   detailed: boolean,
 *   onDetailedChange: (detailed: boolean) => void,
 *   onInstall: (dbId: string) => void,
 * }} props
 */
function CombinedOverview({ databases, detailed, onDetailedChange, onInstall }) {
  const title = `${databases.length} combined databases`;
  // In the compact list it sits in the section's summary, so it stays at hand while collapsed.
  const toggle = (
    <div className="overview-controls">
      <DetailedToggle detailed={detailed} onDetailedChange={onDetailedChange} />
    </div>
  );

  if (databases.length > COMBINED_DATABASES_IN_FULL_MAX) {
    return (
      <CollapsibleSection
        label="Databases"
        title={title}
        defaultOpen
        anchor="database"
        className="combined-overview-panel"
        summaryAside={toggle}
      >
        <ul className="combined-database-list">
          {databases.map(({ inspection }) => (
            <li key={inspection.overview.dbId}>
              <details className="combined-database-card combined-database-row">
                <summary className="combined-database-row-summary">
                  <h3 className="db-chip" title={inspection.overview.dbId}>
                    {breakableId(inspection.overview.dbId)}
                  </h3>
                  <span className="combined-database-row-counts">{formatCounts(inspection.overview.counts)}</span>
                </summary>
                <div className="combined-database-row-body">
                  <div className="combined-database-row-actions">
                    <InstallButton inspection={inspection} onInstall={onInstall} />
                    <GitHubRepoLink source={inspection.source} dbId={inspection.overview.dbId} />
                  </div>
                  <MetadataList fields={databaseFields(inspection, detailed)} />
                </div>
              </details>
            </li>
          ))}
        </ul>
      </CollapsibleSection>
    );
  }

  return (
    <section id="section-database" className="panel overview-panel">
      <div className="overview-header">
        <div>
          <p className="section-label">Databases</p>
          <h2>
            <SectionAnchor anchor="database" />
            {title}
          </h2>
        </div>
        <div className="overview-side">{toggle}</div>
      </div>

      <div className="combined-database-grid">
        {databases.map(({ inspection }) => (
          <article key={inspection.overview.dbId} className="metadata-card combined-database-card">
            <div className="combined-database-heading">
              <h3 className="db-chip">{breakableId(inspection.overview.dbId)}</h3>
              <GitHubRepoLink source={inspection.source} dbId={inspection.overview.dbId} />
              <InstallButton inspection={inspection} onInstall={onInstall} />
            </div>
            <MetadataList fields={databaseFields(inspection, detailed)} />
          </article>
        ))}
      </div>
    </section>
  );
}

export default CombinedOverview;
