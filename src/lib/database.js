import { strFromU8, unzipSync } from 'fflate';

const DISTRIBUTION_MISTER_DB_ID = 'distribution_mister';
const NO_DISTRIBUTION_MISTER_INVALID_PATHS = new Set([
  'mister',
  'menu.rbf',
  'scripts/update.sh',
]);
const INVALID_PATHS = new Set([
  'mister.ini',
  'mister_alt.ini',
  'mister_alt_1.ini',
  'mister_alt_2.ini',
  'mister_alt_3.ini',
  'mister.new',
  'downloader.ini',
]);
const INVALID_ROOT_FOLDERS = new Set(['linux', 'screenshots', 'savestates', 'downloader']);
const EXCEPTIONAL_PATHS = new Set([
  'linux',
  'linux/gamecontrollerdb',
  'linux/gamecontrollerdb/gamecontrollerdb.txt',
  'linux/gamecontrollerdb/gamecontrollerdb_user.txt',
  'yc.txt',
]);
const DISTRIBUTION_MISTER_EXCEPTIONAL_PATHS = new Set([
  'linux/pdfviewer',
  'linux/lesskey',
  'linux/glow',
]);

export async function inspectDatabaseFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const decoded = decodeJsonish(bytes, file.name);

  return inspectDatabase(decoded.json, {
    sourceKind: 'upload',
    sourceLabel: file.name,
    sourceUrl: null,
    containerType: decoded.containerType,
    extractedEntry: decoded.entryName,
  });
}

export async function inspectDatabaseUrl(input) {
  const url = normalizeDatabaseUrl(input);
  const decoded = await fetchJsonish(url);

  return inspectDatabase(decoded.json, {
    sourceKind: 'url',
    sourceLabel: url,
    sourceUrl: decoded.finalUrl,
    containerType: decoded.containerType,
    extractedEntry: decoded.entryName,
  });
}

export function formatBytes(value) {
  if (!Number.isFinite(value)) {
    return 'Unknown size';
  }

  if (value === 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const amount = value / 1024 ** exponent;
  const digits = amount >= 100 || exponent === 0 ? 0 : 1;

  return `${amount.toFixed(digits)} ${units[exponent]}`;
}

export function formatTimestamp(value) {
  if (!Number.isFinite(value)) {
    return 'Unknown timestamp';
  }

  const date = new Date(value * 1000);
  if (Number.isNaN(date.getTime())) {
    return 'Invalid timestamp';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'full',
    timeStyle: 'long',
  }).format(date);
}

function normalizeDatabaseUrl(input) {
  let parsedUrl;
  try {
    parsedUrl = new URL(String(input).trim());
  } catch {
    throw new Error('Enter an absolute URL that ends in .json or .json.zip.');
  }

  const path = parsedUrl.pathname.toLowerCase();
  if (!path.endsWith('.json') && !path.endsWith('.json.zip')) {
    throw new Error('Database URLs must end in .json or .json.zip.');
  }

  return parsedUrl.toString();
}

