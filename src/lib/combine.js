import { buildTreeFromRecords } from './database.js';

// Combines the filtered views of several databases into one view. Their files, folders and
// archives are shown side by side, except for collisions: paths that more than one database would
// install, compared ignoring letter case, including archive summary files and files that another
// database needs as a folder. Collided files are listed on their own, with every version, instead
// of in the other sections.
//
// `entries` is [{ dbId, view }] in load order, where `view` is the database's inspection after its
// own filter (see applyInspectionFilter).
export function combineDatabaseViews(entries) {
  const fileVersionsByKey = new Map();
  const folderKeysByDbId = new Map();

  for (const { dbId, view } of entries) {
    const folderKeys = new Set();
    const addFile = (record, origin, archive = null) => {
      const key = pathKey(record.path);
      const versions = fileVersionsByKey.get(key) ?? [];
      versions.push({ dbId, origin, archiveId: archive?.id ?? null, record });
      fileVersionsByKey.set(key, versions);
      for (const parentKey of parentKeys(key)) {
        folderKeys.add(parentKey);
      }
    };

    for (const record of view.filesystemRecords) {
      if (record.kind === 'file') {
        addFile(record, 'files');
      } else {
        folderKeys.add(pathKey(record.path));
      }
    }

    for (const archive of view.archiveViews) {
      for (const record of archive.summaryRecords ?? []) {
        if (record.kind === 'file') {
          addFile(record, 'archive', archive);
        } else {
          folderKeys.add(pathKey(record.path));
        }
      }
    }

    folderKeysByDbId.set(dbId, folderKeys);
  }

  const collisions = [];
  const collidedRecords = new Set();
  for (const [key, fileVersions] of fileVersionsByKey) {
    const fileDbIds = new Set(fileVersions.map((version) => version.dbId));
    const folderVersions = entries
      .filter(({ dbId }) => !fileDbIds.has(dbId) && folderKeysByDbId.get(dbId).has(key))
      .map(({ dbId }) => ({ dbId, origin: 'folder', archiveId: null, record: null }));
    if (fileDbIds.size < 2 && !folderVersions.length) {
      continue;
    }

    for (const version of fileVersions) {
      collidedRecords.add(version.record);
    }

    collisions.push({
      key,
      path: trimTrailingSlash(fileVersions[0].record.path),
      identical: !folderVersions.length && areIdenticalFiles(fileVersions),
      dbIds: entries.map(({ dbId }) => dbId).filter((dbId) => fileDbIds.has(dbId) || folderVersions.some((version) => version.dbId === dbId)),
      versions: [...fileVersions, ...folderVersions].sort(
        (left, right) => dbOrder(entries, left.dbId) - dbOrder(entries, right.dbId),
      ),
    });
  }
  collisions.sort((left, right) => left.path.localeCompare(right.path));

  const filesystemRecords = entries.flatMap(({ dbId, view }) =>
    view.filesystemRecords
      .filter((record) => !collidedRecords.has(record))
      .map((record) => ({ ...record, dbId })),
  );

  const archiveViews = entries.flatMap(({ dbId, view }) =>
    view.archiveViews.map((archive) => {
      const nodeId = `archive[${dbId}]:${archive.id}`;
      const summaryRecords = (archive.summaryRecords ?? [])
        .filter((record) => !collidedRecords.has(record))
        .map((record) => ({ ...record, id: scopeArchiveRecordId(record.id, archive.id, dbId), dbId }));
      return {
        ...archive,
        dbId,
        nodeId,
        summaryRecords,
        tree: buildTreeFromRecords([...summaryRecords], nodeId),
      };
    }),
  );

  const issues = [
    ...(collisions.length ? [buildCollisionIssue(collisions)] : []),
    ...entries.flatMap(({ dbId, view }) =>
      view.issues.map((issue) => ({ ...issue, id: `${dbId}:${issue.id}`, dbId })),
    ),
  ];

  return {
    databases: entries,
    filesystemRecords,
    filesystemTree: buildTreeFromRecords([...filesystemRecords], 'database', { caseInsensitive: true }),
    archiveViews,
    collisions,
    issues,
    resultCounts: countCombinedRecords(filesystemRecords, archiveViews, collisions),
    isFiltering: entries.some(({ view }) => view.activeFilter?.isFiltering),
    // Every installed path counts once for the size estimate: collided paths at their largest version.
    storageView: {
      filesystemRecords: [...filesystemRecords, ...collisions.map(buildCollisionSizeRecord)],
      archiveViews,
    },
  };
}

function pathKey(path) {
  return trimTrailingSlash(String(path)).toLowerCase();
}

