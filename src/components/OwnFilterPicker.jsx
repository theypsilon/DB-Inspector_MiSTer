import { useEffect, useId, useRef, useState } from 'react';
import { describeAppliedFilter } from '../lib/combinedFilters.js';

// With this many databases or more to choose from, the list has a search box.
export const OWN_FILTER_SEARCH_FROM = 8;

/**
 * The button that gives a combined database its own filter, and under it the databases without one,
 * each with the filter it gets now and where from. It follows the combobox pattern: the search box
 * (or the list, without one) keeps the focus, the arrow keys move the highlight, Home and End too
 * in the list, and only Enter or a click picks; Escape, Tab or a click outside closes it.
 * @param {{
 *   databases: { dbId: string, effectiveFilter: string, filterSource: string }[],
 *   onPick: (dbId: string) => void,
 * }} props
 */
export default function OwnFilterPicker({ databases, onPick }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const popupId = useId();
  const buttonRef = useRef(null);
  const popupRef = useRef(null);
  const searchRef = useRef(null);
  const listRef = useRef(null);

  const searchable = databases.length >= OWN_FILTER_SEARCH_FROM;
  const typed = searchable ? query.trim().toLowerCase() : '';
  const shown = typed ? databases.filter(({ dbId }) => dbId.toLowerCase().includes(typed)) : databases;
  const highlighted = Math.min(active, shown.length - 1);
  const optionId = (index) => `${popupId}-${index}`;
  const activeId = highlighted >= 0 ? optionId(highlighted) : undefined;

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    // The page scrolls only as the effect below says: just enough to show the whole list.
    (searchRef.current ?? listRef.current)?.focus({ preventScroll: true });
    /** @param {PointerEvent} event */
    const closeOutside = (event) => {
      const target = /** @type {Node} */ (event.target);
      if (!popupRef.current?.contains(target) && !buttonRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);

  // The whole list in view as it opens, as far as the page can scroll; then the highlight as it moves.
  useEffect(() => {
    if (open) {
      popupRef.current?.scrollIntoView?.({ block: 'nearest' });
    }
  }, [open]);
  useEffect(() => {
    if (open && activeId) {
      document.getElementById(activeId)?.scrollIntoView?.({ block: 'nearest' });
    }
  }, [open, activeId]);

  const openPopup = () => {
    setQuery('');
    setActive(0);
    setOpen(true);
  };

  const pick = (dbId) => {
    setOpen(false);
    onPick(dbId);
  };

  /** @param {import('react').KeyboardEvent} event */
  const onPopupKeyDown = (event) => {
    const inList = event.target === listRef.current;
    const last = shown.length - 1;
    const moves = {
      ArrowDown: () => (highlighted + 1) % shown.length,
      ArrowUp: () => (highlighted - 1 + shown.length) % shown.length,
      ...(inList ? { Home: () => 0, End: () => last } : {}),
    };
    if (event.key in moves) {
      event.preventDefault();
      if (shown.length) {
        setActive(moves[event.key]());
      }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (shown[highlighted]) {
        pick(shown[highlighted].dbId);
      }
    } else if (event.key === 'Escape') {
      // Only the list closes: not the find bar, nor a dialog.
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div className="own-filter-picker">
      <button
        ref={buttonRef}
        type="button"
        className="secondary-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${popupId}-list` : undefined}
        onClick={() => (open ? setOpen(false) : openPopup())}
        onKeyDown={(event) => {
          if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault();
            openPopup();
          }
        }}
      >
        <span aria-hidden="true">+ </span>Own filter for a database
      </button>
      {open ? (
        <div ref={popupRef} className="own-filter-popover" onKeyDown={onPopupKeyDown}>
          {searchable ? (
            <input
              ref={searchRef}
              className="own-filter-search"
              type="search"
              role="combobox"
              aria-label="Search databases"
              aria-controls={`${popupId}-list`}
              aria-expanded="true"
              aria-autocomplete="list"
              aria-activedescendant={activeId}
              placeholder="Search databases"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
            />
          ) : null}
          <ul
            ref={listRef}
            id={`${popupId}-list`}
            className="own-filter-list"
            role="listbox"
            aria-label="Databases without their own filter"
            tabIndex={searchable ? -1 : 0}
            aria-activedescendant={searchable ? undefined : activeId}
          >
            {shown.map((database, index) => {
              const { filter, source } = describeAppliedFilter(database);
              return (
                <li
                  key={database.dbId}
                  id={optionId(index)}
                  className="own-filter-option"
                  role="option"
                  aria-selected={index === highlighted}
                  onMouseMove={() => setActive(index)}
                  onClick={() => pick(database.dbId)}
                >
                  <span className="own-filter-option-id">{database.dbId}</span>{' '}
                  <span className="own-filter-option-filter">
                    <code>{filter}</code>
                    <span aria-hidden="true"> · </span>
                    {source}
                  </span>
                </li>
              );
            })}
          </ul>
          {shown.length ? null : <p className="own-filter-empty">No database has that name.</p>}
        </div>
      ) : null}
    </div>
  );
}