async function fetchJsonish(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed with ${response.status} ${response.statusText}.`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  const fallbackName = response.url.split('/').pop() || url;
  const decoded = decodeJsonish(bytes, fallbackName);

  return {
    ...decoded,
    finalUrl: response.url || url,
  };
}

function decodeJsonish(bytes, sourceName) {
  const lowerName = String(sourceName || '').toLowerCase();
  if (lowerName.endsWith('.zip') || looksLikeZip(bytes)) {
    let archive;
    try {
      archive = unzipSync(bytes);
    } catch (error) {
      throw new Error(`Could not unzip ${sourceName}: ${error.message}`);
    }

    const entries = Object.entries(archive).filter(([name]) => !name.endsWith('/'));
    if (!entries.length) {
      throw new Error(`ZIP archive ${sourceName} does not contain any files.`);
    }

    const jsonEntry =
      entries.find(([name]) => name.toLowerCase().endsWith('.json')) ?? entries[0];

    try {
      return {
        json: JSON.parse(strFromU8(jsonEntry[1])),
        containerType: 'zip',
        entryName: jsonEntry[0],
      };
    } catch (error) {
      throw new Error(`Could not parse JSON inside ${sourceName}: ${error.message}`);
    }
  }

  try {
    return {
      json: JSON.parse(strFromU8(bytes)),
      containerType: 'json',
      entryName: null,
    };
  } catch (error) {
    throw new Error(`Could not parse JSON inside ${sourceName}: ${error.message}`);
  }
}

function looksLikeZip(bytes) {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

async function inspectDatabase(rawDatabase, source) {
  if (!isPlainObject(rawDatabase)) {
    throw new Error('The loaded file does not contain a JSON object.');
  }

  const issues = [];
  const rawVersion = rawDatabase.v;
  const version = Number.isInteger(rawVersion) ? rawVersion : 0;
  const dbId = getString(rawDatabase.db_id) || '';
  const timestamp = Number(rawDatabase.timestamp);
  const files = asRecord(rawDatabase.files);
  const folders = asRecord(rawDatabase.folders);
  const archives = asRecord(rawDatabase.archives);
  const dbBaseFilesUrl = getString(rawDatabase.base_files_url);
  const tagDictionary =
    asRecord(rawDatabase.tag_dictionary) ?? asRecord(rawDatabase.tags_dictionary) ?? {};

  if (rawDatabase.tag_dictionary == null && rawDatabase.tags_dictionary != null) {
    addIssue(
      issues,
      'warning',
      'database',
      'The JSON uses `tags_dictionary`; the documented field name is `tag_dictionary`.',
    );
  }

  if (!getString(rawDatabase.db_id)) {
    addIssue(issues, 'error', 'database', '`db_id` is missing or empty.');
  }

  if (!Number.isInteger(timestamp)) {
    addIssue(issues, 'error', 'database', '`timestamp` should be a UNIX epoch integer.');
  }

  if (rawVersion == null) {
    addIssue(issues, 'info', 'database', '`v` is omitted, so the effective version is 0.');
  } else if (!Number.isInteger(rawVersion)) {
    addIssue(issues, 'warning', 'database', '`v` should be an integer.');
  } else if (rawVersion > 1) {
    addIssue(
      issues,
      'warning',
      'database',
      `Spec version ${rawVersion} is newer than the currently documented v1 format.`,
    );
  }

  if (!isPlainObject(rawDatabase.files)) {
    addIssue(issues, 'error', 'database', '`files` should be an object.');
  }

  if (!isPlainObject(rawDatabase.folders)) {
    addIssue(issues, 'error', 'database', '`folders` should be an object.');
  }

  const tagLookup = buildTagLookup(tagDictionary);

  const filesystemRecords = [
    ...Object.entries(folders).map(([path, folder]) =>
      buildFolderRecord({
        scope: 'database',
        context: 'folders',
        path,
        dbVersion: version,
        dbId,
        folder,
        tagLookup,
        issues,
      }),
    ),
    ...Object.entries(files).map(([path, file]) =>
      buildFileRecord({
        scope: 'database',
        context: 'files',
        path,
        dbVersion: version,
        dbId,
        file,
        tagLookup,
        issues,
        baseFilesUrl: dbBaseFilesUrl,
      }),
    ),
  ].filter(Boolean);

  const archiveViews = await Promise.all(
    Object.entries(archives)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([archiveId, archive]) =>
      buildArchiveView({
        archiveId,
        archive,
        dbVersion: version,
        dbId,
        databaseBaseFilesUrl: dbBaseFilesUrl,
        sourceUrl: source.sourceUrl,
        tagLookup,
        issues,
      }),
    ),
  );

  const filesystemTree = buildTreeFromRecords(filesystemRecords, 'database');
  const allTagNames = Object.entries(tagDictionary)
    .map(([tagName, tagIndex]) => ({
      name: tagName,
      index: tagIndex,
    }))
    .sort((left, right) => String(left.name).localeCompare(String(right.name)));

  return {
    source,
    issues,
    overview: {
      dbId: getString(rawDatabase.db_id) || '(missing)',
      version,
      timestamp,
      timestampLabel: formatTimestamp(timestamp),
      baseFilesUrl: dbBaseFilesUrl,
      defaultFilter: getString(rawDatabase.default_options?.filter),
      importedDatabases: Array.isArray(rawDatabase.db_files) ? rawDatabase.db_files : [],
      tagDictionary: allTagNames,
      counts: {
        files: Object.keys(files).length,
        folders: Object.keys(folders).length,
        archives: Object.keys(archives).length,
      },
    },
    filesystemTree,
    archiveViews,
  };
}

async function buildArchiveView({
  archiveId,
  archive,
  dbVersion,
  dbId,
  databaseBaseFilesUrl,
  sourceUrl,
  tagLookup,
  issues,
}) {
  const localIssues = [];
  const archiveRecord = isPlainObject(archive) ? archive : {};
  const archiveBaseFilesUrl = getString(archiveRecord.base_files_url);
  const archiveFile = isPlainObject(archiveRecord.archive_file) ? archiveRecord.archive_file : {};
  const archivePath = getString(archiveRecord.target_folder);
  const archivePathInfo = normalizeDestinationPathForDisplay(archivePath, dbVersion);

  if (!archiveId) {
    addIssue(issues, 'error', 'archive', 'An archive key is empty.');
    addIssue(localIssues, 'error', 'archive', 'Archive key is empty.');
  }

  if (archiveRecord.extract === 'all' && !archivePathInfo.displayPath) {
    addIssue(
      issues,
      'error',
      archiveId || 'archive',
      '`target_folder` is required when `extract` is `all`.',
    );
    addIssue(localIssues, 'error', archiveId || 'archive', '`target_folder` is required.');
  }

  if (archivePathInfo.displayPath) {
    validateDestinationPath(
      archivePathInfo.displayPath,
      'folder',
      dbId,
      'archives.target_folder',
      localIssues,
      archiveId || 'archive',
    );
  }

  let summary = null;
  let summarySource = 'missing';
  let loadedSummaryFile = null;

  if (isPlainObject(archiveRecord.summary_file)) {
    summarySource = 'summary_file';
    const summaryFile = archiveRecord.summary_file;
    const summaryUrl = getString(summaryFile.url);

    if (!summaryUrl) {
      addIssue(localIssues, 'error', archiveId || 'archive', '`summary_file.url` is missing.');
    } else {
      const resolvedSummaryUrl = resolveUrl(summaryUrl, sourceUrl);
      if (!resolvedSummaryUrl) {
        addIssue(
          localIssues,
          'error',
          archiveId || 'archive',
          `Could not resolve summary file URL ${summaryUrl}.`,
        );
      } else {
        loadedSummaryFile = resolvedSummaryUrl;
        try {
          const decoded = await fetchJsonish(resolvedSummaryUrl);
          summary = decoded.json;
          summarySource = decoded.containerType === 'zip' ? 'summary_file (.json.zip)' : 'summary_file (.json)';
        } catch (error) {
          addIssue(
            localIssues,
            'error',
            archiveId || 'archive',
            `Could not load summary_file: ${error.message}`,
          );
        }
      }
    }
  } else if (isPlainObject(archiveRecord.summary_inline)) {
    summary = archiveRecord.summary_inline;
    summarySource = 'summary_inline';
  } else {
    addIssue(
      localIssues,
      'error',
      archiveId || 'archive',
      'Archives need either `summary_inline` or `summary_file`.',
    );
  }

  for (const issue of localIssues) {
    addIssue(issues, issue.level, issue.context, issue.message);
  }

  const summaryFiles = asRecord(summary?.files);
  const summaryFolders = asRecord(summary?.folders);

  const summaryRecords = [
    ...Object.entries(summaryFolders).map(([path, folder]) =>
      buildArchiveFolderRecord({
        archiveId,
        path,
        dbVersion,
        dbId,
        folder,
        tagLookup,
        issues,
        localIssues,
      }),
    ),
    ...Object.entries(summaryFiles).map(([path, file]) =>
      buildArchiveFileRecord({
        archiveId,
        path,
        dbVersion,
        dbId,
        file,
        tagLookup,
        issues,
        localIssues,
        archiveBaseFilesUrl,
        databaseBaseFilesUrl,
      }),
    ),
  ].filter(Boolean);

  return {
    id: archiveId || '(empty archive id)',
    nodeId: `archive:${archiveId || 'empty'}`,
    title: archiveId || '(empty archive id)',
    summarySource,
    summaryLoadedFrom: loadedSummaryFile,
    issues: localIssues,
    primaryFields: buildPrimaryFields({
      hash: getString(archiveFile.hash),
      size: Number(archiveFile.size),
      system: detectSystem(archivePathInfo.displayPath) || detectSystemFromSummary(summaryRecords),
      tags: [],
    }),
    details: buildArchiveDetails({
      archiveRecord,
      archivePath: archivePathInfo.displayPath,
      archiveUsesLegacyExternalPath: archivePathInfo.usesLegacyExternalPath,
      archiveFile,
      summarySource,
      loadedSummaryFile,
      summaryFiles,
      summaryFolders,
      archiveBaseFilesUrl,
    }),
    tree: buildTreeFromRecords(summaryRecords, `archive:${archiveId || 'empty'}`),
  };
}

function buildArchiveDetails({
  archiveRecord,
  archivePath,
  archiveUsesLegacyExternalPath,
  archiveFile,
  summarySource,
  loadedSummaryFile,
  summaryFiles,
  summaryFolders,
  archiveBaseFilesUrl,
}) {
  return [
    { label: 'Description', value: getString(archiveRecord.description) || 'None' },
    { label: 'Format', value: getString(archiveRecord.format) || 'Unknown' },
    { label: 'Extract mode', value: getString(archiveRecord.extract) || 'Unknown' },
    { label: 'Target folder', value: archivePath || 'None', kind: 'code' },
    { label: 'Archive URL', value: getString(archiveFile.url) || 'Missing', kind: 'url' },
    { label: 'Summary source', value: summarySource },
    { label: 'Loaded summary URL', value: loadedSummaryFile || 'Not loaded', kind: 'url' },
    { label: 'Archive base_files_url', value: archiveBaseFilesUrl || 'None', kind: 'url' },
    {
      label: 'External path',
      value:
        getString(archiveRecord.path) === 'pext' || archiveUsesLegacyExternalPath
          ? 'Yes (pext)'
          : 'No',
    },
    {
      label: 'Summary counts',
      value: `${Object.keys(summaryFolders).length} folders, ${Object.keys(summaryFiles).length} files`,
    },
  ];
}

function buildFolderRecord({ scope, context, path, dbVersion, dbId, folder, tagLookup, issues }) {
  const folderRecord = isPlainObject(folder) ? folder : {};
  const pathInfo = normalizeDestinationPathForDisplay(path, dbVersion);
  validateDestinationPath(pathInfo.displayPath, 'folder', dbId, context, issues, path);

  const tagEntries = buildTagEntries(folderRecord.tags, tagLookup);

  return {
    id: `${scope}:folder:${path}`,
    kind: 'folder',
    path: pathInfo.displayPath,
    name: leafName(pathInfo.displayPath, 'folder'),
    badge: 'DIR',
    primaryFields: buildPrimaryFields({
      hash: null,
      size: null,
      system: detectSystem(pathInfo.displayPath),
      tags: tagEntries,
    }),
    details: [
      { label: 'Destination', value: pathInfo.displayPath, kind: 'code' },
      {
        label: 'External path',
        value:
          getString(folderRecord.path) === 'pext' || pathInfo.usesLegacyExternalPath
            ? 'Yes (pext)'
            : 'No',
      },
    ],
  };
}

function buildFileRecord({
  scope,
  context,
  path,
  dbVersion,
  dbId,
  file,
  tagLookup,
  issues,
  baseFilesUrl,
}) {
  const fileRecord = isPlainObject(file) ? file : {};
  const pathInfo = normalizeDestinationPathForDisplay(path, dbVersion);
  validateDestinationPath(pathInfo.displayPath, 'file', dbId, context, issues, path);

  const explicitUrl = getString(fileRecord.url);
  const resolvedUrl =
    explicitUrl || resolveBasePathUrl(baseFilesUrl, pathInfo.displayPath) || null;
  const tagEntries = buildTagEntries(fileRecord.tags, tagLookup);

  if (!resolvedUrl) {
    addIssue(
      issues,
      'error',
      path,
      `File ${path} is missing \`url\` and no top-level \`base_files_url\` is available.`,
    );
  }

  return {
    id: `${scope}:file:${path}`,
    kind: 'file',
    path: pathInfo.displayPath,
    name: leafName(pathInfo.displayPath, 'file'),
    badge: 'FILE',
    primaryFields: buildPrimaryFields({
      hash: getString(fileRecord.hash),
      size: Number(fileRecord.size),
      system: detectSystem(pathInfo.displayPath),
      tags: tagEntries,
    }),
    details: [
      { label: 'Destination', value: pathInfo.displayPath, kind: 'code' },
      ...buildDownloadDetails({
        explicitUrl,
        resolvedUrl,
        missingLabel: 'None',
      }),
      { label: 'Overwrite', value: fileRecord.overwrite === false ? 'No' : 'Yes' },
      { label: 'Reboot', value: fileRecord.reboot === true ? 'Yes' : 'No' },
      {
        label: 'External path',
        value:
          getString(fileRecord.path) === 'pext' || pathInfo.usesLegacyExternalPath
            ? 'Yes (pext)'
            : 'No',
      },
      {
        label: 'Tangle',
        value: Array.isArray(fileRecord.tangle) && fileRecord.tangle.length
          ? fileRecord.tangle
          : ['None'],
      },
    ],
  };
}

