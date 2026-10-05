import { CloseIcon } from './ExplorerIcons.jsx';
import ImagePreview from '../ui/ImagePreview.jsx';
import TagList from '../ui/TagList.jsx';
import { formatBytes } from '../../lib/database.js';
import { getFileLinks, getImagePreviewUrl, triggerFileDownload } from '../../lib/downloads.js';

/**
 * What the explorer knows of the file or folder selected, or of the folder shown when nothing is:
 * beside the list, or over its lower part on phones.
 * @param {{
 *   entry: import('../../lib/explorer.js').ExplorerEntry,
 *   folder: import('../../lib/explorer.js').ExplorerFolder,
 *   onClose: () => void,
 *   onOpenFolder: (folder: import('../../lib/explorer.js').ExplorerFolder) => void,
 *   onDownloadError?: (error: any) => void,
 * }} props
 */
export default function ExplorerDetails({ entry, folder, onClose, onOpenFolder, onDownloadError }) {
  return (
    <aside className="explorer-details" aria-label={`Details of ${entry.name}`}>
      <div className="explorer-details-head">
        <h3>{entry.name}</h3>
        <button type="button" className="explorer-icon-button" aria-label="Close details" title="Close details" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>
      {entry.kind === 'folder' ? (
        <FolderDetails folder={entry} isShown={entry === folder} onOpenFolder={onOpenFolder} />
      ) : (
        <FileDetails file={entry} onDownloadError={onDownloadError} />
      )}
    </aside>
  );
}

function FolderDetails({ folder, isShown, onOpenFolder }) {
  const files = `${folder.fileCount.toLocaleString()} ${folder.fileCount === 1 ? 'file' : 'files'}`;
  const summary = [folder.parent ? 'Folder' : 'SD card', folder.fileCount ? files : 'no files'];
  if (folder.fileCount) {
    summary.push(formatBytes(folder.sizeBytes));
  }
  const tags = mergeTags(folder.origins.map(({ record }) => recordTags(record)));

  return (
    <>
      <p className="explorer-details-summary">{summary.join(' · ')}</p>
      <dl className="explorer-facts">
        {folder.parent ? <Fact label="Path"><code>{folder.path}</code></Fact> : null}
        {folder.origins.length ? <Fact label="From"><Origins origins={folder.origins} /></Fact> : null}
        {tags.length ? <Fact label="Tags"><TagList tags={tags} view="all" /></Fact> : null}
      </dl>
      {isShown ? null : (
        <div className="explorer-details-actions">
          <button type="button" className="inline-action-button" onClick={() => onOpenFolder(folder)}>
            Open folder
          </button>
        </div>
      )}
    </>
  );
}

function FileDetails({ file, onDownloadError }) {
  if (file.versions.length === 1) {
    const [version] = file.versions;
    return (
      <>
        <p className="explorer-details-summary">{`File · ${formatBytes(file.sizeBytes)}`}</p>
        <dl className="explorer-facts">
          <Fact label="Path"><code>{file.path}</code></Fact>
          <VersionFacts version={version} />
        </dl>
        <FileActions name={file.name} record={version.record} onDownloadError={onDownloadError} />
        <VersionImage name={file.name} record={version.record} />
      </>
    );
  }

  // A path several databases (or a database and its archives) install: each version in turn.
  const copies = file.identical ? 'identical copies' : 'different versions';
  return (
    <>
      <p className="explorer-details-summary">{`File · ${file.versions.length} ${copies}`}</p>
      <dl className="explorer-facts">
        <Fact label="Path"><code>{file.path}</code></Fact>
      </dl>
      {file.versions.map((version, index) => (
        <section key={index} className="explorer-version" aria-label={`Version ${index + 1}`}>
          <dl className="explorer-facts">
            <Fact label="Size">{formatBytes(version.record.sizeBytes)}</Fact>
            <VersionFacts version={version} />
          </dl>
          <FileActions name={file.name} record={version.record} onDownloadError={onDownloadError} />
          <VersionImage name={file.name} record={version.record} />
        </section>
      ))}
    </>
  );
}

function VersionFacts({ version }) {
  const tags = recordTags(version.record);
  return (
    <>
      <Fact label="From"><Origins origins={[version]} /></Fact>
      {version.record.hash ? <Fact label="Hash"><code>{version.record.hash}</code></Fact> : null}
      {tags.length ? <Fact label="Tags"><TagList tags={tags} view="all" /></Fact> : null}
      {version.record.downloadUrl ? (
        <Fact label="URL">
          <a href={version.record.downloadUrl} target="_blank" rel="noreferrer">{version.record.downloadUrl}</a>
        </Fact>
      ) : null}
    </>
  );
}

function FileActions({ name, record, onDownloadError }) {
  const { downloadUrl, openUrl } = getFileLinks(record);
  if (!downloadUrl) {
    return null;
  }

  const handleDownload = () => {
    triggerFileDownload(downloadUrl, name).catch((error) => {
      onDownloadError?.({ url: downloadUrl, ...(error && typeof error === 'object' ? error : {}) });
    });
  };

  return (
    <div className="explorer-details-actions">
      {openUrl ? (
        <a className="inline-action-button open-button" href={openUrl} target="_blank" rel="noreferrer">
          OPEN
        </a>
      ) : null}
      <button type="button" className="download-button" onClick={handleDownload}>
        Download
      </button>
    </div>
  );
}

// An image, under its details: as wide as they are at most, and no larger than itself. Each URL
// loads afresh.
function VersionImage({ name, record }) {
  const url = getImagePreviewUrl(record);
  return url ? <ImagePreview key={url} className="explorer-preview" name={name} url={url} /> : null;
}

function Fact({ label, children }) {
  return (
    <div className="explorer-fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

// Where entries come from: the database's files and folders, or an archive, each after its
// database when databases are combined. Each place once.
function Origins({ origins }) {
  const seen = new Set();
  const places = origins.filter(({ dbId, archiveId }) => {
    const key = `${dbId ?? ''}\u0000${archiveId ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return (
    <ul className="explorer-origins">
      {places.map(({ dbId, archiveId }) => (
        <li key={`${dbId ?? ''}:${archiveId ?? ''}`}>
          {dbId ? <><span className="db-chip" title={dbId}>{dbId}</span>{' '}</> : null}
          <span>{archiveId ? `Archive ${archiveId}` : 'Database files'}</span>
        </li>
      ))}
    </ul>
  );
}

function recordTags(record) {
  const field = record?.primaryFields?.find((candidate) => candidate.kind === 'tags');
  return Array.isArray(field?.value) ? field.value : [];
}

// A folder declared in several places shows each tag once. Tag ids are only unique within a record,
// so the merged list numbers its own.
function mergeTags(tagLists) {
  const seen = new Set();
  return tagLists
    .flat()
    .filter((tag) => {
      if (seen.has(tag.label)) return false;
      seen.add(tag.label);
      return true;
    })
    .map((tag, index) => ({ ...tag, id: `folder-tag:${index}` }));
}
