// Keeps the FILTER box and the shared `filter` URL param in step with the loaded source.
//
// - When a new source (or a new default filter) arrives, FILTER is reset to a filter preserved
//   from before the load, else the `filter` URL param, else the effective default.
// - URL writes wait until the debounced FILTER has caught up with that reset value, so a stale
//   filter from the previous source is never shared for the new one.
//
// The app keeps this state in a ref rather than React state: effects running in the same commit
// must see each other's updates immediately.

export const INITIAL_FILTER_SYNC = Object.freeze({
  // FILTER to keep for the next loaded source, or null to let that source decide.
  preservedFilter: null,
  // Value the debounced FILTER must reach before URL writes resume.
  expectedFilter: '',
  urlWritesEnabled: false,
});

// Returns the next state and, for `sourceChanged`, the value FILTER must be reset to (or null).
export function reduceFilterSync(state, event) {
  switch (event.type) {
    case 'preserveFilter':
      return { state: { ...state, preservedFilter: event.filter }, filterToApply: null };

    case 'sourceChanged': {
      const { hasInspection, sharedFilter, effectiveDefaultFilter } = event;
      const { preservedFilter } = state;
      if (preservedFilter === null && !sharedFilter.isPresent && !hasInspection) {
        return { state: { ...state, expectedFilter: '', urlWritesEnabled: false }, filterToApply: null };
      }

      // Still loading: keep the preserved filter for the source that is about to arrive.
      if (preservedFilter !== null && !hasInspection) {
        return { state: { ...state, urlWritesEnabled: false }, filterToApply: null };
      }

      const filter =
        preservedFilter !== null
          ? preservedFilter
          : sharedFilter.isPresent
            ? sharedFilter.value
            : effectiveDefaultFilter;
      return {
        state: { preservedFilter: null, expectedFilter: filter, urlWritesEnabled: false },
        filterToApply: filter,
      };
    }

    case 'filterSettled': {
      if (!event.hasInspection) {
        return { state: { ...state, urlWritesEnabled: false }, filterToApply: null };
      }

      if (event.debouncedFilter === state.expectedFilter) {
        return { state: { ...state, urlWritesEnabled: true }, filterToApply: null };
      }

      return { state, filterToApply: null };
    }

    default:
      throw new Error(`Unknown filter sync event: ${event.type}`);
  }
}