function buildArchiveFolderRecord({
  archiveId,
  path,
  dbVersion,
  dbId,
  folder,
  tagLookup,
  issues,
  localIssues,
}) {
  const folderRecord = isPlainObject(folder) ? folder : {};
  const pathInfo = normalizeDestinationPathForDisplay(path, dbVersion);
  validateDestinationPath(
    pathInfo.displayPath,
    'folder',
    dbId,
    'archives.summary_inline.folders',
    issues,
    path,
  );

  const arcId = getString(folderRecord.arc_id);
  if (arcId && arcId !== archiveId) {
    addIssue(
      issues,
      'error',
      archiveId || 'archive',
      `Archive folder ${path} has arc_id ${arcId}, expected ${archiveId}.`,
    );
    addIssue(
      localIssues,
      'error',
      archiveId || 'archive',
      `Archive folder ${path} has arc_id ${arcId}, expected ${archiveId}.`,
    );
  }

  const tagEntries = buildTagEntries(folderRecord.tags, tagLookup);

  return {
    id: `archive:${archiveId}:folder:${path}`,
    kind: 'folder',
    path: pathInfo.displayPath,
    name: leafName(pathInfo.displayPath, 'folder'),
    badge: 'DIR',
    primaryFields: buildPrimaryFields({
      hash: null,
      size: null,
      system: detectSystem(pathInfo.displayPath),
      tags: tagEntries,
    }),
    details: [
      { label: 'Destination', value: pathInfo.displayPath, kind: 'code' },
      { label: 'Archive ID', value: arcId || 'Missing', kind: 'code' },
      {
        label: 'External path',
        value:
          getString(folderRecord.path) === 'pext' || pathInfo.usesLegacyExternalPath
            ? 'Yes (pext)'
            : 'No',
      },
    ],
  };
}

