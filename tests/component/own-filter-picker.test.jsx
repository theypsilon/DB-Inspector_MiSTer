import { describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import OwnFilterPicker, { OWN_FILTER_SEARCH_FROM } from '../../src/components/OwnFilterPicker.jsx';
import { text } from './support.js';

// The button that gives a combined database its own filter, and the list of databases it opens:
// what each shows, the keys and the search, and that only Enter or a click picks one.

const FEW = [
  { dbId: 'update_all_mister', effectiveFilter: 'arcade', filterSource: 'shared' },
  { dbId: 'jtcores', effectiveFilter: '!cheats', filterSource: 'default' },
  { dbId: 'Coin-OpCollection/Distribution-MiSTerFPGA', effectiveFilter: '', filterSource: 'none' },
];
const MANY = [
  ...FEW,
  ...['distribution_mister', 'arcade_roms_db', 'chipster6502/artworkdb-arcade', 'bios_db', 'names_txt'].map((dbId) => ({
    dbId,
    effectiveFilter: 'arcade',
    filterSource: 'shared',
  })),
];

function open(databases) {
  const onPick = vi.fn();
  render(
    <div>
      <OwnFilterPicker databases={databases} onPick={onPick} />
      <p>Outside</p>
    </div>,
  );
  return { onPick, user: userEvent.setup(), button: screen.getByRole('button', { name: 'Own filter for a database' }) };
}

const list = () => screen.queryByRole('listbox', { name: 'Databases without their own filter' });
const options = () => within(list()).getAllByRole('option');
const highlighted = () => options().filter((option) => option.getAttribute('aria-selected') === 'true').map((option) => text(option.querySelector('.own-filter-option-id')));

describe('the own-filter picker', () => {
  test('lists the databases without their own filter, each with the filter it gets now and where from', async () => {
    const { user, button } = open(FEW);
    expect(button.getAttribute('aria-haspopup')).toBe('listbox');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(list()).toBeNull();

    await user.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.getAttribute('aria-controls')).toBe(list().id);
    expect(options().map(text)).toEqual([
      'update_all_mister arcade · shared filter',
      'jtcores !cheats · database default',
      'Coin-OpCollection/Distribution-MiSTerFPGA Everything · no filter',
    ]);
    // The separator is for the eye only.
    expect(options()[0].querySelector('[aria-hidden="true"]').textContent).toBe(' · ');
    // A few databases need no search: the list has the focus, on the first.
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(document.activeElement).toBe(list());
    expect(highlighted()).toEqual(['update_all_mister']);
    expect(list().getAttribute('aria-activedescendant')).toBe(options()[0].id);
  });

  test('the arrow keys only move the highlight; Enter picks it, and the list closes', async () => {
    const { onPick, user, button } = open(FEW);
    // From the button, an arrow opens the list and picks nothing.
    button.focus();
    await user.keyboard('{ArrowDown}');
    expect(list()).not.toBeNull();
    expect(onPick).not.toHaveBeenCalled();

    await user.keyboard('{ArrowDown}');
    expect(highlighted()).toEqual(['jtcores']);
    expect(list().getAttribute('aria-activedescendant')).toBe(options()[1].id);
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(highlighted()).toEqual(['update_all_mister']);
    await user.keyboard('{ArrowUp}');
    expect(highlighted()).toEqual(['Coin-OpCollection/Distribution-MiSTerFPGA']);
    await user.keyboard('{Home}');
    expect(highlighted()).toEqual(['update_all_mister']);
    await user.keyboard('{End}');
    expect(highlighted()).toEqual(['Coin-OpCollection/Distribution-MiSTerFPGA']);
    expect(onPick).not.toHaveBeenCalled();

    await user.keyboard('{ArrowUp}{Enter}');
    expect(onPick.mock.calls).toEqual([['jtcores']]);
    expect(list()).toBeNull();
  });

  test('a click picks a database, and the pointer moves the highlight', async () => {
    const { onPick, user, button } = open(FEW);
    await user.click(button);
    await user.hover(options()[2]);
    expect(highlighted()).toEqual(['Coin-OpCollection/Distribution-MiSTerFPGA']);
    await user.click(options()[1]);
    expect(onPick.mock.calls).toEqual([['jtcores']]);
    expect(list()).toBeNull();
  });

  test('Escape closes it and gives the focus back to the button, and only it hears the key; Tab, a click outside and the button close it too', async () => {
    const { onPick, user, button } = open(FEW);
    const heard = vi.fn();
    window.addEventListener('keydown', heard);
    try {
      await user.click(button);
      await user.keyboard('{Escape}');
      expect(list()).toBeNull();
      expect(document.activeElement).toBe(button);
      // A dialog around it would not close.
      expect(heard).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', heard);
    }

    await user.click(button);
    await user.tab();
    expect(list()).toBeNull();
    await user.click(button);
    await user.click(screen.getByText('Outside'));
    expect(list()).toBeNull();
    await user.click(button);
    await user.click(button);
    expect(list()).toBeNull();
    expect(onPick).not.toHaveBeenCalled();
  });

  test(`from ${OWN_FILTER_SEARCH_FROM} databases, a search box finds them by any part of their db_id`, async () => {
    expect(MANY).toHaveLength(OWN_FILTER_SEARCH_FROM);
    const { onPick, user, button } = open(MANY);
    await user.click(button);
    const search = screen.getByRole('combobox', { name: 'Search databases' });
    expect(document.activeElement).toBe(search);
    expect(search.getAttribute('aria-controls')).toBe(list().id);
    expect(search.getAttribute('aria-activedescendant')).toBe(options()[0].id);
    expect(options()).toHaveLength(8);

    await user.keyboard('{ArrowDown}');
    expect(highlighted()).toEqual(['jtcores']);
    // Typing starts the highlight again from the first match.
    await user.keyboard('ARCADE');
    expect(options().map((option) => text(option.querySelector('.own-filter-option-id')))).toEqual(['arcade_roms_db', 'chipster6502/artworkdb-arcade']);
    expect(highlighted()).toEqual(['arcade_roms_db']);
    // Home and End stay in the search box.
    await user.keyboard('{End}{ArrowDown}');
    expect(highlighted()).toEqual(['chipster6502/artworkdb-arcade']);

    await user.keyboard('zzz');
    expect(screen.getByRole('listbox').children).toHaveLength(0);
    expect(screen.getByText('No database has that name.')).toBeTruthy();
    expect(search.getAttribute('aria-activedescendant')).toBeNull();
    await user.keyboard('{Enter}');
    expect(onPick).not.toHaveBeenCalled();

    await user.clear(search);
    await user.keyboard('  Coin-Op  {Enter}');
    expect(onPick.mock.calls).toEqual([['Coin-OpCollection/Distribution-MiSTerFPGA']]);

    // It opens afresh: no search, the first highlighted.
    await user.click(button);
    expect(screen.getByRole('combobox', { name: 'Search databases' }).value).toBe('');
    expect(highlighted()).toEqual(['update_all_mister']);
  });

  test(`below ${OWN_FILTER_SEARCH_FROM} databases there is no search box`, async () => {
    const { user, button } = open(MANY.slice(0, OWN_FILTER_SEARCH_FROM - 1));
    await user.click(button);
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(options()).toHaveLength(OWN_FILTER_SEARCH_FROM - 1);
  });
});
