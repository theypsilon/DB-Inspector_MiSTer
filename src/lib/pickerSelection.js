import { findDbIdConflict, selectOnePerDbId, selectPreset } from './selection.js';

// The selection of a database picker: the selected entries' keys, and a db_id conflict waiting for
// an answer ({ selected, incoming }: the selected entry and the one that would replace it). A
// selection holds one entry per db_id.

export function startPickerSelection(initialSelectedKeys) {
  return { selectedKeys: new Set(initialSelectedKeys), conflict: null };
}

// How an entry is named to assistive technology: by db_id, plus where it comes from or its title.
export function describePickerEntry(entry) {
  if (entry.origin) {
    return `${entry.dbId} (${entry.origin})`;
  }

  return entry.title ? `${entry.title} (${entry.dbId})` : entry.dbId;
}

export function openButtonLabel(count) {
  if (count === 1) {
    return 'Open selected database';
  }

  return count ? `Open ${count} selected databases` : 'Open selected databases';
}

// The [mister] filter chosen in a list or upload picker (see buildListChoice and buildUploadChoice):
// the first one at first, or none.
export function firstMisterKey(choice) {
  return choice.misterOptions[0]?.key ?? null;
}

export function chosenMisterFilter(choice, misterKey) {
  return choice.misterOptions.find((option) => option.key === misterKey)?.filter ?? null;
}

// The entries whose db_id, title, URL or origin contain the (lowercase) search query.
export function filterPickerEntries(entries, query) {
  if (!query) {
    return entries;
  }

  return entries.filter((entry) =>
    `${entry.dbId} ${entry.title ?? ''} ${entry.dbUrl ?? ''} ${entry.origin ?? ''}`.toLowerCase().includes(query),
  );
}

export function selectedPickerEntries(entries, { selectedKeys }) {
  return entries.filter((entry) => selectedKeys.has(entry.key));
}

// How many selected databases the picker's summary names; it counts the rest.
export const SELECTION_SUMMARY_LIMIT = 10;

// The selected entries the summary names, and how many more are selected.
export function summarizePickerSelection(selectedEntries, limit = SELECTION_SUMMARY_LIMIT) {
  return { named: selectedEntries.slice(0, limit), more: Math.max(0, selectedEntries.length - limit) };
}

// The entries the picker lists: those matching the search, among `reviewKeys` (the selection when
// its review started, so that entries unchecked while reviewing stay in place) when reviewing.
export function listedPickerEntries(entries, { query, reviewKeys = null }) {
  const matching = filterPickerEntries(entries, query);
  return reviewKeys ? matching.filter((entry) => reviewKeys.has(entry.key)) : matching;
}

// Whether every db_id among the entries has one of them selected ("Select all" turns into "Select
// none"). Among the entries shown, a db_id selected through an entry the search hides does not count.
export function allPickerDbIdsSelected(entries, selection) {
  const selectedDbIds = new Set(selectedPickerEntries(entries, selection).map((entry) => entry.dbId));
  return entries.length > 0 && entries.every((entry) => selectedDbIds.has(entry.dbId));
}

// The label of the button that selects or unselects the entries shown: all of them, or the ones the
// search or the review of the selection leaves.
export function pickerToggleAllLabel(entries, shown, selection) {
  const all = shown.length === entries.length;
  if (allPickerDbIdsSelected(shown, selection)) {
    return all ? 'Select none' : 'Unselect shown';
  }

  return all ? 'Select all' : 'Select shown';
}

// Applies a picker action. `entries` are the picker's entries, and `preferredKeys` decide which
// entry of a db_id "Select all" picks after the ones already chosen.
//   { type: 'toggle', entry }: selects or unselects an entry; a db_id that is already selected
//     raises a conflict instead.
//   { type: 'replaceConflict' } / { type: 'cancelConflict' }: answers the conflict.
//   { type: 'toggleAll', shown }: selects one entry per db_id among the shown entries (all of them
//     unless given), or unselects them when all are selected; the rest of the selection stays.
//   { type: 'preset', keys }: selects the preset's entries, one per db_id.
export function reducePickerSelection(selection, action, { entries, preferredKeys = [] }) {
  const { selectedKeys, conflict } = selection;
  switch (action.type) {
    case 'toggle': {
      const { entry } = action;
      if (selectedKeys.has(entry.key)) {
        const next = new Set(selectedKeys);
        next.delete(entry.key);
        return { ...selection, selectedKeys: next };
      }

      const selected = findDbIdConflict(entries, selectedKeys, entry);
      if (selected) {
        return { ...selection, conflict: { selected, incoming: entry } };
      }

      return { ...selection, selectedKeys: new Set(selectedKeys).add(entry.key) };
    }
    case 'replaceConflict': {
      if (!conflict) {
        return selection;
      }

      const next = new Set(selectedKeys);
      next.delete(conflict.selected.key);
      next.add(conflict.incoming.key);
      return { selectedKeys: next, conflict: null };
    }
    case 'cancelConflict':
      return conflict ? { ...selection, conflict: null } : selection;
    case 'toggleAll': {
      const shown = action.shown ?? entries;
      const selected = selectedPickerEntries(entries, selection);
      if (allPickerDbIdsSelected(shown, selection)) {
        const shownKeys = new Set(shown.map((entry) => entry.key));
        const kept = selected.filter((entry) => !shownKeys.has(entry.key)).map((entry) => entry.key);
        return { ...selection, selectedKeys: new Set(kept) };
      }

      // Selecting keeps the shown entries already chosen for a db_id, then prefers `preferredKeys`.
      // A db_id chosen through an entry the search hides takes a shown one instead, so that every
      // entry shown ends up checked or sharing its db_id with one that is.
      const shownDbIds = new Set(shown.map((entry) => entry.dbId));
      const kept = selected.filter((entry) => !shownDbIds.has(entry.dbId)).map((entry) => entry.key);
      const chosen = selectOnePerDbId(shown, [...selected.map((entry) => entry.key), ...preferredKeys]);
      return { ...selection, selectedKeys: new Set([...kept, ...chosen]) };
    }
    case 'preset':
      return { ...selection, selectedKeys: new Set(selectPreset(entries, action.keys)) };
    default:
      throw new Error(`Unknown picker action: ${action.type}`);
  }
}
