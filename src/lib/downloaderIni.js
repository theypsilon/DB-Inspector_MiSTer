import { startCombinedFilters } from './combinedFilters.js';
import { NO_FILTER_DEFAULTS } from './filterDefaults.js';

// The downloader.ini that installs every loaded database at once (install_all() in the console, or
// a link with at=install-all): a section for each database loaded from a URL, in the page's order,
// with its db_url. With the filters, it holds them as downloader.ini does, the shared filter in
// [mister] and each database's own filter in its section, so Downloader gives each database the
// filter the page applies to it. Uploaded databases have no URL to install from.

export const INSTALL_ALL_ANCHOR = 'install-all';

// The loaded databases ({ inspection }) Downloader can install ({ dbId, dbUrl }), and the db_ids of
// those it cannot.
export function splitInstallableDatabases(databases) {
  const canInstall = ({ inspection }) => inspection.source.sourceKind === 'url' && Boolean(inspection.source.requestedUrl);
  return {
    installable: databases
      .filter(canInstall)
      .map(({ inspection }) => ({ dbId: inspection.overview.dbId, dbUrl: inspection.source.requestedUrl })),
    leftOut: databases.filter((database) => !canInstall(database)).map(({ inspection }) => inspection.overview.dbId),
  };
}

// The filters of the loaded databases, as combined databases hold them ({ shared, overrides }). A
// database alone has FILTER as its own filter when it differs from its default, as it keeps it when
// a second database joins.
export function sessionInstallFilters({ databases, combinedFilters, filterInput }) {
  if (databases.length !== 1) {
    return combinedFilters;
  }

  return startCombinedFilters({ inspection: databases[0].inspection, filterDefaults: NO_FILTER_DEFAULTS }, filterInput);
}

// Whether any filter would go in the file: the shared filter, or an installed database's own.
export function hasInstallFilters(installable, filters) {
  return filters.shared.isSet || installable.some(({ dbId }) => Object.hasOwn(filters.overrides, dbId));
}

// The file's text. Without `filters`, it holds the databases alone. A set filter is written even
// when empty, since an empty filter still replaces the one a database would get otherwise.
export function buildDownloaderIni(installable, filters = null) {
  const sections = [];
  if (filters?.shared.isSet) {
    sections.push(`[mister]\nfilter=${String(filters.shared.value).trim()}\n`);
  }

  for (const { dbId, dbUrl } of installable) {
    const ownFilter = filters && Object.hasOwn(filters.overrides, dbId) ? `filter=${String(filters.overrides[dbId]).trim()}\n` : '';
    sections.push(`[${dbId}]\ndb_url=${dbUrl}\n${ownFilter}`);
  }

  return sections.join('\n');
}
