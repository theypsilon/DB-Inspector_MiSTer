import { memo, useMemo } from 'react';
import DatabasePickerModal from './DatabasePickerModal.jsx';
import { findUpdateAllDefaultKeys } from '../../lib/selection.js';

const CATALOG_SEARCH = {
  id: 'catalog-modal-search',
  label: 'Search catalog',
  placeholder: 'Search by ID, title, or URL',
};
// The catalog opens with nothing selected.
const NO_KEYS = [];

const CatalogPickerModal = memo(function CatalogPickerModal({
  options,
  status,
  error,
  loadedDatabases,
  onClose,
  onOpenDatabases,
}) {
  const updateAllDefaultKeys = useMemo(() => findUpdateAllDefaultKeys(options), [options]);
  const presets = useMemo(
    () => [{ label: 'Select Update All defaults', keys: updateAllDefaultKeys }],
    [updateAllDefaultKeys],
  );

  return (
    <DatabasePickerModal
      label="Catalog"
      title="Browse database catalog"
      entries={options}
      status={status}
      error={error}
      search={CATALOG_SEARCH}
      initialSelectedKeys={NO_KEYS}
      preferredKeys={updateAllDefaultKeys}
      presets={presets}
      loadedDatabases={loadedDatabases}
      listLabel="Catalog results"
      emptyMessage="No catalog entries match the current search."
      onClose={onClose}
      onOpen={onOpenDatabases}
    />
  );
});

export default CatalogPickerModal;