function buildArchiveFileRecord({
  archiveId,
  path,
  dbVersion,
  dbId,
  file,
  tagLookup,
  issues,
  localIssues,
  archiveBaseFilesUrl,
  databaseBaseFilesUrl,
}) {
  const wrapped = isPlainObject(file) ? file : {};
  const pathInfo = normalizeDestinationPathForDisplay(path, dbVersion);
  validateDestinationPath(
    pathInfo.displayPath,
    'file',
    dbId,
    'archives.summary_inline.files',
    issues,
    path,
  );

  const arcId = getString(wrapped.arc_id);
  const arcAt = getString(wrapped.arc_at);

  if (arcId && arcId !== archiveId) {
    addIssue(
      issues,
      'error',
      archiveId || 'archive',
      `Archive file ${path} has arc_id ${arcId}, expected ${archiveId}.`,
    );
    addIssue(
      localIssues,
      'error',
      archiveId || 'archive',
      `Archive file ${path} has arc_id ${arcId}, expected ${archiveId}.`,
    );
  }

  if (arcAt) {
    validateArchiveMemberPath(arcAt, issues, archiveId || 'archive');
  } else {
    addIssue(
      issues,
      'warning',
      archiveId || 'archive',
      `Archive file ${path} is missing \`arc_at\`.`,
    );
  }

  const explicitUrl = getString(wrapped.url);
  const tagEntries = buildTagEntries(wrapped.tags, tagLookup);
  const resolvedUrl =
    explicitUrl ||
    resolveBasePathUrl(archiveBaseFilesUrl, pathInfo.displayPath) ||
    resolveBasePathUrl(databaseBaseFilesUrl, pathInfo.displayPath) ||
    null;

  return {
    id: `archive:${archiveId}:file:${path}`,
    kind: 'file',
    path: pathInfo.displayPath,
    name: leafName(pathInfo.displayPath, 'file'),
    badge: 'FILE',
    primaryFields: buildPrimaryFields({
      hash: getString(wrapped.hash),
      size: Number(wrapped.size),
      system: detectSystem(pathInfo.displayPath),
      tags: tagEntries,
    }),
    details: [
      { label: 'Destination', value: pathInfo.displayPath, kind: 'code' },
      { label: 'Archive ID', value: arcId || 'Missing', kind: 'code' },
      { label: 'Archive path', value: arcAt || 'Missing', kind: 'code' },
      ...buildDownloadDetails({
        explicitUrl,
        resolvedUrl,
        missingLabel: 'Archive-only',
      }),
      { label: 'Overwrite', value: wrapped.overwrite === false ? 'No' : 'Yes' },
      { label: 'Reboot', value: wrapped.reboot === true ? 'Yes' : 'No' },
      {
        label: 'External path',
        value:
          getString(wrapped.path) === 'pext' || pathInfo.usesLegacyExternalPath
            ? 'Yes (pext)'
            : 'No',
      },
      {
        label: 'Tangle',
        value: Array.isArray(wrapped.tangle) && wrapped.tangle.length ? wrapped.tangle : ['None'],
      },
    ],
  };
}

