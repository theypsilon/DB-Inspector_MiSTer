// The page's two themes: 16-bit, light, and Retrowave, dark (their colors are in app.css). The
// visitor picks a mode: match the system's setting (the default, which follows it as it changes,
// by hand or on a schedule), or always light, or always dark. A chosen theme is remembered in this
// browser; matching the system is remembered as no choice. index.html applies the same rule before
// the page draws: keep the two in step.
//
// Three more themes are there to try, but not offered: Classic (the theme before these two), Dot
// Matrix and Phosphor. Only a value written by hand picks one, from the browser's developer tools:
// localStorage.setItem('inspector-theme', 'phosphor'), then reload. Opening the menu writes how in
// the console. A choice in the menu replaces it.

export const THEME_STORAGE_KEY = 'inspector-theme';
export const HIDDEN_THEMES = ['classic', 'dot-matrix', 'phosphor'];
const THEMES = ['light', 'dark', ...HIDDEN_THEMES];

/** @typedef {'light' | 'dark' | 'classic' | 'dot-matrix' | 'phosphor'} Theme */
/** @typedef {'system' | Theme} ThemeMode */

/**
 * @param {unknown} value
 * @returns {value is Theme}
 */
function isTheme(value) {
  return THEMES.includes(/** @type {string} */ (value));
}

/**
 * The theme to show for a mode: a chosen theme, else the system's.
 * @param {string | null} mode
 * @param {boolean} systemPrefersDark
 * @returns {Theme}
 */
export function resolveTheme(mode, systemPrefersDark) {
  if (isTheme(mode)) {
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
    return isTheme(value) ? value : 'system';
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
    if (isTheme(mode)) {
      storage?.setItem(THEME_STORAGE_KEY, mode);
    } else {
      storage?.removeItem(THEME_STORAGE_KEY);
    }
  } catch {
    // Not stored: the page keeps the mode until it is closed.
  }
}
