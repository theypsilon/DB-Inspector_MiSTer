import { memo } from 'react';
import ModalFrame from './ModalFrame.jsx';

// Asked before Clear closes the loaded databases and goes back to the start page.
/**
 * @typedef {object} ClearDatabasesModalProps
 * @property {string[]} loadedDbIds
 * @property {() => void} onClear
 * @property {() => void} onCancel
 */
const ClearDatabasesModal = memo(/** @param {ClearDatabasesModalProps} props */ function ClearDatabasesModal({
  loadedDbIds,
  onClear,
  onCancel,
}) {
  const one = loadedDbIds.length === 1;
  return (
    <ModalFrame
      label="Clear"
      title={one ? 'Clear the loaded database?' : 'Clear the loaded databases?'}
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="secondary-button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" onClick={onClear}>
            Clear
          </button>
        </>
      }
    >
      <p className="helper-copy">
        {one ? (
          <>
            This closes <code>{loadedDbIds[0]}</code> and its filter
          </>
        ) : (
          `This closes the ${loadedDbIds.length} loaded databases and their filters`
        )}
        , and goes back to the start page.
      </p>
    </ModalFrame>
  );
});

export default ClearDatabasesModal;
