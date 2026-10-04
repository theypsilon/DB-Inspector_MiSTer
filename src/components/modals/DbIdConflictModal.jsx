import { memo } from 'react';
import ModalFrame from './ModalFrame.jsx';

function EntrySummary({ label, entry }) {
  return (
    <div>
      <span className="catalog-meta-label">{label}</span>
      {entry.title ? <strong>{entry.title}</strong> : null}
      <span className="catalog-option-url">{entry.dbUrl}</span>
    </div>
  );
}

// Asked when choosing a database whose db_id another selected database already has: databases
// that share a db_id cannot be combined, so the new one can only replace the selected one.
const DbIdConflictModal = memo(function DbIdConflictModal({ selected, incoming, onReplace, onCancel }) {
  return (
    <ModalFrame
      label="Selection"
      title="Replace the selected database?"
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="secondary-button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" onClick={onReplace}>
            Replace
          </button>
        </>
      }
    >
      <p className="helper-copy">
        Another selected database has the db_id <code>{incoming.dbId}</code>. Databases that share a db_id
        cannot be combined, so only one of them can be selected.
      </p>
      <div className="filter-override-grid">
        <EntrySummary label="Selected" entry={selected} />
        <EntrySummary label="Replace with" entry={incoming} />
      </div>
    </ModalFrame>
  );
});

export default DbIdConflictModal;