function buildPrimaryFields({ hash, size, system, tags }) {
  const fields = [];

  if (hash) {
    fields.push({ label: 'Hash', value: hash, kind: 'code' });
  }

  if (Number.isFinite(size)) {
    fields.push({
      label: 'Size',
      value: `${formatBytes(size)} (${size.toLocaleString()} bytes)`,
    });
  }

  if (system) {
    fields.push({ label: 'System', value: system });
  }

  if (Array.isArray(tags) && tags.length) {
    fields.push({ label: 'Tags', value: tags, kind: 'tags' });
  }

  return fields;
}

function buildTreeFromRecords(records, scope) {
  const root = {
    id: `${scope}:root`,
    childrenMap: new Map(),
  };

  for (const record of records.sort((left, right) => left.path.localeCompare(right.path))) {
    insertRecord(root, record, scope);
  }

  return finalizeBranch(root);
}

function insertRecord(root, record, scope) {
  const normalizedPath = trimTrailingSlash(record.path);
  const segments = normalizedPath.split('/').filter(Boolean);

  if (!segments.length) {
    return;
  }

  let current = root;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const isLast = index === segments.length - 1;
    const branchPath = segments.slice(0, index + 1).join('/');

    if (record.kind === 'file' && isLast) {
      current.childrenMap.set(segment, {
        id: record.id,
        kind: 'file',
        name: segment,
        path: record.path,
        badge: record.badge,
        primaryFields: record.primaryFields,
        details: record.details,
      });
      return;
    }

    let child = current.childrenMap.get(segment);
    if (!child) {
      child = {
        id: `${scope}:branch:${branchPath}`,
        kind: 'folder',
        name: segment,
        path: `${branchPath}/`,
        badge: 'DIR',
        primaryFields: [],
        details: [
          { label: 'Destination', value: `${branchPath}/`, kind: 'code' },
          { label: 'Role', value: 'Implicit parent folder' },
        ],
        childrenMap: new Map(),
      };
      current.childrenMap.set(segment, child);
    }

    if (record.kind === 'folder' && isLast) {
      child.id = record.id;
      child.path = record.path;
      child.badge = record.badge;
      child.primaryFields = record.primaryFields;
      child.details = record.details;
    }

    current = child;
  }
}

