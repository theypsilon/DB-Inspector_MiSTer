import { memo, useState, useEffect, useMemo } from 'react';
import { flushSync } from 'react-dom';
import ModalFrame from './ModalFrame.jsx';
import EmptyState from '../ui/EmptyState.jsx';
import useDebouncedValue from '../../hooks/useDebouncedValue.js';
import { runAfterNextPaint, FILTER_INPUT_DEBOUNCE_MS } from '../../lib/utils.js';

const IniPickerModal = memo(function IniPickerModal({ iniSource, onClose, onOpenDatabase }) {
  const [query, setQuery] = useState('');
  const [selectedKey, setSelectedKey] = useState(iniSource.entries[0]?.key ?? '');
  const debounceddQuery = useDebouncedValue(query.trim().toLowerCase(), FILTER_INPUT_DEBOUNCE_MS);

  useEffect(() => {
    setSelectedKey(iniSource.entries[0]?.key ?? '');
  }, [iniSource]);

  const filteredEntries = useMemo(() => {
    if (!debounceddQuery) {
      return iniSource.entries;
    }

    return iniSource.entries.filter((entry) => {
      const haystack = `${entry.dbId} ${entry.dbUrl}`.toLowerCase();
      return haystack.includes(debounceddQuery);
    });
  }, [debounceddQuery, iniSource]);

  const selectedEntry = useMemo(
    () => iniSource.entries.find((entry) => entry.key === selectedKey) ?? null,
    [iniSource, selectedKey],
  );

  return (
    <ModalFrame
      label="List"
      title="Choose a database from this list"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="secondary-button" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            onClick={() => {
              if (selectedEntry) {
                flushSync(() => {
                  onClose();
                });
                runAfterNextPaint(() => {
                  onOpenDatabase(selectedEntry);
                });
              }
            }}
            disabled={!selectedEntry}
          >
            Open selected database
          </button>
        </>
      }
    >
      <div className="modal-toolbar">
        <div className="catalog-search">
          <label className="field-label" htmlFor="ini-modal-search">
            Search list
          </label>
          <input
            id="ini-modal-search"
            type="search"
            placeholder="Search by ID or URL"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <p className="catalog-count">
          {filteredEntries.length} of {iniSource.entries.length} entries
        </p>
      </div>
      {selectedEntry ? (
        <article className="compact-selected modal-selected">
          <p className="section-label">Selected</p>
          <div className="catalog-selected-grid compact-selected-grid">
            <div>
              <span className="catalog-meta-label">Database ID</span>
              <code>{selectedEntry.dbId}</code>
            </div>
            <div className="catalog-selected-url">
              <span className="catalog-meta-label">URL</span>
              <a href={selectedEntry.dbUrl} target="_blank" rel="noreferrer">
                {selectedEntry.dbUrl}
              </a>
            </div>
          </div>
        </article>
      ) : null}
      {filteredEntries.length ? (
        <div className="catalog-list modal-list" role="listbox" aria-label="Database list entries">
          {filteredEntries.map((entry) => (
            <button
              key={entry.key}
              type="button"
              className={
                entry.key === selectedKey
                  ? 'catalog-option catalog-option-selected'
                  : 'catalog-option'
              }
              onClick={() => setSelectedKey(entry.key)}
            >
              <div className="catalog-option-head">
                <code>{entry.dbId}</code>
                <strong>Database</strong>
              </div>
              <span className="catalog-option-url">{entry.dbUrl}</span>
            </button>
          ))}
        </div>
      ) : (
        <EmptyState message="No entries match the current search." />
      )}
    </ModalFrame>
  );
});

export default IniPickerModal;
