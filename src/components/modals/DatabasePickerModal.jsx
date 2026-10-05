import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import ModalFrame from './ModalFrame.jsx';
import DbIdConflictModal from './DbIdConflictModal.jsx';
import EmptyState from '../ui/EmptyState.jsx';
import useDebouncedValue from '../../hooks/useDebouncedValue.js';
import { formatFilterPromptValue } from '../../lib/filterDefaults.js';
import { findLoadedKeys } from '../../lib/selection.js';
import {
  describePickerEntry,
  listedPickerEntries,
  openButtonLabel,
  pickerToggleAllLabel,
  reducePickerSelection,
  selectedPickerEntries,
  startPickerSelection,
  summarizePickerSelection,
} from '../../lib/pickerSelection.js';
import { runAfterNextPaint, updateTooltipPlacement, FILTER_INPUT_DEBOUNCE_MS } from '../../lib/utils.js';

const APPROXIMATE_DB_ID_TOOLTIP =
  'The real database ID will be determined when the database is opened.';

function ApproximateDbIdLabel() {
  return (
    <span
      className="catalog-id-approximation info-hint"
      aria-label={`Approximate ID. ${APPROXIMATE_DB_ID_TOOLTIP}`}
      onMouseEnter={(event) => updateTooltipPlacement(event.currentTarget)}
    >
      Approximate ID
      <span className="info-tip" role="tooltip">
        {APPROXIMATE_DB_ID_TOOLTIP}
      </span>
    </span>
  );
}

function countDatabases(count) {
  return count === 1 ? '1 database' : `${count} databases`;
}

// Chooses databases to open, from the catalog or a database list. Each selected database has its
// own db_id: choosing one whose db_id is taken asks whether it should replace the selected one.
// `presets` are extra buttons that replace the selection with their `keys`, and `preferredKeys`
// decide which database of a db_id "Select all" picks; while searching, it selects the databases
// shown ("Select shown"), adding them to the selection. The list fills the dialog and is what
// scrolls; the summary names the first few selected databases, and reviewing the selection lists
// only the selected ones.
/**
 * @typedef {object} DatabasePickerModalProps
 * @property {string} label
 * @property {string} title
 * @property {any[]} entries
 * @property {string} [status]
 * @property {string} [error]
 * @property {{ id: string, label: string, placeholder: string }} search
 * @property {string[]} initialSelectedKeys
 * @property {string[]} preferredKeys
 * @property {any[]} presets
 * @property {any[]} loadedDatabases
 * @property {string} listLabel
 * @property {string} emptyMessage
 * @property {import('react').ReactNode} [intro]
 * @property {() => void} onClose
 * @property {(entries: any[]) => void} onOpen
 */
