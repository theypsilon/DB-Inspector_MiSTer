import { memo, useState } from 'react';
import ModalFrame from './ModalFrame.jsx';

function describeSource({ source }) {
  return source.sourceKind === 'url' ? source.sourceLabel : `Uploaded: ${source.sourceLabel}`;
}

// Asked when databases being combined have the db_id of loaded ones. Only one database per db_id
// can be loaded, so each new one either replaces the loaded one or stays out; one from the same URL
// is the loaded database again, so replacing it reloads it. `conflicts` come from
// findLoadedDbIdConflicts; `onAnswer` gets the db_ids to replace, or null to cancel.
const ReplaceLoadedModal = memo(function ReplaceLoadedModal({ conflicts, onAnswer }) {
  const [replaceDbIds, setReplaceDbIds] = useState(() => new Set(conflicts.map(({ dbId }) => dbId)));

  if (conflicts.length === 1 && conflicts[0].reload) {
    const [{ dbId, loaded }] = conflicts;
    const keep = () => onAnswer(new Set());
    return (
      <ModalFrame
        label="Open database"
        title="Reload the loaded database?"
        onClose={keep}
        footer={
          <>
            <button type="button" className="secondary-button" onClick={keep}>
              Keep the loaded one
            </button>
            <button type="button" onClick={() => onAnswer(new Set([dbId]))}>
              Reload it
            </button>
          </>
        }
      >
        <p className="helper-copy">
          The database <code>{dbId}</code> is already loaded from this URL. Reloading it replaces the loaded
          copy with the one just fetched.
        </p>
        <div className="filter-override-grid">
          <div>
            <span className="catalog-meta-label">URL</span>
            <span className="catalog-option-url">{describeSource(loaded.inspection)}</span>
          </div>
        </div>
      </ModalFrame>
    );
  }

  if (conflicts.length === 1) {
    const [{ dbId, loaded, incoming }] = conflicts;
    const keep = () => onAnswer(new Set());
    return (
      <ModalFrame
        label="Open database"
        title="Replace the loaded database?"
        onClose={keep}
        footer={
          <>
            <button type="button" className="secondary-button" onClick={keep}>
              Keep the loaded one
            </button>
            <button type="button" onClick={() => onAnswer(new Set([dbId]))}>
              Replace it
            </button>
          </>
        }
      >
        <p className="helper-copy">
          A database with the db_id <code>{dbId}</code> is already loaded. Only one database per db_id
          can be loaded at a time, so the new one either replaces it or stays out.
        </p>
        <div className="filter-override-grid">
          <div>
            <span className="catalog-meta-label">Loaded</span>
            <span className="catalog-option-url">{describeSource(loaded.inspection)}</span>
          </div>
          <div>
            <span className="catalog-meta-label">New</span>
            <span className="catalog-option-url">{describeSource(incoming.inspection)}</span>
          </div>
        </div>
      </ModalFrame>
    );
  }

  function toggle(dbId, replace) {
    const next = new Set(replaceDbIds);
    if (replace) {
      next.add(dbId);
    } else {
      next.delete(dbId);
    }
    setReplaceDbIds(next);
  }

  return (
    <ModalFrame
      label="Open databases"
      title="Replace loaded databases?"
      onClose={() => onAnswer(null)}
      footer={
        <>
          <button type="button" className="secondary-button" onClick={() => onAnswer(null)}>
            Cancel
          </button>
          <button type="button" onClick={() => onAnswer(replaceDbIds)}>
            Continue
          </button>
        </>
      }
    >
      <p className="helper-copy">
        These databases have the db_id of a loaded database. Only one database per db_id can be loaded
        at a time: check the ones that should replace the loaded database. The others stay out.
      </p>
      <ul className="replace-list">
        {conflicts.map(({ dbId, loaded, incoming }) => (
          <li key={dbId}>
            <label className="mister-option-toggle">
              <input
                type="checkbox"
                className="catalog-option-check"
                checked={replaceDbIds.has(dbId)}
                onChange={(event) => toggle(dbId, event.target.checked)}
              />
              <span>
                Replace <code>{dbId}</code>
              </span>
            </label>
            <span className="catalog-option-url">Loaded: {describeSource(loaded.inspection)}</span>
            <span className="catalog-option-url">New: {describeSource(incoming.inspection)}</span>
          </li>
        ))}
      </ul>
    </ModalFrame>
  );
});

export default ReplaceLoadedModal;