function parentKeys(key) {
  const segments = key.split('/');
  return segments.slice(1).map((_, index) => segments.slice(0, index + 1).join('/'));
}

function trimTrailingSlash(path) {
  return path.endsWith('/') ? path.slice(0, -1) : path;
}

function dbOrder(entries, dbId) {
  return entries.findIndex((entry) => entry.dbId === dbId);
}

function areIdenticalFiles(fileVersions) {
  const [first] = fileVersions;
  return fileVersions.every(
    ({ record }) =>
      record.hash &&
      Number.isFinite(record.sizeBytes) &&
      record.hash.toLowerCase() === first.record.hash?.toLowerCase() &&
      record.sizeBytes === first.record.sizeBytes,
  );
}

// Archive summary record ids start with `archive:<archiveId>:`; combined views scope them by
// database, as `archive[<dbId>]:<archiveId>:`, since archive ids are only unique per database.
function scopeArchiveRecordId(recordId, archiveId, dbId) {
  const prefix = `archive:${archiveId}:`;
  return recordId.startsWith(prefix)
    ? `archive[${dbId}]:${archiveId}:${recordId.slice(prefix.length)}`
    : `archive[${dbId}]:${recordId}`;
}

function buildCollisionIssue(collisions) {
  const dbIds = [...new Set(collisions.flatMap((collision) => collision.dbIds))];
  const identicalCount = collisions.filter((collision) => collision.identical).length;
  const pathCount = collisions.length === 1 ? '1 path is' : `${collisions.length} paths are`;
  const identical = identicalCount ? ` (${identicalCount} with identical copies)` : '';
  return {
    id: 'collisions',
    level: 'warning',
    context: 'collisions',
    message:
      `${pathCount} claimed by more than one database${identical}: ${dbIds.join(', ')}. ` +
      'They are listed under Path collisions instead of the other sections.',
  };
}

function buildCollisionSizeRecord(collision) {
  const sizes = collision.versions
    .map((version) => version.record?.sizeBytes)
    .filter((size) => Number.isFinite(size));
  return {
    kind: 'file',
    path: collision.path,
    sizeBytes: sizes.length ? Math.max(...sizes) : null,
  };
}

function countCombinedRecords(filesystemRecords, archiveViews, collisions) {
  const summaryRecords = archiveViews.flatMap((archive) => archive.summaryRecords);
  const folderKeys = new Set(
    [...filesystemRecords, ...summaryRecords]
      .filter((record) => record.kind === 'folder')
      .map((record) => pathKey(record.path)),
  );
  const fileCount = [...filesystemRecords, ...summaryRecords].filter((record) => record.kind === 'file').length;

  return {
    files: fileCount + collisions.length,
    folders: folderKeys.size,
    archives: archiveViews.length,
  };
}

// The collided paths as tree nodes: one per path, with a child per version (each database's file,
// or the folder a database needs at that path).
export function buildCollisionTree(collisions) {
  return {
    id: 'collision:root',
    children: collisions.map((collision) => ({
      id: `collision:${collision.key}`,
      kind: 'collision',
      name: leafName(collision.path),
      path: collision.path,
      badge: 'PATH',
      downloadUrl: null,
      primaryFields: [
        {
          label: collision.identical ? 'Identical copies' : 'Different versions',
          value: collision.dbIds.join(', '),
        },
      ],
      details: [
        { label: 'Destination', value: collision.path, kind: 'code' },
        { label: 'Claimed by', value: collision.dbIds.join(', ') },
      ],
      children: collision.versions.map((version, index) => buildCollisionVersionNode(collision, version, index)),
    })),
  };
}

function buildCollisionVersionNode(collision, version, index) {
  const id = `collision-version:${index}:${collision.key}`;
  if (version.origin === 'folder') {
    return {
      id,
      kind: 'folder',
      name: leafName(collision.path),
      path: `${collision.path}/`,
      badge: 'DIR',
      downloadUrl: null,
      dbId: version.dbId,
      primaryFields: [],
      details: [{ label: 'Claimed as', value: 'Folder, needed by other paths of this database' }],
      children: [],
    };
  }

  const { record } = version;
  return {
    id,
    kind: 'file',
    name: record.name,
    path: record.path,
    badge: record.badge,
    downloadUrl: record.downloadUrl,
    dbId: version.dbId,
    primaryFields: record.primaryFields,
    details: [
      {
        label: 'Claimed by',
        value: version.origin === 'archive' ? `Archive ${version.archiveId}` : 'Database files',
      },
      ...record.details,
    ],
  };
}

function leafName(path) {
  return path.split('/').pop();
}
