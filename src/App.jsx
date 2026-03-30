import { useEffect, useRef, useState } from 'react';
import {
  inspectDatabaseFile,
  inspectDatabaseUrl,
  loadRuntimeDatabaseCatalog,
} from './lib/database.js';

const DATABASE_URL_PARAM = 'database-url';

export default function App() {
  const fileInputRef = useRef(null);
  const autoLoadHandledRef = useRef(false);
  const inspectionRef = useRef(null);
  const [databaseUrl, setDatabaseUrl] = useState(() => readDatabaseUrlSearchParam());
  const [loadingMessage, setLoadingMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [inspection, setInspection] = useState(null);
  const [collapsedIds, setCollapsedIds] = useState(() => new Set());
  const [databaseDetailed, setDatabaseDetailed] = useState(false);
  const [filesystemDetailed, setFilesystemDetailed] = useState(false);
  const [archivesDetailed, setArchivesDetailed] = useState(false);
  const [nodeDetailVisibility, setNodeDetailVisibility] = useState({});
  const [catalogOptions, setCatalogOptions] = useState([]);
  const [catalogStatus, setCatalogStatus] = useState('loading');
  const [catalogError, setCatalogError] = useState('');
  const [selectedCatalogKey, setSelectedCatalogKey] = useState('');

  const filesystemNodeIds = inspection ? collectTreeNodeIds(inspection.filesystemTree) : [];
  const archiveNodeIds = inspection ? collectArchiveNodeIds(inspection.archiveViews) : [];

  useEffect(() => {
    inspectionRef.current = inspection;
  }, [inspection]);

  useEffect(() => {
    if (autoLoadHandledRef.current) {
      return;
    }

    autoLoadHandledRef.current = true;
    const sharedDatabaseUrl = readDatabaseUrlSearchParam();
    if (!sharedDatabaseUrl) {
      return;
    }

    void loadRemoteDatabase(sharedDatabaseUrl, { syncSearchParam: false });
  }, []);

  useEffect(() => {
    function handlePopState() {
      const sharedDatabaseUrl = readDatabaseUrlSearchParam();
      setDatabaseUrl(sharedDatabaseUrl);
      setErrorMessage('');

      if (sharedDatabaseUrl) {
        void loadRemoteDatabase(sharedDatabaseUrl, { syncSearchParam: false });
        return;
      }

      if (inspectionRef.current?.source?.sourceKind === 'url') {
        setInspection(null);
        setCollapsedIds(new Set());
      }
    }

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadCatalog() {
      setCatalogStatus('loading');
      setCatalogError('');

      try {
        const entries = await loadRuntimeDatabaseCatalog();
        if (cancelled) {
          return;
        }

        setCatalogOptions(entries);
        setCatalogStatus('ready');
      } catch (error) {
        if (cancelled) {
          return;
        }

        setCatalogOptions([]);
        setCatalogStatus('error');
        setCatalogError(error.message);
      }
    }

    void loadCatalog();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!catalogOptions.length) {
      setSelectedCatalogKey('');
      return;
    }

    const normalizedCurrentUrl = normalizeComparableUrl(databaseUrl);
    const matchedOption = catalogOptions.find(
      (option) => normalizeComparableUrl(option.dbUrl) === normalizedCurrentUrl,
    );

    setSelectedCatalogKey(matchedOption?.key ?? '');
  }, [catalogOptions, databaseUrl]);

  async function loadFile(file) {
    if (!file) {
      return;
    }

    setLoadingMessage(`Loading ${file.name}...`);
    setErrorMessage('');

    try {
      const nextInspection = await inspectDatabaseFile(file);
      setInspection(nextInspection);
      setCollapsedIds(new Set());
      setNodeDetailVisibility({});
      setDatabaseUrl('');
      writeDatabaseUrlSearchParam('', { pushHistory: true });
    } catch (error) {
      setInspection(null);
      setErrorMessage(error.message);
    } finally {
      setLoadingMessage('');
    }
  }

  async function loadRemoteDatabase(input, { syncSearchParam = true } = {}) {
    const requestedUrl = String(input).trim();
    if (!requestedUrl) {
      setErrorMessage('Enter a database URL first.');
      return;
    }

    setLoadingMessage(`Fetching ${requestedUrl}...`);
    setErrorMessage('');

    try {
      const nextInspection = await inspectDatabaseUrl(requestedUrl);
      const sharedUrl = nextInspection.source.sourceLabel;
      setInspection(nextInspection);
      setCollapsedIds(new Set());
      setNodeDetailVisibility({});
      setDatabaseUrl(sharedUrl);
      if (syncSearchParam) {
        writeDatabaseUrlSearchParam(sharedUrl, { pushHistory: true });
      }
    } catch (error) {
      setInspection(null);
      setErrorMessage(error.message);
    } finally {
      setLoadingMessage('');
    }
  }

  async function loadUrl(event) {
    event.preventDefault();
    await loadRemoteDatabase(databaseUrl);
  }

  function handleDrop(event) {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    void loadFile(file);
  }

  function toggleNode(nodeId) {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }

  function setSectionCollapsed(nodeIds, collapsed) {
    setCollapsedIds((current) => {
      const next = new Set(current);
      for (const nodeId of nodeIds) {
        if (collapsed) {
          next.add(nodeId);
        } else {
          next.delete(nodeId);
        }
      }
      return next;
    });
  }

  function isNodeDetailsVisible(nodeId, defaultVisible) {
    if (Object.hasOwn(nodeDetailVisibility, nodeId)) {
      return nodeDetailVisibility[nodeId];
    }

    return defaultVisible;
  }

  function toggleNodeDetails(nodeId, defaultVisible) {
    setNodeDetailVisibility((current) => {
      const currentVisible = Object.hasOwn(current, nodeId) ? current[nodeId] : defaultVisible;
      const nextVisible = !currentVisible;
      const next = { ...current };

      if (nextVisible === defaultVisible) {
        delete next[nodeId];
      } else {
        next[nodeId] = nextVisible;
      }

      return next;
    });
  }

  return (
    <main className="app-shell">
      <section className="hero panel">
        <div>
          <p className="eyebrow">MiSTer Downloader</p>
          <h1>Custom Database Inspector</h1>
          <p className="hero-copy">
            Load a custom downloader database from disk or fetch it from a URL. The app inspects
            the database JSON, resolves indexed tags through the tag dictionary, follows remote
            archive summaries, and renders the filesystem and archive trees in the browser.
          </p>
        </div>
        <div className="hero-note">
          <strong>Remote fetch note</strong>
          <p>
            Database and summary URLs still need normal browser access. If the host blocks CORS,
            the inspector cannot fetch that resource from GitHub Pages.
          </p>
        </div>
      </section>

      <section className="loader-grid">
        <section
          className="panel dropzone"
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
        >
          <p className="section-label">Upload</p>
          <h2>Drag a database here</h2>
          <p>Accepted: .json, .json.zip, or any ZIP whose first JSON entry is the database.</p>
          <div className="button-row">
            <button type="button" onClick={() => fileInputRef.current?.click()}>
              Choose file
            </button>
          </div>
          <input
            ref={fileInputRef}
            className="hidden-input"
            type="file"
            accept=".json,.zip,.json.zip,application/json,application/zip"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              void loadFile(file);
            }}
          />
        </section>

        <section className="panel">
          <p className="section-label">Fetch</p>
          <h2>Open a remote database</h2>
          <form className="url-form" onSubmit={loadUrl}>
            <label className="field-label" htmlFor="database-url">
              Database URL
            </label>
            <input
              id="database-url"
              type="url"
              placeholder="https://example.com/custom-db.json.zip"
              value={databaseUrl}
              onChange={(event) => setDatabaseUrl(event.target.value)}
            />
            <button type="submit">Fetch database</button>
          </form>
          <p className="helper-copy">
            The URL must end in <code>.json</code> or <code>.json.zip</code>. Archive summary
            files are fetched automatically when present, and successful fetches update the page
            URL so you can share the inspector state directly.
          </p>
        </section>

        <section className="panel">
          <p className="section-label">Picker</p>
          <h2>Use Update_All_MiSTer catalog</h2>
          <div className="url-form">
            <label className="field-label" htmlFor="catalog-picker">
              Database picker
            </label>
            <select
              id="catalog-picker"
              value={selectedCatalogKey}
              onChange={(event) => {
                const nextKey = event.target.value;
                setSelectedCatalogKey(nextKey);
                const option = catalogOptions.find((item) => item.key === nextKey);
                if (option) {
                  setDatabaseUrl(option.dbUrl);
                }
              }}
              disabled={catalogStatus !== 'ready' || !catalogOptions.length}
            >
              <option value="">
                {catalogStatus === 'loading'
                  ? 'Loading picker options...'
                  : catalogStatus === 'error'
                    ? 'Picker unavailable'
                    : 'Select a database'}
              </option>
              {catalogOptions.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.dbId} | {option.title} | {option.dbUrl}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => {
                const option = catalogOptions.find((item) => item.key === selectedCatalogKey);
                if (option) {
                  void loadRemoteDatabase(option.dbUrl);
                }
              }}
              disabled={!selectedCatalogKey}
            >
              Open selected database
            </button>
          </div>
          {selectedCatalogKey ? (
            <div className="picker-preview">
              {(() => {
                const option = catalogOptions.find((item) => item.key === selectedCatalogKey);
                if (!option) {
                  return null;
                }

                return (
                  <dl className="metadata-list compact-metadata">
                    <div className="metadata-item">
                      <dt>db_id</dt>
                      <dd>
                        <code>{option.dbId}</code>
                      </dd>
                    </div>
                    <div className="metadata-item">
                      <dt>Title</dt>
                      <dd>{option.title}</dd>
                    </div>
                    <div className="metadata-item picker-preview-url">
                      <dt>db_url</dt>
                      <dd>
                        <a href={option.dbUrl} target="_blank" rel="noreferrer">
                          {option.dbUrl}
                        </a>
                      </dd>
                    </div>
                  </dl>
                );
              })()}
            </div>
          ) : null}
          {catalogStatus === 'loading' ? (
            <p className="helper-copy">
              Reading the current `Update_All_MiSTer/src/update_all/databases.py` catalog at
              runtime.
            </p>
          ) : null}
          {catalogStatus === 'error' ? <p className="status error">{catalogError}</p> : null}
        </section>
      </section>

      {(loadingMessage || errorMessage) && (
        <section className="panel status-panel">
          {loadingMessage ? <p className="status loading">{loadingMessage}</p> : null}
          {errorMessage ? <p className="status error">{errorMessage}</p> : null}
        </section>
      )}

      {inspection ? (
        <>
          <section className="panel overview-panel">
            <div className="overview-header">
              <div>
                <p className="section-label">Database</p>
                <h2>{inspection.overview.dbId}</h2>
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
                    detailed={databaseDetailed}
                    onDetailedChange={setDatabaseDetailed}
                  />
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
                        ? `ZIP archive -> ${inspection.source.extractedEntry}`
                        : 'Plain JSON',
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
              {databaseDetailed ? (
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

          <CollapsibleSection
            label="Filesystem"
            title="Files and folders"
            defaultOpen
            actions={
              <SectionControls
                detailed={filesystemDetailed}
                onDetailedChange={setFilesystemDetailed}
                onExpandAll={() => setSectionCollapsed(filesystemNodeIds, false)}
                onCollapseAll={() => setSectionCollapsed(filesystemNodeIds, true)}
              />
            }
          >
            {inspection.filesystemTree.children.length ? (
              <div className="tree-root">
                {inspection.filesystemTree.children.map((node) => (
                  <TreeNode
                    key={node.id}
                    node={node}
                    showDetails={filesystemDetailed}
                    areDetailsVisible={isNodeDetailsVisible}
                    collapsedIds={collapsedIds}
                    onToggle={toggleNode}
                    onToggleDetails={toggleNodeDetails}
                  />
                ))}
              </div>
            ) : (
              <EmptyState message="No top-level files or folders were found." />
            )}
          </CollapsibleSection>

          <CollapsibleSection
            label="Archives"
            title="Archive summaries"
            defaultOpen
            actions={
              <SectionControls
                detailed={archivesDetailed}
                onDetailedChange={setArchivesDetailed}
                onExpandAll={() => setSectionCollapsed(archiveNodeIds, false)}
                onCollapseAll={() => setSectionCollapsed(archiveNodeIds, true)}
              />
            }
          >
            {inspection.archiveViews.length ? (
              <div className="archive-list">
                {inspection.archiveViews.map((archive) => (
                  <ArchiveCard
                    key={archive.nodeId}
                    archive={archive}
                    showDetails={archivesDetailed}
                    areDetailsVisible={isNodeDetailsVisible}
                    collapsedIds={collapsedIds}
                    onToggle={toggleNode}
                    onToggleDetails={toggleNodeDetails}
                  />
                ))}
              </div>
            ) : (
              <EmptyState message="This database does not define any archives." />
            )}
          </CollapsibleSection>

          <CollapsibleSection
            label="Diagnostics"
            title="Issues and warnings"
            defaultOpen
          >
            {inspection.issues.length ? (
              <ul className="issue-list">
                {inspection.issues.map((issue) => (
                  <li key={issue.id} className={`issue issue-${issue.level}`}>
                    <span className="issue-level">{issue.level}</span>
                    <strong>{issue.context}</strong>
                    <span>{issue.message}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState message="No schema or path issues were detected by the browser-side inspector." />
            )}
          </CollapsibleSection>

          <section className="panel">
            <TagDictionary tags={inspection.overview.tagDictionary} />
          </section>
        </>
      ) : (
        <section className="panel empty-screen">
          <p className="section-label">Ready</p>
          <h2>No database loaded yet</h2>
          <p>
            Upload a local file or fetch a remote one to inspect the database metadata, path tree,
            archive contents, and resolved tags.
          </p>
        </section>
      )}
    </main>
  );
}

function readDatabaseUrlSearchParam() {
  if (typeof window === 'undefined') {
    return '';
  }

  const searchParams = new URLSearchParams(window.location.search);
  return searchParams.get(DATABASE_URL_PARAM) ?? '';
}

function writeDatabaseUrlSearchParam(value, { pushHistory = false } = {}) {
  if (typeof window === 'undefined') {
    return;
  }

  const currentUrl = new URL(window.location.href);
  if (value) {
    currentUrl.searchParams.set(DATABASE_URL_PARAM, value);
  } else {
    currentUrl.searchParams.delete(DATABASE_URL_PARAM);
  }

  if (currentUrl.toString() === window.location.href) {
    return;
  }

  if (pushHistory) {
    window.history.pushState({}, '', currentUrl);
  } else {
    window.history.replaceState({}, '', currentUrl);
  }
}

function normalizeComparableUrl(value) {
  try {
    return new URL(String(value).trim()).toString().toLowerCase();
  } catch {
    return '';
  }
}

function ArchiveCard({
  archive,
  showDetails,
  areDetailsVisible,
  collapsedIds,
  onToggle,
  onToggleDetails,
}) {
  const collapsed = collapsedIds.has(archive.nodeId);
  const detailsVisible = areDetailsVisible(archive.nodeId, showDetails);

  return (
    <article className="archive-card">
      <div className="tree-row">
        <button type="button" className="collapse-button" onClick={() => onToggle(archive.nodeId)}>
          {collapsed ? '+' : '-'}
        </button>
        <div className="tree-card archive-surface">
          <div className="tree-heading">
            <div className="tree-title-row">
              <span className="node-badge archive-badge">ZIP</span>
              <h3>{archive.title}</h3>
            </div>
            <div className="tree-heading-actions">
              <div className="node-action-row">
                <button
                  type="button"
                  className="inline-action-button"
                  onClick={() => onToggleDetails(archive.nodeId, showDetails)}
                >
                  {detailsVisible ? 'Hide details' : 'Show details'}
                </button>
              </div>
              <code>{archive.id}</code>
            </div>
          </div>
          <PrimaryFieldRow fields={archive.primaryFields} />
          {detailsVisible ? <MetadataList fields={archive.details} /> : null}
          {archive.issues.length ? (
            <ul className="inline-issues">
              {archive.issues.map((issue) => (
                <li key={issue.id} className={`issue issue-${issue.level}`}>
                  <span className="issue-level">{issue.level}</span>
                  <span>{issue.message}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>

      {!collapsed ? (
        archive.tree.children.length ? (
          <div className="tree-children archive-children">
            {archive.tree.children.map((node) => (
              <TreeNode
                key={node.id}
                node={node}
                showDetails={showDetails}
                areDetailsVisible={areDetailsVisible}
                collapsedIds={collapsedIds}
                onToggle={onToggle}
                onToggleDetails={onToggleDetails}
              />
            ))}
          </div>
        ) : (
          <div className="archive-empty">
            <EmptyState message="No summary entries could be rendered for this archive." />
          </div>
        )
      ) : null}
    </article>
  );
}

function TreeNode({
  node,
  showDetails,
  areDetailsVisible,
  collapsedIds,
  onToggle,
  onToggleDetails,
}) {
  const hasChildren = Array.isArray(node.children) && node.children.length > 0;
  const canCollapse = hasChildren || node.kind === 'file';
  const collapsed = collapsedIds.has(node.id);
  const detailsVisible = areDetailsVisible(node.id, showDetails);
  const bodyCollapsed = node.kind === 'file' && collapsed;

  return (
    <div className="tree-node">
      <div className="tree-row">
        {canCollapse ? (
          <button type="button" className="collapse-button" onClick={() => onToggle(node.id)}>
            {collapsed ? '+' : '-'}
          </button>
        ) : (
          <span className="collapse-spacer" />
        )}
        <div className="tree-card">
          <div className="tree-heading">
            <div className="tree-title-row">
              <span className={`node-badge ${node.kind === 'file' ? 'file-badge' : 'folder-badge'}`}>
                {node.badge}
              </span>
              <h3>{node.name}</h3>
            </div>
            <div className="tree-heading-actions">
              <div className="node-action-row">
                <button
                  type="button"
                  className="inline-action-button"
                  onClick={() => onToggleDetails(node.id, showDetails)}
                >
                  {detailsVisible ? 'Hide details' : 'Show details'}
                </button>
                {node.kind === 'file' && node.downloadUrl ? (
                  <a
                    className="download-button"
                    href={node.downloadUrl}
                    target="_blank"
                    rel="noreferrer"
                    download
                  >
                    Download
                  </a>
                ) : null}
              </div>
              <code>{node.path}</code>
            </div>
          </div>
          {!bodyCollapsed ? <PrimaryFieldRow fields={node.primaryFields} /> : null}
          {!bodyCollapsed && detailsVisible ? <MetadataList fields={node.details} /> : null}
        </div>
      </div>

      {hasChildren && !collapsed ? (
        <div className="tree-children">
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              showDetails={showDetails}
              areDetailsVisible={areDetailsVisible}
              collapsedIds={collapsedIds}
              onToggle={onToggle}
              onToggleDetails={onToggleDetails}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function HighlightCard({ label, value, subvalue, accent }) {
  return (
    <div className={`highlight-card ${accent}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {subvalue ? <small>{subvalue}</small> : null}
    </div>
  );
}

function TagDictionary({ tags }) {
  return (
    <details className="tag-dictionary">
      <summary className="dictionary-summary">
        <div>
          <p className="section-label">Tags</p>
          <h2>Tag dictionary</h2>
        </div>
        <span className="dictionary-count">{tags.length} entries</span>
      </summary>
      {tags.length ? (
        <div className="tag-cloud">
          {tags.map((tag) => (
            <span key={`${tag.name}:${tag.index}`} className="dictionary-pill">
              <strong>{tag.name}</strong>
              <span>{tag.index}</span>
            </span>
          ))}
        </div>
      ) : (
        <EmptyState message="No tag dictionary was provided." />
      )}
    </details>
  );
}

function CollapsibleSection({ label, title, defaultOpen = false, actions, children }) {
  return (
    <details className="panel collapsible-panel" open={defaultOpen}>
      <summary className="section-summary">
        <div>
          <p className="section-label">{label}</p>
          <h2>{title}</h2>
        </div>
        <span className="summary-indicator" />
      </summary>
      <div className="collapsible-content">
        {actions ? <div className="collapsible-actions">{actions}</div> : null}
        {children}
      </div>
    </details>
  );
}

function MetadataCard({ title, fields }) {
  return (
    <article className="metadata-card">
      <h3>{title}</h3>
      <MetadataList fields={fields} />
    </article>
  );
}

function PrimaryFieldRow({ fields }) {
  if (!fields.length) {
    return null;
  }

  return (
    <div className="primary-row">
      {fields.map((field, index) => (
        <div key={`${field.label}:${index}`} className="primary-pill">
          <span>{field.label}</span>
          <FieldValue field={field} />
        </div>
      ))}
    </div>
  );
}

function MetadataList({ fields }) {
  if (!fields.length) {
    return null;
  }

  return (
    <dl className="metadata-list">
      {fields.map((field, index) => (
        <div key={`${field.label}:${index}`} className="metadata-item">
          <dt>{field.label}</dt>
          <dd>
            <FieldValue field={field} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function FieldValue({ field }) {
  const value = field.value;

  if (field.kind === 'tags' && Array.isArray(value)) {
    return (
      <div className="tag-chip-list">
        {value.map((tag) => (
          <TagChip key={tag.id} tag={tag} />
        ))}
      </div>
    );
  }

  if (Array.isArray(value)) {
    return (
      <div className="chip-list">
        {value.map((item, index) => (
          <span key={`${item}:${index}`} className="mini-chip">
            {item}
          </span>
        ))}
      </div>
    );
  }

  if (field.kind === 'url' && typeof value === 'string' && value.startsWith('http')) {
    return (
      <a href={value} target="_blank" rel="noreferrer">
        {value}
      </a>
    );
  }

  if (field.kind === 'code') {
    return <code>{value}</code>;
  }

  return <span>{value}</span>;
}

function TagChip({ tag }) {
  return (
    <span
      className="tag-chip"
      data-tooltip={tag.rawLabel ? `Raw tag: ${tag.rawLabel}` : undefined}
    >
      {tag.label}
    </span>
  );
}

function EmptyState({ message }) {
  return <p className="empty-state">{message}</p>;
}

function SectionControls({
  detailed,
  onDetailedChange,
  onExpandAll,
  onCollapseAll,
}) {
  return (
    <div className="section-controls">
      <DetailedToggle detailed={detailed} onDetailedChange={onDetailedChange} />
      <div className="button-row">
        <button type="button" onClick={onExpandAll}>
          Uncollapse all
        </button>
        <button type="button" className="secondary-button" onClick={onCollapseAll}>
          Collapse all
        </button>
      </div>
    </div>
  );
}

function DetailedToggle({ detailed, onDetailedChange }) {
  return (
    <div className="toggle-group" aria-label="Detailed toggle">
      <span className="toggle-label">Detailed</span>
      <button
        type="button"
        className={!detailed ? 'toggle-chip active' : 'toggle-chip'}
        onClick={() => onDetailedChange(false)}
      >
        Off
      </button>
      <button
        type="button"
        className={detailed ? 'toggle-chip active' : 'toggle-chip'}
        onClick={() => onDetailedChange(true)}
      >
        On
      </button>
    </div>
  );
}

function collectTreeNodeIds(tree) {
  const ids = [];

  function visit(node) {
    if (!node) {
      return;
    }

    ids.push(node.id);

    if (Array.isArray(node.children) && node.children.length) {
      for (const child of node.children) {
        visit(child);
      }
    }
  }

  for (const child of tree?.children || []) {
    visit(child);
  }

  return ids;
}

function collectArchiveNodeIds(archives) {
  const ids = [];

  for (const archive of archives || []) {
    ids.push(archive.nodeId);
    ids.push(...collectTreeNodeIds(archive.tree));
  }

  return ids;
}
