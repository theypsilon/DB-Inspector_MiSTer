import assert from 'node:assert/strict';
import test from 'node:test';

import { INITIAL_FILTER_SYNC, reduceFilterSync } from '../../src/lib/filterSync.js';

const NO_URL_FILTER = { isPresent: false, value: '' };

function sourceChanged(state, { hasInspection = true, sharedFilter = NO_URL_FILTER, effectiveDefaultFilter = '' } = {}) {
  return reduceFilterSync(state, { type: 'sourceChanged', hasInspection, sharedFilter, effectiveDefaultFilter });
}

function settle(state, debouncedFilter, hasInspection = true) {
  return reduceFilterSync(state, { type: 'filterSettled', hasInspection, debouncedFilter }).state;
}

test('a new source resets FILTER to its effective default', () => {
  const { state, filterToApply } = sourceChanged(INITIAL_FILTER_SYNC, { effectiveDefaultFilter: 'arcade' });

  assert.equal(filterToApply, 'arcade');
  assert.deepEqual(state, { preservedFilter: null, expectedFilter: 'arcade', urlWritesEnabled: false });
});

test('the URL filter wins over the default, and a preserved filter wins over both', () => {
  const sharedFilter = { isPresent: true, value: 'from-url' };
  assert.equal(sourceChanged(INITIAL_FILTER_SYNC, { sharedFilter, effectiveDefaultFilter: 'arcade' }).filterToApply, 'from-url');

  const { state: preserved } = reduceFilterSync(INITIAL_FILTER_SYNC, { type: 'preserveFilter', filter: 'manual' });
  const { state, filterToApply } = sourceChanged(preserved, { sharedFilter, effectiveDefaultFilter: 'arcade' });
  assert.equal(filterToApply, 'manual');
  assert.equal(state.preservedFilter, null);
});

test('an explicitly empty URL filter still overrides the default', () => {
  const { filterToApply } = sourceChanged(INITIAL_FILTER_SYNC, {
    sharedFilter: { isPresent: true, value: '' },
    effectiveDefaultFilter: 'arcade',
  });

  assert.equal(filterToApply, '');
});

test('a preserved filter waits for the database that is still loading', () => {
  const { state: preserved } = reduceFilterSync(INITIAL_FILTER_SYNC, { type: 'preserveFilter', filter: 'manual' });

  const loading = sourceChanged(preserved, { hasInspection: false, effectiveDefaultFilter: 'arcade' });
  assert.equal(loading.filterToApply, null);
  assert.equal(loading.state.preservedFilter, 'manual');

  assert.equal(sourceChanged(loading.state, { effectiveDefaultFilter: 'arcade' }).filterToApply, 'manual');
});

test('with nothing loaded and nothing to apply, FILTER is left alone', () => {
  const { state, filterToApply } = sourceChanged(
    { preservedFilter: null, expectedFilter: 'old', urlWritesEnabled: true },
    { hasInspection: false, effectiveDefaultFilter: 'arcade' },
  );

  assert.equal(filterToApply, null);
  assert.deepEqual(state, { preservedFilter: null, expectedFilter: '', urlWritesEnabled: false });
});

test('URL writes resume once the debounced FILTER catches up, and stay on while typing', () => {
  const { state: afterReset } = sourceChanged(INITIAL_FILTER_SYNC, { effectiveDefaultFilter: 'arcade' });

  const stale = settle(afterReset, 'previous-source-filter');
  assert.equal(stale.urlWritesEnabled, false);

  const caughtUp = settle(stale, 'arcade');
  assert.equal(caughtUp.urlWritesEnabled, true);

  assert.equal(settle(caughtUp, 'arcade !cheats').urlWritesEnabled, true);
  assert.equal(settle(caughtUp, 'arcade', false).urlWritesEnabled, false);
});

test('unknown events are rejected', () => {
  assert.throws(() => reduceFilterSync(INITIAL_FILTER_SYNC, { type: 'nope' }), /Unknown filter sync event/);
});