function finalizeBranch(branch) {
  const children = [...branch.childrenMap.values()]
    .map((child) =>
      child.childrenMap
        ? {
            ...child,
            children: finalizeBranch(child).children,
          }
        : child,
    )
    .sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === 'folder' ? -1 : 1;
      }

      return left.name.localeCompare(right.name);
    });

  return {
    id: branch.id,
    children,
  };
}

function buildTagLookup(dictionary) {
  const byIndex = new Map();
  const byName = new Map();

  for (const [name, index] of Object.entries(dictionary || {})) {
    const numericIndex = Number(index);
    if (!Number.isFinite(numericIndex)) {
      continue;
    }

    const bucket = byIndex.get(numericIndex) || [];
    bucket.push(name);
    byIndex.set(numericIndex, bucket);
    byName.set(normalizeTagName(name), numericIndex);
  }

  return {
    byIndex,
    byName,
  };
}

function buildTagEntries(rawTags, tagLookup) {
  if (!Array.isArray(rawTags)) {
    return [];
  }

  return rawTags.map((tag, index) => {
    if (typeof tag === 'number') {
      return {
        id: `tag:${index}:${tag}`,
        label: (tagLookup.byIndex.get(tag) || [`#${tag}`]).join(' / '),
        rawLabel: String(tag),
      };
    }

    const label = String(tag);
    const dictionaryIndex = tagLookup.byName.get(normalizeTagName(label));

    return {
      id: `tag:${index}:${label}`,
      label,
      rawLabel: dictionaryIndex == null ? null : String(dictionaryIndex),
    };
  });
}

