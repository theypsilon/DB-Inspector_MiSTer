import { memo } from 'react';
import ModalFrame from './ModalFrame.jsx';

// Asked before opening databases while others are loaded: open them alone, replacing the loaded
// ones, or combine them with the loaded ones.
/**
 * @typedef {object} LoadModeModalProps
 * @property {string[]} loadedDbIds
 * @property {number} [incomingCount]
 * @property {() => void} onLoadAlone
 * @property {() => void} onCombine
 * @property {() => void} onCancel
 */
const LoadModeModal = memo(/** @param {LoadModeModalProps} props */ function LoadModeModal({
  loadedDbIds,
  incomingCount = 1,
  onLoadAlone,
  onCombine,
  onCancel,
}) {
  return (
    <ModalFrame
      label="Open database"
      title="Combine with the loaded databases?"
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="secondary-button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="secondary-button" onClick={onLoadAlone}>
            Load alone
          </button>
          <button type="button" onClick={onCombine}>
            Combine
          </button>
        </>
      }
    >
      <p className="helper-copy">
        {loadedDbIds.length === 1 ? 'This database is' : 'These databases are'} already loaded:{' '}
        {loadedDbIds.map((dbId, index) => (
          <span key={dbId}>
            {index ? ', ' : null}
            <code>{dbId}</code>
          </span>
        ))}
        .
      </p>
      <p className="helper-copy">
        Load {incomingCount === 1 ? 'the new database' : `the ${incomingCount} selected databases`} alone to
        replace {loadedDbIds.length === 1 ? 'it' : 'them'}, or combine them to inspect everything together.
        Paths that more than one database would install are then listed as collisions.
      </p>
    </ModalFrame>
  );
});

export default LoadModeModal;
