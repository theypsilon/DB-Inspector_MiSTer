import { useEffect, useId, useRef, useState } from 'react';
import { THEME_STORAGE_KEY, readThemeMode, resolveTheme, storeThemeMode } from '../../lib/theme.js';

const DARK_SCHEME = '(prefers-color-scheme: dark)';

/** @type {{ mode: import('../../lib/theme.js').ThemeMode, label: string }[]} */
const MODES = [
  { mode: 'system', label: 'Match system' },
  { mode: 'light', label: 'Light' },
  { mode: 'dark', label: 'Dark' },
];

// The themes only a hand-written localStorage value picks: the button names them, and none of the
// menu's modes is checked (see src/lib/theme.js).
const HIDDEN_LABELS = { classic: 'Classic', 'dot-matrix': 'Dot Matrix', phosphor: 'Phosphor' };

// What opening the menu writes to the browser's console: how to pick the themes it does not offer.
const HIDDEN_THEMES_HINT = (() => {
  const themes = Object.entries(HIDDEN_LABELS).map(([id, label]) => `${label} ('${id}')`);
  return [
    `More themes, not in this menu: ${themes.slice(0, -1).join(', ')} and ${themes.at(-1)}.`,
    'To pick one, run this here, with its id, then reload the page:',
    `localStorage.setItem('${THEME_STORAGE_KEY}', '${Object.keys(HIDDEN_LABELS)[0]}')`,
    'A choice in the menu replaces it.',
  ].join('\n');
})();

function systemPrefersDark() {
  return Boolean(window.matchMedia?.(DARK_SCHEME)?.matches);
}

/** @param {{ mode: string }} props */
function ModeIcon({ mode }) {
  if (mode === 'light' || mode === 'classic' || mode === 'dot-matrix') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
      </svg>
    );
  }
  if (mode === 'dark' || mode === 'phosphor') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20.5 13.3A8.5 8.5 0 1 1 10.7 3.5a6.6 6.6 0 0 0 9.8 9.8Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5a8.5 8.5 0 0 1 0 17Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

// The theme menu in the page's top corner: match the system's light or dark setting (the
// default), or always light, or always dark. Its button shows the mode. It follows the menu
// button pattern: opening it focuses the mode in use, the arrow keys, Home and End move through
// the modes, Enter or a click picks one, and Escape, Tab or a click outside closes it.
function ThemeMenu() {
  const [mode, setMode] = useState(readThemeMode);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const theme = resolveTheme(mode, systemDark);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // The system's setting as it changes, by hand or on a schedule; it shows while the mode matches it.
  useEffect(() => {
    const scheme = window.matchMedia?.(DARK_SCHEME);
    if (!scheme?.addEventListener) {
      return undefined;
    }
    /** @param {MediaQueryListEvent} event */
    const follow = (event) => setSystemDark(event.matches);
    scheme.addEventListener('change', follow);
    return () => scheme.removeEventListener('change', follow);
  }, []);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    (menuRef.current?.querySelector('[aria-checked="true"]') ?? menuRef.current?.querySelector('[role="menuitemradio"]'))?.focus();
    /** @param {PointerEvent} event */
    const closeOutside = (event) => {
      const target = /** @type {Node} */ (event.target);
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);

  // Each opening, by a click or the arrow keys, also tells the console how to pick the hidden themes.
  const openMenu = () => {
    if (!open) {
      console.log(HIDDEN_THEMES_HINT);
    }
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  /** @param {import('../../lib/theme.js').ThemeMode} next */
  const choose = (next) => {
    storeThemeMode(next);
    setMode(next);
    close();
  };

  /** @param {number | 'first' | 'last'} step */
  const moveFocus = (step) => {
    const items = [...(menuRef.current?.querySelectorAll('[role="menuitemradio"]') ?? [])];
    const index = items.indexOf(document.activeElement);
    const next =
      step === 'first' ? 0 : step === 'last' ? items.length - 1 : (index + step + items.length) % items.length;
    items[next]?.focus();
  };

  /** @param {import('react').KeyboardEvent} event */
  const onMenuKeyDown = (event) => {
    const moves = { ArrowDown: 1, ArrowUp: -1, Home: 'first', End: 'last' };
    if (event.key in moves) {
      event.preventDefault();
      moveFocus(moves[event.key]);
    } else if (event.key === 'Escape') {
      // Only the menu closes: not the find bar, nor a dialog.
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  };

  const current = MODES.find((entry) => entry.mode === mode) ?? { mode, label: HIDDEN_LABELS[mode] ?? MODES[0].label };
  return (
    <div className="theme-menu">
      <button
        ref={buttonRef}
        type="button"
        className="theme-menu-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Theme: ${current.label}`}
        title={`Theme: ${current.label}`}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            openMenu();
          }
        }}
      >
        <ModeIcon mode={mode} />
      </button>
      {open ? (
        <div ref={menuRef} id={menuId} role="menu" aria-label="Theme" className="theme-menu-list" onKeyDown={onMenuKeyDown}>
          {MODES.map((entry) => (
            <button
              key={entry.mode}
              type="button"
              role="menuitemradio"
              aria-checked={entry.mode === mode}
              tabIndex={-1}
              className="theme-menu-item"
              onClick={() => choose(entry.mode)}
            >
              <ModeIcon mode={entry.mode} />
              <span>{entry.label}</span>
              <svg className="theme-menu-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m5 12.5 4.5 4.5L19 7.5" />
              </svg>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default ThemeMenu;
