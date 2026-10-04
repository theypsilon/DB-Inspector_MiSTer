import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { HIDDEN_THEMES, THEME_STORAGE_KEY, readThemeMode, resolveTheme, storeThemeMode } from '../../src/lib/theme.js';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

const blockedStorage = {
  getItem() {
    throw new Error('blocked');
  },
  setItem() {
    throw new Error('blocked');
  },
  removeItem() {
    throw new Error('blocked');
  },
};

test('a chosen theme stays, whatever the system says', () => {
  assert.equal(resolveTheme('light', true), 'light');
  assert.equal(resolveTheme('dark', false), 'dark');
});

test('the hidden themes are chosen themes too, written by hand', () => {
  assert.deepEqual(HIDDEN_THEMES, ['classic', 'dot-matrix', 'phosphor']);
  for (const theme of HIDDEN_THEMES) {
    assert.equal(resolveTheme(theme, true), theme);
    assert.equal(resolveTheme(theme, false), theme);
    assert.equal(readThemeMode(memoryStorage({ [THEME_STORAGE_KEY]: theme })), theme);
  }
});

test('matching the system shows the system\u2019s theme', () => {
  assert.equal(resolveTheme('system', true), 'dark');
  assert.equal(resolveTheme('system', false), 'light');
  // No choice, and anything else stored, match the system too.
  assert.equal(resolveTheme(null, true), 'dark');
  assert.equal(resolveTheme('sepia', false), 'light');
});

test('a chosen theme is stored and read back; matching the system is stored as no choice', () => {
  const storage = memoryStorage();
  assert.equal(readThemeMode(storage), 'system');
  storeThemeMode('dark', storage);
  assert.equal(storage.values.get(THEME_STORAGE_KEY), 'dark');
  assert.equal(readThemeMode(storage), 'dark');
  storeThemeMode('light', storage);
  assert.equal(readThemeMode(storage), 'light');
  storeThemeMode('system', storage);
  assert.equal(storage.values.has(THEME_STORAGE_KEY), false);
  assert.equal(readThemeMode(storage), 'system');
  assert.equal(readThemeMode(memoryStorage({ [THEME_STORAGE_KEY]: 'sepia' })), 'system');
});

test('storage the browser blocks reads as matching the system, and storing in it does not throw', () => {
  assert.equal(readThemeMode(blockedStorage), 'system');
  assert.doesNotThrow(() => storeThemeMode('dark', blockedStorage));
  assert.doesNotThrow(() => storeThemeMode('system', blockedStorage));
  assert.equal(readThemeMode(null), 'system');
});

// index.html applies the theme before the page draws, with its own copy of the rule.
function runEarlyScript({ stored, prefersDark, storageBlocked = false, matchMedia = true }) {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const dataset = {};
  const window = {
    get localStorage() {
      if (storageBlocked) {
        throw new Error('blocked');
      }
      return memoryStorage(stored === undefined ? {} : { [THEME_STORAGE_KEY]: stored });
    },
    matchMedia: matchMedia ? (query) => ({ matches: query === '(prefers-color-scheme: dark)' && prefersDark }) : undefined,
  };
  new Function('window', 'document', script)(window, { documentElement: { dataset } });
  return dataset.theme;
}

test('the page draws with the same theme the rule gives, before any of its code loads', () => {
  for (const stored of ['light', 'dark', ...HIDDEN_THEMES, 'sepia', undefined]) {
    for (const prefersDark of [true, false]) {
      assert.equal(
        runEarlyScript({ stored, prefersDark }),
        resolveTheme(stored ?? 'system', prefersDark),
        `stored ${stored}, system ${prefersDark ? 'dark' : 'light'}`,
      );
    }
  }
  assert.equal(runEarlyScript({ stored: 'dark', prefersDark: false, storageBlocked: true }), 'light');
  assert.equal(runEarlyScript({ stored: 'dark', prefersDark: true, storageBlocked: true }), 'dark');
  assert.equal(runEarlyScript({ prefersDark: true, matchMedia: false }), 'light');
});
