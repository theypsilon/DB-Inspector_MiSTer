import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { explorerAncestors } from '../../lib/explorer.js';

/**
 * The path to the folder shown, from the SD card: each folder above it goes there. When they do not
 * fit, the first ones fold into …, which lists them; the folder shown never folds, and is cut short
 * instead. The explorer gives it a new key for each folder, so it starts unfolded.
 * @param {{
 *   folder: import('../../lib/explorer.js').ExplorerFolder,
 *   onOpen: (folder: import('../../lib/explorer.js').ExplorerFolder) => void,
 * }} props
 */
export default function ExplorerPath({ folder, onOpen }) {
  const folders = explorerAncestors(folder);
  const [folded, setFolded] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [width, setWidth] = useState(0);
  const listRef = useRef(null);
  const moreRef = useRef(null);
  const menuRef = useRef(null);
  const widthRef = useRef(0);

  // Folds one more folder while the path is wider than its place.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (list && folded < folders.length - 1 && list.scrollWidth > list.clientWidth + 1) {
      setFolded(folded + 1);
    }
  }, [folded, folders.length, width]);

  // A new width starts again from the whole path.
  useEffect(() => {
    const list = listRef.current;
    if (!list) {
      return undefined;
    }

    widthRef.current = list.clientWidth;
    const observer = new ResizeObserver(() => {
      if (list.clientWidth !== widthRef.current) {
        widthRef.current = list.clientWidth;
        setFolded(0);
        setWidth(list.clientWidth);
      }
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, []);

  // The menu closes on a click outside it, and gets the focus when it opens.
  useEffect(() => {
    if (!menuOpen) {
      return undefined;
    }

    menuRef.current?.querySelector('[role="menuitem"]')?.focus();
    const onPointerDown = (event) => {
      if (!menuRef.current?.contains(event.target) && !moreRef.current?.contains(event.target)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [menuOpen]);

  const handleMenuKeyDown = (event) => {
    const items = [...(menuRef.current?.querySelectorAll('[role="menuitem"]') ?? [])];
    const index = items.indexOf(document.activeElement);
    const moves = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: items.length - 1 };
    if (event.key === 'Escape' || event.key === 'Tab') {
      // Escape closes only the menu.
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        moreRef.current?.focus();
      }
      setMenuOpen(false);
    } else if (event.key in moves && items.length) {
      event.preventDefault();
      items[(moves[event.key] + items.length) % items.length].focus();
    }
  };

  const shown = folders.slice(folded);
  return (
    <nav className="explorer-path" aria-label="Folder path">
      <ol ref={listRef}>
        {folded ? (
          <li>
            <button
              type="button"
              ref={moreRef}
              className="explorer-crumb-button"
              aria-label="Folders above"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              …
            </button>
            <span className="explorer-crumb-separator" aria-hidden="true">›</span>
          </li>
        ) : null}
        {shown.map((shownFolder, index) =>
          shownFolder === folder ? (
            <li key={shownFolder.path} className="explorer-crumb-current">
              <span aria-current="page" title={shownFolder.name}>{shownFolder.name}</span>
            </li>
          ) : (
            <li key={shownFolder.path}>
              <button type="button" className="explorer-crumb-button" onClick={() => onOpen(shownFolder)}>
                {shownFolder.name}
              </button>
              {index < shown.length - 1 ? <span className="explorer-crumb-separator" aria-hidden="true">›</span> : null}
            </li>
          ),
        )}
      </ol>
      {menuOpen && folded ? (
        <div className="explorer-crumb-menu" role="menu" aria-label="Folders above" ref={menuRef} onKeyDown={handleMenuKeyDown}>
          {folders.slice(0, folded).map((hiddenFolder) => (
            <button
              key={hiddenFolder.path}
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                onOpen(hiddenFolder);
              }}
            >
              {hiddenFolder.name}
            </button>
          ))}
        </div>
      ) : null}
    </nav>
  );
}
