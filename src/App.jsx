import { useRef, useState } from 'react';
import {
  inspectDatabaseFile,
  inspectDatabaseUrl,
} from './lib/database.js';

export default function App() {
  const fileInputRef = useRef(null);
  const [databaseUrl, setDatabaseUrl] = useState('');
  const [loadingMessage, setLoadingMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [inspection, setInspection] = useState(null);
  const [collapsedIds, setCollapsedIds] = useState(() => new Set());

  const branchIds = inspection ? collectBranchIds(inspection) : [];

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
    } catch (error) {
      setInspection(null);
      setErrorMessage(error.message);
    } finally {
      setLoadingMessage('');
    }
  }

  async function loadUrl(event) {
    event.preventDefault();
    if (!databaseUrl.trim()) {
      setErrorMessage('Enter a database URL first.');
      return;
    }

    setLoadingMessage(`Fetching ${databaseUrl}...`);
    setErrorMessage('');

    try {
      const nextInspection = await inspectDatabaseUrl(databaseUrl);
      setInspection(nextInspection);
      setCollapsedIds(new Set());
    } catch (error) {
      setInspection(null);
      setErrorMessage(error.message);
    } finally {
      setLoadingMessage('');
    }
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

  function expandAll() {
    setCollapsedIds(new Set());
  }

  function collapseAll() {
    setCollapsedIds(new Set(branchIds));
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
            files are fetched automatically when present.
          </p>
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
            </div>

            <TagDictionary tags={inspection.overview.tagDictionary} />
          </section>

          <section className="panel">
            <div className="section-heading">
              <div>
                <p className="section-label">Controls</p>
                <h2>Tree visibility</h2>
              </div>
              <div className="button-row">
                <button type="button" onClick={expandAll}>
                  Expand all
                </button>
                <button type="button" className="secondary-button" onClick={collapseAll}>
                  Collapse all
                </button>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="section-heading">
              <div>
                <p className="section-label">Filesystem</p>
                <h2>Files and folders</h2>
              </div>
            </div>
            {inspection.filesystemTree.children.length ? (
              <div className="tree-root">
                {inspection.filesystemTree.children.map((node) => (
                  <TreeNode
                    key={node.id}
                    node={node}
                    collapsedIds={collapsedIds}
                    onToggle={toggleNode}
                  />
                ))}
              </div>
            ) : (
              <EmptyState message="No top-level files or folders were found." />
            )}
          </section>

          <section className="panel">
            <div className="section-heading">
              <div>
                <p className="section-label">Archives</p>
                <h2>Archive summaries</h2>
              </div>
            </div>
            {inspection.archiveViews.length ? (
              <div className="archive-list">
                {inspection.archiveViews.map((archive) => (
                  <ArchiveCard
                    key={archive.nodeId}
                    archive={archive}
                    collapsedIds={collapsedIds}
                    onToggle={toggleNode}
                  />
                ))}
              </div>
            ) : (
              <EmptyState message="This database does not define any archives." />
            )}
          </section>

          <section className="panel">
            <div className="section-heading">
              <div>
                <p className="section-label">Diagnostics</p>
                <h2>Issues and warnings</h2>
              </div>
            </div>
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

function ArchiveCard({ archive, collapsedIds, onToggle }) {
  const collapsed = collapsedIds.has(archive.nodeId);

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
            <code>{archive.id}</code>
          </div>
          <PrimaryFieldRow fields={archive.primaryFields} />
          <MetadataList fields={archive.details} />
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
                collapsedIds={collapsedIds}
                onToggle={onToggle}
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

function TreeNode({ node, collapsedIds, onToggle }) {
  const hasChildren = Array.isArray(node.children) && node.children.length > 0;
  const collapsed = collapsedIds.has(node.id);

  return (
    <div className="tree-node">
      <div className="tree-row">
        {hasChildren ? (
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
            <code>{node.path}</code>
          </div>
          <PrimaryFieldRow fields={node.primaryFields} />
          <MetadataList fields={node.details} />
        </div>
      </div>

      {hasChildren && !collapsed ? (
        <div className="tree-children">
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              collapsedIds={collapsedIds}
              onToggle={onToggle}
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
    <section className="tag-dictionary">
      <div className="section-heading compact-heading">
        <div>
          <p className="section-label">Tags</p>
          <h2>Tag dictionary</h2>
        </div>
      </div>
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
    </section>
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

function EmptyState({ message }) {
  return <p className="empty-state">{message}</p>;
}

function collectBranchIds(inspection) {
  const ids = [];

  function visit(node) {
    if (!node) {
      return;
    }

    if (Array.isArray(node.children) && node.children.length) {
      ids.push(node.id);
      for (const child of node.children) {
        visit(child);
      }
    }
  }

  visit(inspection.filesystemTree);
  for (const archive of inspection.archiveViews) {
    ids.push(archive.nodeId);
    visit(archive.tree);
  }

  return ids;
}
