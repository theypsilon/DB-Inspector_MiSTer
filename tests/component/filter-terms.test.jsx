import { describe, expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

import FilterTermsModal from '../../src/components/modals/FilterTermsModal.jsx';
import { buildFilterTerms } from '../../src/lib/filterTerms.js';
import { FILTER_INPUT_DEBOUNCE_MS } from '../../src/lib/utils.js';
import { inspect, text } from './support.js';

// The filter terms dialog: the terms it lists, its search, and what Keep and Exclude write.

const database = (dbId, tagDictionary, files) => ({
  db_id: dbId,
  v: 1,
  timestamp: 1710000000,
  base_files_url: `https://example.com/${dbId}/`,
  ...(tagDictionary ? { tag_dictionary: tagDictionary } : {}),
  files,
  folders: {},
});

const ALPHA = database('alpha', { famicom: 0, nes: 0, nintendo: 0, cheats: 1 }, {
  'games/a.nes': { size: 1, hash: 'a', tags: [0] },
  'games/b.nes': { size: 1, hash: 'b', tags: [0] },
  'cheats/a.zip': { size: 1, hash: 'c', tags: [1] },
});
const LONG = database('Coin-OpCollection/Distribution-MiSTerFPGA', { nes: 0, arcade: 1 }, { 'x.nes': { size: 1, hash: 'x', tags: [0] } });
const NAMES = database('names_txt', null, { 'names.txt': { size: 1, hash: 'n' } });

async function termsOf(...databases) {
  return buildFilterTerms(await Promise.all(databases.map(async (db) => ({ dbId: db.db_id, inspection: await inspect(db) }))));
}

const SETTLED = { kept: 3, total: 3, pending: false, invalid: false };

// The dialog as the page holds it: FILTER in state, changed by the dialog.
function Harness({ terms, withoutTerms, combined, initialFilter, sharedFilter, matches = SETTLED, search, onChange, onSearchChange, onClose }) {
  const [filter, setFilter] = useState(initialFilter);
  return (
    <FilterTermsModal
      intro="Keep or exclude the terms."
      terms={terms}
      withoutTerms={withoutTerms}
      combined={combined}
      filter={filter}
      sharedFilter={sharedFilter}
      matches={matches}
      search={search}
      onFilterChange={(next) => {
        onChange(next);
        setFilter(next);
      }}
      onSearchChange={onSearchChange}
      onClose={onClose}
    />
  );
}

function open({ terms, withoutTerms }, { combined = false, filter = '', sharedFilter, matches, search } = {}) {
  const handlers = { onChange: vi.fn(), onSearchChange: vi.fn(), onClose: vi.fn() };
  const result = render(
    <Harness
      terms={terms}
      withoutTerms={withoutTerms}
      combined={combined}
      initialFilter={filter}
      sharedFilter={sharedFilter}
      matches={matches}
      search={search}
      {...handlers}
    />,
  );
  return { ...handlers, ...result, user: userEvent.setup(), dialog: screen.getByRole('dialog', { name: 'Filter terms' }) };
}

// Each term's lines: its names, then its entries and databases.
function rows() {
  return [...document.querySelectorAll('.filter-term')].map((row) => [...row.querySelectorAll('.filter-term-text p')].map(text).join(' '));
}

function row(name) {
  return [...document.querySelectorAll('.filter-term')].find((candidate) => text(candidate.querySelector('strong')) === name);
}

describe('the filter terms', () => {
  test('list each term once, with its other names and the entries tagged with it; the dictionary number is in its tooltip', async () => {
    open(await termsOf(ALPHA));
    // The most used first.
    expect(rows()).toEqual(['nes also famicom, nintendo 2 entries', 'cheats 1 entry']);
    expect(row('nes').querySelector('strong').title).toBe('Tag 0 in the tag dictionary');
    // The search box has the focus.
    expect(document.activeElement).toBe(screen.getByLabelText('Search terms'));
  });

  test('Keep and Exclude write the term in FILTER, show when it is there, and take it out again', async () => {
    const { user, onChange } = open(await termsOf(ALPHA), { filter: '[mister] arcade' });
    const keep = within(row('nes')).getByRole('button', { name: 'Keep nes' });
    const exclude = within(row('nes')).getByRole('button', { name: 'Exclude nes' });
    expect([keep.getAttribute('aria-pressed'), exclude.getAttribute('aria-pressed')]).toEqual(['false', 'false']);

    await user.click(keep);
    expect(onChange).toHaveBeenLastCalledWith('[mister] arcade nes');
    expect(keep.getAttribute('aria-pressed')).toBe('true');
    expect(text(document.querySelector('.filter-terms-current code'))).toBe('[mister] arcade nes');

    await user.click(exclude);
    expect(onChange).toHaveBeenLastCalledWith('[mister] arcade !nes');
    expect([keep.getAttribute('aria-pressed'), exclude.getAttribute('aria-pressed')]).toEqual(['false', 'true']);

    await user.click(exclude);
    expect(onChange).toHaveBeenLastCalledWith('[mister] arcade');
    await user.click(within(row('cheats')).getByRole('button', { name: 'Exclude cheats' }));
    expect(onChange).toHaveBeenLastCalledWith('[mister] arcade !cheats');

  });

  test('a database’s own filter includes the shared filter with a checkbox above FILTER, while the shared filter has terms', async () => {
    const terms = await termsOf(ALPHA);
    const { user, onChange } = open(terms, { combined: true, filter: 'nes', sharedFilter: ' arcade !cheats ' });
    const include = screen.getByRole('checkbox', { name: 'Include the shared filter ([mister]) arcade !cheats' });
    // A line of its own in the footer, above FILTER.
    expect([...document.querySelector('.modal-footer').children].map((child) => child.className)).toEqual(['filter-terms-shared', 'filter-terms-current', '']);
    expect(include.checked).toBe(false);

    await user.click(include);
    expect(onChange).toHaveBeenLastCalledWith('[mister] nes');
    expect(include.checked).toBe(true);
    expect(text(document.querySelector('.filter-terms-current code'))).toBe('[mister] nes');
    // Terms chosen after it leave it in; leaving it out leaves them.
    await user.click(within(row('cheats')).getByRole('button', { name: 'Exclude cheats' }));
    expect(onChange).toHaveBeenLastCalledWith('[mister] nes !cheats');
    expect(include.checked).toBe(true);
    await user.click(include);
    expect(onChange).toHaveBeenLastCalledWith('nes !cheats');
    expect(include.checked).toBe(false);

    // Written by hand, in any letter case, it is there.
    document.body.innerHTML = '';
    open(terms, { combined: true, filter: 'nes [MiSTer]', sharedFilter: 'arcade' });
    expect(screen.getByRole('checkbox', { name: 'Include the shared filter ([mister]) arcade' }).checked).toBe(true);

    // Without terms in the shared filter, there is nothing to include; nor without a shared filter
    // to include (FILTER, or the shared filter's own terms).
    for (const sharedFilter of ['', '  ', undefined]) {
      document.body.innerHTML = '';
      open(terms, { combined: true, filter: '[mister] nes', sharedFilter });
      expect(screen.queryByRole('checkbox')).toBeNull();
      expect(text(document.querySelector('.filter-terms-current code'))).toBe('[mister] nes');
    }
  });

  test('a term in FILTER by another of its names, in any letter case, shows as there', async () => {
    open(await termsOf(ALPHA), { filter: 'Famicom' });
    expect(within(row('nes')).getByRole('button', { name: 'Keep nes' }).getAttribute('aria-pressed')).toBe('true');
  });

  test('FILTER says how many files of all the loaded databases it matches, once it settles', async () => {
    const terms = await termsOf(ALPHA);
    const matches = (value) => {
      document.body.innerHTML = '';
      open(terms, { filter: 'nes', matches: { ...SETTLED, ...value } });
      return text(document.querySelector('.filter-terms-matches'));
    };
    expect(matches({ kept: 1234, total: 21514 })).toBe('Matches 1,234 of 21,514 files');
    expect(matches({ kept: 1, total: 3 })).toBe('Matches 1 of 3 files');
    expect(matches({ kept: 1, total: 1 })).toBe('Matches all 1 file');
    expect(matches({ kept: 0, total: 3 })).toBe('Matches 0 of 3 files');
    // While FILTER settles, the count waits for it.
    expect(matches({ pending: true })).toBe('Counting matches…');
    expect(matches({ invalid: true })).toBe('Not a valid filter, so it matches all 3 files');
    // Screen readers hear the count change.
    expect(document.querySelector('.filter-terms-matches').getAttribute('aria-live')).toBe('polite');
  });

  test('the search finds terms by any of their names, and says when none has it', async () => {
    const { user } = open(await termsOf(ALPHA));
    await user.type(screen.getByLabelText('Search terms'), 'nintendo');
    expect(rows()).toEqual(['nes also famicom, nintendo 2 entries']);
    await user.clear(screen.getByLabelText('Search terms'));
    await user.type(screen.getByLabelText('Search terms'), 'zzz');
    expect(rows()).toEqual([]);
    expect(screen.getByText('No term has that name.')).toBeTruthy();
  });

  test('the search opens with what it is given, and tells what it holds once typing pauses, its ends aside', async () => {
    const terms = await termsOf(ALPHA);
    vi.useFakeTimers();
    try {
      const { onSearchChange } = open(terms, { search: 'cheat' });
      const search = screen.getByLabelText('Search terms');
      expect(search.value).toBe('cheat');
      expect(rows()).toEqual(['cheats 1 entry']);
      // What it opens with is not news to whoever gave it.
      act(() => vi.advanceTimersByTime(FILTER_INPUT_DEBOUNCE_MS));
      expect(onSearchChange).not.toHaveBeenCalled();

      fireEvent.change(search, { target: { value: 'n' } });
      fireEvent.change(search, { target: { value: 'ni' } });
      act(() => vi.advanceTimersByTime(FILTER_INPUT_DEBOUNCE_MS - 1));
      expect(onSearchChange).not.toHaveBeenCalledWith('n');
      expect(onSearchChange).not.toHaveBeenCalledWith('ni');
      act(() => vi.advanceTimersByTime(1));
      expect(onSearchChange).toHaveBeenLastCalledWith('ni');
      expect(onSearchChange).not.toHaveBeenCalledWith('n');

      // Spaces around it find the same terms, so they tell nothing new.
      const told = onSearchChange.mock.calls.length;
      fireEvent.change(search, { target: { value: ' ni ' } });
      act(() => vi.advanceTimersByTime(FILTER_INPUT_DEBOUNCE_MS));
      expect(onSearchChange).toHaveBeenCalledTimes(told);
      fireEvent.change(search, { target: { value: '' } });
      act(() => vi.advanceTimersByTime(FILTER_INPUT_DEBOUNCE_MS));
      expect(onSearchChange).toHaveBeenLastCalledWith('');
      // Back to what it opened with is a change too.
      fireEvent.change(search, { target: { value: 'cheat' } });
      act(() => vi.advanceTimersByTime(FILTER_INPUT_DEBOUNCE_MS));
      expect(onSearchChange).toHaveBeenLastCalledWith('cheat');
    } finally {
      vi.useRealTimers();
    }
  });

  test('combined databases: each term names its databases, a few in full and more as a count, and those without terms are named once', async () => {
    open(await termsOf(ALPHA, LONG, NAMES), { combined: true });
    expect(rows()).toEqual([
      'nes also famicom, nintendo 3 entries alpha Coin-OpCollection/Distribution-MiSTerFPGA',
      'cheats 1 entry alpha',
      // A tag the dictionary has and nothing uses is still a term, last.
      'arcade No entries Coin-OpCollection/Distribution-MiSTerFPGA',
    ]);
    expect(row('nes').querySelector('strong').title).toBe('Tag 0 in alpha\nTag 0 in Coin-OpCollection/Distribution-MiSTerFPGA');
    expect(text(document.querySelector('.filter-terms-without'))).toBe('No terms in names_txt.');

    // Past three databases, a count, with them all in its tooltip.
    const many = await termsOf(...['a', 'b', 'c', 'd'].map((id) => database(id, { nes: 0 }, { [`${id}.nes`]: { size: 1, hash: id, tags: [0] } })));
    document.body.innerHTML = '';
    open(many, { combined: true });
    const count = row('nes').querySelector('.filter-term-meta span[title]');
    expect([text(count), count.title]).toEqual(['4 databases', 'a, b, c, d']);
  });

  test('one database without terms says so, and Done, Escape and a click outside close it', async () => {
    const { user, onClose } = open(await termsOf(NAMES));
    expect(screen.getByText('There are no terms to filter by.')).toBeTruthy();
    expect(text(document.querySelector('.filter-terms-current'))).toBe('FILTER No terms Matches all 3 files');
    // One database's lack of terms is said once, not as a list.
    expect(document.querySelector('.filter-terms-without')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Done' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    await user.click(document.querySelector('.modal-overlay'));
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
