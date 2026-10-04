import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SELECTION_SUMMARY_LIMIT,
  listedPickerEntries,
  summarizePickerSelection,
} from '../../src/lib/pickerSelection.js';

const entry = (dbId, extra = {}) => ({ key: `key:${dbId}`, dbId, title: `${dbId} title`, ...extra });

test('the selection summary names the first selected databases and counts the rest', () => {
  const many = Array.from({ length: SELECTION_SUMMARY_LIMIT + 3 }, (_, index) => entry(`db_${index}`));
  const summary = summarizePickerSelection(many);
  assert.deepEqual(
    summary.named.map(({ dbId }) => dbId),
    many.slice(0, SELECTION_SUMMARY_LIMIT).map(({ dbId }) => dbId),
  );
  assert.equal(summary.more, 3);

  // A selection that fits is named in full.
  const few = [entry('a'), entry('b'), entry('c'), entry('d')];
  assert.deepEqual(summarizePickerSelection(few), { named: few, more: 0 });
  assert.deepEqual(summarizePickerSelection([]), { named: [], more: 0 });
});

test('reviewing lists the entries selected when the review started, unchecked or not, and the search still applies', () => {
  const entries = [entry('alpha'), entry('beta', { dbUrl: 'https://example.com/beta.json' }), entry('gamma'), entry('delta')];
  const reviewKeys = new Set(['key:alpha', 'key:beta', 'key:gamma']);

  assert.deepEqual(
    listedPickerEntries(entries, { query: '' }).map(({ dbId }) => dbId),
    ['alpha', 'beta', 'gamma', 'delta'],
  );
  // The review keeps its own keys: unchecking an entry does not take it off the list.
  assert.deepEqual(
    listedPickerEntries(entries, { query: '', reviewKeys }).map(({ dbId }) => dbId),
    ['alpha', 'beta', 'gamma'],
  );
  assert.deepEqual(
    listedPickerEntries(entries, { query: 'example.com', reviewKeys }).map(({ dbId }) => dbId),
    ['beta'],
  );
  assert.deepEqual(listedPickerEntries(entries, { query: 'delta', reviewKeys }), []);
});