function resolveBasePathUrl(baseUrl, path) {
  if (!baseUrl) {
    return null;
  }

  try {
    return new URL(path, ensureTrailingSlash(baseUrl)).toString();
  } catch {
    return null;
  }
}

function resolveUrl(url, baseUrl) {
  try {
    return new URL(url, baseUrl || undefined).toString();
  } catch {
    return null;
  }
}

function ensureTrailingSlash(value) {
  return value.endsWith('/') ? value : `${value}/`;
}

function normalizeTagName(value) {
  return String(value).toLowerCase().replaceAll(/[_-]/g, '');
}

function buildDownloadDetails({ explicitUrl, resolvedUrl, missingLabel }) {
  const fields = [
    {
      label: 'Download URL',
      value: resolvedUrl || missingLabel,
      kind: resolvedUrl ? 'url' : undefined,
    },
  ];

  if (explicitUrl) {
    fields.push({ label: 'URL source', value: 'Explicit `url` field' });
  } else if (resolvedUrl) {
    fields.push({ label: 'URL source', value: 'Derived from `base_files_url`' });
  }

  return fields;
}

function normalizeDestinationPathForDisplay(path, dbVersion) {
  const rawPath = typeof path === 'string' ? path : '';

  if (dbVersion === 0 && rawPath.startsWith('|')) {
    return {
      displayPath: rawPath.slice(1),
      usesLegacyExternalPath: true,
    };
  }

  return {
    displayPath: rawPath,
    usesLegacyExternalPath: false,
  };
}

function addIssue(list, level, context, message) {
  list.push({
    id: `${level}:${context}:${list.length}`,
    level,
    context,
    message,
  });
}

function validateDestinationPath(path, kind, dbId, context, issues, itemLabel) {
  const normalized = normalizeDestinationPath(path, kind, dbId);
  if (!normalized.ok) {
    addIssue(
      issues,
      'error',
      itemLabel,
      `${context} path ${path} is invalid: ${normalized.reason}.`,
    );
    return null;
  }

  return normalized.value;
}

