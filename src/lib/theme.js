// The page's two themes: 16-bit, light, and Retrowave, dark (their colors are in app.css). The
// visitor picks a mode: match the system's setting (the default, which follows it as it changes,
// by hand or on a schedule), or always light, or always dark. A chosen theme is remembered in this
// browser; matching the system is remembered as no choice. index.html applies the same rule before
// the page draws: keep the two in step.

export const THEME_STORAGE_KEY = 'inspector-theme';

/** @typedef {'light' | 'dark'} Theme */
/** @typedef {'system' | Theme} ThemeMode */

/**
 * The theme to show for a mode: a chosen theme, else the system's.
 * @param {string | null} mode
 * @param {boolean} systemPrefersDark
 * @returns {Theme}
 */
export function resolveTheme(mode, systemPrefersDark) {
  if (mode === 'light' || mode === 'dark') {
    return mode;
  }
  return systemPrefersDark ? 'dark' : 'light';
}

// Reaching localStorage throws where a browser blocks it, as some private windows do.
function browserStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * The remembered mode: a chosen theme, or 'system' when there is none or it cannot be read.
 * @param {Pick<Storage, 'getItem'> | null} [storage]
 * @returns {ThemeMode}
 */
export function readThemeMode(storage = browserStorage()) {
  try {
    const value = storage?.getItem(THEME_STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

/**
 * Remembers a mode: a chosen theme is stored, and matching the system removes it. Where it cannot
 * be stored, the mode lasts until the page is closed.
 * @param {ThemeMode} mode
 * @param {Pick<Storage, 'setItem' | 'removeItem'> | null} [storage]
 */
export function storeThemeMode(mode, storage = browserStorage()) {
  try {
    if (mode === 'light' || mode === 'dark') {
      storage?.setItem(THEME_STORAGE_KEY, mode);
    } else {
      storage?.removeItem(THEME_STORAGE_KEY);
    }
  } catch {
    // Not stored: the page keeps the mode until it is closed.
  }
}
