import { resolveInheritedFilterValue } from './database.js';

// Default FILTER resolution, following Downloader's build_db_config. Precedence: the INI entry
// `filter`, then the database `default_options.filter` (only when [mister] sets no filter, or when
// that default inherits [mister]), then the INI `[mister]` filter.

// The filter defaults a loaded source contributes, before the database's own default is known.
export const NO_FILTER_DEFAULTS = Object.freeze({
  sourceDefaultFilter: '',
  sourceDefaultFilterPresent: false,
  sourceDefaultFilterOverridesDatabaseDefault: false,
  misterDefaultFilter: '',
  misterDefaultFilterPresent: false,
});

// The [mister] filter of a database list, or null when it sets none.
export function listMisterFilter(iniSource) {
  return iniSource?.defaultFilterPresent ? iniSource.defaultFilter || '' : null;
}

// The filter defaults of a database list entry (or of a database, which has no section filter)
// under a [mister] filter, or none (null). Without one, [mister] terms in the entry's own filter
// expand to nothing, as when a list has no [mister].
export function buildListEntryFilterDefaults(entry, misterFilter = null) {
  const misterPresent = misterFilter !== null;
  const misterValue = misterPresent ? String(misterFilter) : '';
  const sectionPresent = entry.sectionFilter != null;
  return {
    sourceDefaultFilter: sectionPresent ? resolveInheritedFilterValue(entry.sectionFilter, misterValue) : misterValue,
    sourceDefaultFilterPresent: sectionPresent || misterPresent,
    sourceDefaultFilterOverridesDatabaseDefault: sectionPresent,
    misterDefaultFilter: misterValue,
    misterDefaultFilterPresent: misterPresent,
  };
}

// The filter defaults of a database list whose entry has not been chosen yet: its [mister] filter.
export function buildIniListFilterDefaults(iniSource) {
  return {
    ...NO_FILTER_DEFAULTS,
    misterDefaultFilter: iniSource.defaultFilter || '',
    misterDefaultFilterPresent: iniSource.defaultFilterPresent,
  };
}

export function normalizeFilterPromptValue(value) {
  return String(value).trim().replace(/\s+/g, ' ');
}

export function formatFilterPromptValue(value) {
  const normalizedValue = normalizeFilterPromptValue(value);
  return normalizedValue || 'Empty filter';
}

// Opening an INI entry asks before replacing FILTER only when FILTER has terms and the entry
// brings its own, different filter.
export function shouldConfirmFilterOverride({ currentFilter, nextFilter, nextFilterPresent }) {
  if (!String(currentFilter).trim() || !nextFilterPresent) {
    return false;
  }

  return normalizeFilterPromptValue(currentFilter) !== normalizeFilterPromptValue(nextFilter);
}

export function resolveEffectiveDefaultFilter({
  sourceDefaultFilter,
  sourceDefaultFilterPresent,
  sourceDefaultFilterOverridesDatabaseDefault,
  misterDefaultFilter,
  misterDefaultFilterPresent,
  databaseDefaultFilter,
}) {
  if (sourceDefaultFilterPresent && sourceDefaultFilterOverridesDatabaseDefault) {
    return sourceDefaultFilter;
  }

  const hasDatabaseDefaultFilter = Boolean(String(databaseDefaultFilter).trim());
  if (hasDatabaseDefaultFilter && (!misterDefaultFilterPresent || inheritsMisterFilter(databaseDefaultFilter))) {
    return resolveInheritedFilterValue(
      databaseDefaultFilter,
      misterDefaultFilterPresent ? misterDefaultFilter : '',
    );
  }

  if (misterDefaultFilterPresent) {
    return misterDefaultFilter;
  }

  if (sourceDefaultFilterPresent) {
    return sourceDefaultFilter;
  }

  return '';
}

// The filter Downloader applies to one database of several: its own section filter, else its
// `default_options.filter` (only when [mister] sets no filter, or when that default inherits
// [mister]), else the [mister] filter. `misterFilter` and `sectionFilter` are { isSet, value }; a
// set filter applies even when empty. [mister] terms expand to the [mister] filter, or to nothing.
export function resolveDownloaderFilter({ misterFilter, sectionFilter, databaseDefaultFilter }) {
  const misterValue = misterFilter.isSet ? String(misterFilter.value) : '';
  if (sectionFilter.isSet) {
    return resolveInheritedFilterValue(sectionFilter.value, misterValue);
  }

  const databaseDefault = String(databaseDefaultFilter || '').trim();
  if (databaseDefault && (!misterFilter.isSet || inheritsMisterFilter(databaseDefault))) {
    return resolveInheritedFilterValue(databaseDefault, misterValue);
  }

  return misterValue.trim();
}

// Which filter resolveDownloaderFilter picks for a database: 'own' (its section filter),
// 'default' (its default_options.filter), 'shared' ([mister]) or 'none'.
export function resolveDownloaderFilterSource({ misterFilter, sectionFilter, databaseDefaultFilter }) {
  if (sectionFilter.isSet) {
    return 'own';
  }

  const databaseDefault = String(databaseDefaultFilter || '').trim();
  if (databaseDefault && (!misterFilter.isSet || inheritsMisterFilter(databaseDefault))) {
    return 'default';
  }

  return misterFilter.isSet ? 'shared' : 'none';
}

function inheritsMisterFilter(filterValue) {
  return /\[\s*mister\s*\]/i.test(String(filterValue));
}
