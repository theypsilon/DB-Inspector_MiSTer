import { memo, useState, useEffect, useMemo } from 'react';
import { flushSync } from 'react-dom';
import ModalFrame from './ModalFrame.jsx';
import EmptyState from '../ui/EmptyState.jsx';
import useDebouncedValue from '../../hooks/useDebouncedValue.js';
import { normalizeComparableUrl, runAfterNextPaint, FILTER_INPUT_DEBOUNCE_MS } from '../../lib/utils.js';

const CatalogPickerModal = memo(function CatalogPickerModal({
  options,
  status,
  error,
  initialDatabaseUrl,
  onClose,
  onOpenDatabase,
}) {
  const initialSelectedKey = useMemo(() => {
    const normalizedCurrentUrl = normalizeComparableUrl(initialDatabaseUrl);
    return options.find((option) => normalizeComparableUrl(option.dbUrl) === normalizedCurrentUrl)?.key ?? '';
  }, [initialDatabaseUrl, options]);
  const [query, setQuery] = useState('');
  const [selectedKey, setSelectedKey] = useState(initialSelectedKey);
  const debouncedQuery = useDebouncedValue(query.trim().toLowerCase(), FILTER_INPUT_DEBOUNCE_MS);

  useEffect(() => {
    setSelectedKey(initialSelectedKey);
  }, [initialSelectedKey]);

  const filteredOptions = useMemo(() => {
    if (!debouncedQuery) {
      return options;
    }

    return options.filter((option) => {
      const haystack = `${option.dbId} ${option.title} ${option.dbUrl}`.toLowerCase();
      return haystack.includes(debouncedQuery);
    });
  }, [debouncedQuery, options]);

  const selectedOption = useMemo(
    () => options.find((item) => item.key === selectedKey) ?? null,
    [options, selectedKey],
  );

  return (
    <ModalFrame
      label="Catalog"
      title="Browse database catalog"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="secondary-button" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            onClick={() => {
              if (selectedOption) {
                flushSync(() => {
                  onClose();
                });
                runAfterNextPaint(() => {
                  onOpenDatabase(selectedOption.dbUrl);
                });
              }
            }}
            disabled={!selectedOption}
          >
            Open selected database
          </button>
        </>
      }
    >
      <div className="modal-toolbar">
        <div className="catalog-search">
          <label className="field-label" htmlFor="catalog-modal-search">
            Search catalog
          </label>
          <input
            id="catalog-modal-search"
            type="search"
            placeholder="Search by ID, title, or URL"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            disabled={status !== 'ready'}
          />
        </div>
        <p className="catalog-count">
          {status === 'ready'
            ? `${filteredOptions.length} of ${options.length} entries`
            : 'Catalog unavailable'}
        </p>
      </div>
      {selectedOption ? (
        <article className="compact-selected modal-selected">
          <p className="section-label">Selected</p>
          <div className="catalog-selected-grid compact-selected-grid">
            <div>
              <span className="catalog-meta-label">Database ID</span>
              <code>{selectedOption.dbId}</code>
            </div>
            <div>
              <span className="catalog-meta-label">Title</span>
              <strong>{selectedOption.title}</strong>
            </div>
            <div className="catalog-selected-url">
              <span className="catalog-meta-label">URL</span>
              <a href={selectedOption.dbUrl} target="_blank" rel="noreferrer">
                {selectedOption.dbUrl}
              </a>
            </div>
          </div>
        </article>
      ) : null}
      {status === 'loading' ? (
        <p className="helper-copy">Loading catalog entries.</p>
      ) : null}
      {status === 'error' ? <p className="status error">{error}</p> : null}
      {status === 'ready' ? (
        filteredOptions.length ? (
          <div className="catalog-list modal-list" role="listbox" aria-label="Catalog results">
            {filteredOptions.map((option) => (
              <button
                key={option.key}
                type="button"
                className={
                  option.key === selectedKey
                    ? 'catalog-option catalog-option-selected'
                    : 'catalog-option'
                }
                onClick={() => setSelectedKey(option.key)}
              >
                <div className="catalog-option-head">
                  <code>{option.dbId}</code>
                  <strong>{option.title}</strong>
                </div>
                <span className="catalog-option-url">{option.dbUrl}</span>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState message="No catalog entries match the current search." />
        )
      ) : null}
    </ModalFrame>
  );
});

export default CatalogPickerModal;