function validateArchiveMemberPath(path, issues, context) {
  const normalized = normalizeRelativePath(path, 'file-or-folder');
  if (!normalized.ok) {
    addIssue(
      issues,
      'error',
      context,
      `Archive member path ${path} is invalid: ${normalized.reason}.`,
    );
  }

  return normalized.ok ? normalized.value : null;
}

function normalizeDestinationPath(path, kind, dbId) {
  if (typeof path !== 'string') {
    return { ok: false, reason: 'path should be a string' };
  }

  if (path === '' || path.startsWith('/') || path.startsWith('.') || path.startsWith('\\')) {
    return { ok: false, reason: 'path should be valid' };
  }

  if (kind === 'file' && path.endsWith('/')) {
    return { ok: false, reason: 'file path must not end with /' };
  }

  const trimmed = trimTrailingSlash(path);
  const lowerPath = trimmed.toLowerCase();
  const parts = lowerPath.split('/');

  if (EXCEPTIONAL_PATHS.has(lowerPath)) {
    return { ok: true, value: trimmed };
  }

  if (
    dbId === DISTRIBUTION_MISTER_DB_ID &&
    DISTRIBUTION_MISTER_EXCEPTIONAL_PATHS.has(lowerPath)
  ) {
    return { ok: true, value: trimmed };
  }

  if (INVALID_PATHS.has(lowerPath)) {
    return { ok: false, reason: 'path should not be illegal' };
  }

  if (
    dbId !== DISTRIBUTION_MISTER_DB_ID &&
    NO_DISTRIBUTION_MISTER_INVALID_PATHS.has(lowerPath)
  ) {
    return { ok: false, reason: 'path is only valid for distribution_mister' };
  }

  if (parts.length === 1 && lowerPath.startsWith('downloader_') && lowerPath.endsWith('.ini')) {
    return { ok: false, reason: 'path should not be illegal' };
  }

  if (!parts.length || parts.includes('..') || INVALID_ROOT_FOLDERS.has(parts[0])) {
    return { ok: false, reason: "path can't contain root folders" };
  }

  return { ok: true, value: trimmed };
}

function normalizeRelativePath(path, kind) {
  if (typeof path !== 'string' || path.length === 0) {
    return { ok: false, reason: 'path must not be empty' };
  }

  if (path.startsWith('/') || path.startsWith('\\') || path.startsWith('.')) {
    return { ok: false, reason: 'path must be relative' };
  }

  if (kind === 'file' && path.endsWith('/')) {
    return { ok: false, reason: 'file path must not end with /' };
  }

  const trimmed = trimTrailingSlash(path);
  if (!trimmed) {
    return { ok: false, reason: 'path must not be empty' };
  }

  const segments = trimmed.split('/');
  if (segments.some((segment) => segment.length === 0)) {
    return { ok: false, reason: 'path must not contain empty segments' };
  }

  if (segments.includes('..')) {
    return { ok: false, reason: 'path must not contain .. segments' };
  }

  return { ok: true, value: trimmed };
}

function detectSystem(path) {
  const normalized = trimTrailingSlash(getString(path) || '');
  if (!normalized) {
    return null;
  }

  const segments = normalized.split('/').filter(Boolean);
  if (segments.length < 2) {
    return segments[0] || null;
  }

  if (['games', 'docs', 'filters', 'cheats', 'config'].includes(segments[0])) {
    return segments[1] || segments[0];
  }

  return segments[0];
}

function detectSystemFromSummary(records) {
  for (const record of records) {
    const value = record.primaryFields.find((field) => field.label === 'System')?.value;
    if (value) {
      return value;
    }
  }

  return null;
}

function leafName(path, kind) {
  const normalized = trimTrailingSlash(path);
  const segments = normalized.split('/');
  const name = segments[segments.length - 1];

  if (kind === 'folder' && !name) {
    return normalized;
  }

  return name || normalized;
}

function trimTrailingSlash(path) {
  return String(path || '').replace(/\/+$/, '');
}

function getString(value) {
  return typeof value === 'string' && value.length ? value : null;
}

function asRecord(value) {
  return isPlainObject(value) ? value : {};
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
