import { memo } from 'react';
import ModalFrame from './ModalFrame.jsx';
import { formatFilterPromptValue } from '../../lib/utils.js';

const FilterOverrideModal = memo(function FilterOverrideModal({
  currentFilter,
  nextFilter,
  onAccept,
  onDecline,
}) {
  return (
    <ModalFrame
      label="FILTER"
      title="Replace the current filter?"
      onClose={onDecline}
      footer={
        <>
          <button type="button" className="secondary-button" onClick={onDecline}>
            Keep current
          </button>
          <button type="button" onClick={onAccept}>
            Replace filter
          </button>
        </>
      }
    >
      <p className="helper-copy">
        This database provides its own filter. Choose whether to keep the current filter or replace
        it with the incoming one.
      </p>
      <div className="filter-override-grid">
        <div>
          <span className="catalog-meta-label">Current FILTER</span>
          <code>{formatFilterPromptValue(currentFilter)}</code>
        </div>
        <div>
          <span className="catalog-meta-label">Incoming FILTER</span>
          <code>{formatFilterPromptValue(nextFilter)}</code>
        </div>
      </div>
    </ModalFrame>
  );
});

export default FilterOverrideModal;
