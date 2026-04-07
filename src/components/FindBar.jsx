import { memo, useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

const FindBar = memo(function FindBar({
  query,
  onQueryChange,
  focusToken,
  currentIndex,
  totalMatches,
  onNext,
  onPrev,
  onJumpTo,
  onClose,
}) {
  const inputRef = useRef(null);
  const [editingIndex, setEditingIndex] = useState(false);
  const [indexDraft, setIndexDraft] = useState('');
  const indexInputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusToken]);

  const handleKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (event.shiftKey) {
        onPrev();
      } else {
        onNext();
      }
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
    if (event.key === 'F3') {
      event.preventDefault();
      if (event.shiftKey) {
        onPrev();
      } else {
        onNext();
      }
    }
  };

  const commitIndexEdit = () => {
    const parsed = parseInt(indexDraft, 10);
    if (parsed >= 1 && parsed <= totalMatches) {
      onJumpTo(parsed);
    }
    setEditingIndex(false);
  };

  const handleIndexKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitIndexEdit();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setEditingIndex(false);
      inputRef.current?.focus();
    }
  };

  const startEditingIndex = () => {
    if (!totalMatches) return;
    setIndexDraft(String(currentIndex + 1));
    setEditingIndex(true);
    requestAnimationFrame(() => {
      indexInputRef.current?.focus();
      indexInputRef.current?.select();
    });
  };

  return createPortal(
    <div className="find-bar" role="search" aria-label="Find in tree">
      <input
        ref={inputRef}
        type="text"
        className="find-bar-input"
        placeholder="Find in tree..."
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={handleKeyDown}
        aria-label="Search text"
      />
      {editingIndex ? (
        <span className="find-bar-count">
          <input
            ref={indexInputRef}
            type="number"
            className="find-bar-index-input"
            min={1}
            max={totalMatches}
            value={indexDraft}
            onChange={(event) => setIndexDraft(event.target.value)}
            onKeyDown={handleIndexKeyDown}
            onBlur={commitIndexEdit}
            aria-label="Jump to match number"
          />
          {' of '}
          {totalMatches}
        </span>
      ) : (
        <span className="find-bar-count" aria-live="polite" onClick={startEditingIndex} role={totalMatches ? 'button' : undefined} tabIndex={totalMatches ? 0 : undefined}>
          {query.trim() ? `${totalMatches ? currentIndex + 1 : 0} of ${totalMatches}` : ''}
        </span>
      )}
      <button type="button" className="find-bar-button" onClick={onPrev} aria-label="Previous match" disabled={!totalMatches}>
        &#x25B2;
      </button>
      <button type="button" className="find-bar-button" onClick={onNext} aria-label="Next match" disabled={!totalMatches}>
        &#x25BC;
      </button>
      <button type="button" className="find-bar-button find-bar-close" onClick={onClose} aria-label="Close search">
        &#x2715;
      </button>
    </div>,
    document.body,
  );
});

export default FindBar;