const DatabasePickerModal = memo(/** @param {DatabasePickerModalProps} props */ function DatabasePickerModal({
  label,
  title,
  entries,
  status = 'ready',
  error = '',
  search,
  initialSelectedKeys,
  preferredKeys,
  presets,
  loadedDatabases,
  listLabel,
  emptyMessage,
  intro,
  onClose,
  onOpen,
}) {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query.trim().toLowerCase(), FILTER_INPUT_DEBOUNCE_MS);
  const [selection, setSelection] = useState(() => startPickerSelection(initialSelectedKeys));
  const [selectionStart, setSelectionStart] = useState(initialSelectedKeys);
  // While reviewing the selection: the keys selected when the review started.
  const [reviewKeys, setReviewKeys] = useState(null);
  const listRef = useRef(null);
  const { selectedKeys, conflict } = selection;
  const ready = status === 'ready';

  // A new list of entries starts from its own initial selection.
  if (selectionStart !== initialSelectedKeys) {
    setSelectionStart(initialSelectedKeys);
    setSelection(startPickerSelection(initialSelectedKeys));
    setReviewKeys(null);
  }

  function dispatch(action) {
    setSelection((current) => reducePickerSelection(current, action, { entries, preferredKeys }));
  }

  useEffect(() => {
    if (!conflict) {
      return undefined;
    }

    // Escape cancels only the conflict question, not the picker behind it.
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setSelection((current) => reducePickerSelection(current, { type: 'cancelConflict' }, { entries: [] }));
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [conflict]);

  const listedEntries = useMemo(
    () => listedPickerEntries(entries, { query: debouncedQuery, reviewKeys }),
    [debouncedQuery, entries, reviewKeys],
  );
  const selectedEntries = useMemo(() => selectedPickerEntries(entries, selection), [entries, selection]);
  const summary = useMemo(() => summarizePickerSelection(selectedEntries), [selectedEntries]);
  const toggleAllLabel = useMemo(
    () => pickerToggleAllLabel(entries, listedEntries, selection),
    [entries, listedEntries, selection],
  );
  const loadedKeys = useMemo(() => findLoadedKeys(entries, loadedDatabases), [entries, loadedDatabases]);
  const hasApproximateDbIds = useMemo(() => entries.some((entry) => entry.dbIdApproximate), [entries]);

  // Lists only the selected databases (or all of them again), from the top of the list.
  function review(keys) {
    setReviewKeys(keys);
    listRef.current?.scrollTo({ top: 0 });
  }

  function openSelection() {
    if (!selectedEntries.length) {
      return;
    }

    flushSync(() => {
      onClose();
    });
    runAfterNextPaint(() => {
      onOpen(selectedEntries);
    });
  }

  return (
    <>
      <ModalFrame
        label={label}
        title={title}
        className="picker-panel"
        onClose={onClose}
        footer={
          <>
            <button type="button" className="secondary-button" onClick={onClose}>
              Close
            </button>
            <button type="button" onClick={openSelection} disabled={!selectedEntries.length}>
              {openButtonLabel(selectedEntries.length)}
            </button>
          </>
        }
      >
        {intro}
        <div className="modal-toolbar picker-toolbar">
          <div className="catalog-search">
            <label className="field-label" htmlFor={search.id}>
              {search.label}
            </label>
            <input
              id={search.id}
              type="search"
              placeholder={search.placeholder}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              disabled={!ready}
            />
          </div>
          <div className="button-row picker-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => dispatch({ type: 'toggleAll', shown: listedEntries })}
              disabled={!ready || !listedEntries.length}
            >
              {toggleAllLabel}
            </button>
            {presets.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className="secondary-button"
                onClick={() => dispatch({ type: 'preset', keys: preset.keys })}
                disabled={!ready || !preset.keys.length}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <p className="catalog-count">
            {ready ? `${listedEntries.length} of ${entries.length} entries` : 'Catalog unavailable'}
          </p>
        </div>
        {hasApproximateDbIds ? (
          <p className="helper-copy catalog-approximation-note">
            Entries marked “Approximate ID” use the folder from their database URL because their
            catalog source does not publish a database ID.
          </p>
        ) : null}
        <article className="modal-selected selection-summary">
          <div className="selection-summary-head">
            <p className="section-label">Selected</p>
            {selectedEntries.length ? (
              <strong>{countDatabases(selectedEntries.length)}</strong>
            ) : (
              <span className="helper-copy">No databases selected.</span>
            )}
            {selectedEntries.length || reviewKeys ? (
              <button
                type="button"
                className="inline-action-button selection-review"
                onClick={() => review(reviewKeys ? null : new Set(selectedKeys))}
              >
                {reviewKeys ? 'Show all entries' : 'Review selected'}
              </button>
            ) : null}
          </div>
          {selectedEntries.length ? (
            <>
              <div className="selection-chips">
                {summary.named.map((entry) => (
                  <span key={entry.key} className="selection-chip">
                    <code className="db-chip">{entry.dbId}</code>
                    {entry.dbIdApproximate ? <ApproximateDbIdLabel /> : null}
                  </span>
                ))}
                {summary.more ? (
                  <button
                    type="button"
                    className="inline-action-button selection-more"
                    onClick={() => review(new Set(selectedKeys))}
                  >
                    +{summary.more} more
                  </button>
                ) : null}
              </div>
            </>
          ) : null}
        </article>
        {status === 'loading' ? <p className="helper-copy">Loading catalog entries.</p> : null}
        {status === 'error' ? <p className="status error">{error}</p> : null}
        {ready ? (
          listedEntries.length ? (
            <div ref={listRef} className="catalog-list modal-list" role="group" aria-label={listLabel}>
              {listedEntries.map((entry) => {
                const selected = selectedKeys.has(entry.key);
                return (
                  <label
                    key={entry.key}
                    className={selected ? 'catalog-option catalog-option-selected' : 'catalog-option'}
                  >
                    <div className="catalog-option-head">
                      <input
                        type="checkbox"
                        className="catalog-option-check"
                        checked={selected}
                        onChange={() => dispatch({ type: 'toggle', entry })}
                        aria-label={describePickerEntry(entry)}
                      />
                      <div className="catalog-id-row">
                        <code>{entry.dbId}</code>
                        {entry.dbIdApproximate ? <ApproximateDbIdLabel /> : null}
                        {loadedKeys.has(entry.key) ? <span className="catalog-loaded-badge">Loaded</span> : null}
                      </div>
                      <strong>{entry.title ?? 'Database'}</strong>
                    </div>
                    {entry.dbUrl ? <span className="catalog-option-url">{entry.dbUrl}</span> : null}
                    {entry.origin ? (
                      <span className="catalog-option-origin">
                        From <code>{entry.origin}</code>
                      </span>
                    ) : null}
                    {entry.sectionFilter != null ? (
                      <span className="catalog-option-filter">
                        Own filter: <code>{formatFilterPromptValue(entry.sectionFilter)}</code>
                      </span>
                    ) : null}
                  </label>
                );
              })}
            </div>
          ) : (
            <EmptyState message={emptyMessage} />
          )
        ) : null}
      </ModalFrame>
      {conflict ? (
        <DbIdConflictModal
          selected={conflict.selected}
          incoming={conflict.incoming}
          onReplace={() => dispatch({ type: 'replaceConflict' })}
          onCancel={() => dispatch({ type: 'cancelConflict' })}
        />
      ) : null}
    </>
  );
});

export default DatabasePickerModal;
