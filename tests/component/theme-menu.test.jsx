import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import ThemeMenu from '../../src/components/ui/ThemeMenu.jsx';
import { THEME_STORAGE_KEY } from '../../src/lib/theme.js';

// The system's light or dark setting, which a test can change.
function systemScheme(prefersDark) {
  const listeners = new Set();
  const scheme = {
    matches: prefersDark,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (type, listener) => listeners.add(listener),
    removeEventListener: (type, listener) => listeners.delete(listener),
  };
  window.matchMedia = () => scheme;
  return {
    change(dark) {
      scheme.matches = dark;
      act(() => {
        for (const listener of listeners) listener({ matches: dark });
      });
    },
  };
}

const theme = () => document.documentElement.dataset.theme;
const menuButton = (mode) => screen.getByRole('button', { name: `Theme: ${mode}` });
const choices = () => screen.getAllByRole('menuitemradio');
const checked = () => choices().filter((item) => item.getAttribute('aria-checked') === 'true').map((item) => item.textContent);

describe('the theme menu', () => {
  const originalMatchMedia = window.matchMedia;
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    delete document.documentElement.dataset.theme;
    localStorage.clear();
  });

  test('matches the system by default, and follows it as it changes', () => {
    const system = systemScheme(false);
    render(<ThemeMenu />);
    expect(menuButton('Match system').getAttribute('aria-haspopup')).toBe('menu');
    expect(theme()).toBe('light');
    system.change(true);
    expect(theme()).toBe('dark');
    system.change(false);
    expect(theme()).toBe('light');
  });

  test('offers the three modes with the one in use checked, and a chosen theme stays whatever the system says', async () => {
    const system = systemScheme(false);
    const user = userEvent.setup();
    render(<ThemeMenu />);

    await user.click(menuButton('Match system'));
    expect(screen.getByRole('menu', { name: 'Theme' })).toBeTruthy();
    expect(menuButton('Match system').getAttribute('aria-expanded')).toBe('true');
    expect(choices().map((item) => item.textContent)).toEqual(['Match system', 'Light', 'Dark']);
    expect(checked()).toEqual(['Match system']);
    expect(document.activeElement).toBe(choices()[0]);

    await user.click(screen.getByRole('menuitemradio', { name: 'Dark' }));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(theme()).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(document.activeElement).toBe(menuButton('Dark'));

    system.change(true);
    system.change(false);
    expect(theme()).toBe('dark');
  });

  test('a theme chosen before is shown from the start, and Match system forgets it', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    const system = systemScheme(true);
    const user = userEvent.setup();
    render(<ThemeMenu />);
    expect(theme()).toBe('light');

    await user.click(menuButton('Light'));
    expect(checked()).toEqual(['Light']);
    await user.click(screen.getByRole('menuitemradio', { name: 'Match system' }));
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(theme()).toBe('dark');
    system.change(false);
    expect(theme()).toBe('light');
  });

  test('works from the keyboard: the arrow keys open it and move, Enter picks, and Escape closes it', async () => {
    systemScheme(false);
    const user = userEvent.setup();
    render(<ThemeMenu />);
    menuButton('Match system').focus();

    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(choices()[0]);
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(choices()[1]);
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(document.activeElement).toBe(choices()[2]);
    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(choices()[0]);
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(choices()[2]);

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(menuButton('Match system'));
    expect(theme()).toBe('light');

    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(theme()).toBe('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(document.activeElement).toBe(menuButton('Light'));
  });

  test('a click outside, or Tab, closes it without choosing', async () => {
    systemScheme(false);
    const user = userEvent.setup();
    render(
      <>
        <ThemeMenu />
        <button type="button">Elsewhere</button>
      </>,
    );
    await user.click(menuButton('Match system'));
    await user.click(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(screen.queryByRole('menu')).toBeNull();

    await user.click(menuButton('Match system'));
    await user.tab();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  test('Escape in the menu goes no further than the menu', async () => {
    systemScheme(false);
    const user = userEvent.setup();
    const onKeyDown = vi.fn();
    window.addEventListener('keydown', onKeyDown);
    try {
      render(<ThemeMenu />);
      await user.click(menuButton('Match system'));
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('menu')).toBeNull();
      expect(onKeyDown).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', onKeyDown);
    }
  });
});
