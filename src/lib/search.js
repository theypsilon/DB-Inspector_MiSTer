// Find-in-page: the rows and FILTER hint that match a query, in page order.

// No query matches nothing, always with the same array, so it never looks like new matches.
const EMPTY_MATCHES = Object.freeze([]);

function searchIndex(index, section, query, result) {
  if (!index) return;
  for (const [id, row] of index.rowsById) {
    const name = (row.type === 'archive' ? row.archive.title : row.node.name) || '';
    const path = row.type !== 'archive' ? row.node.path || '' : '';
    if (name.toLowerCase().includes(query)) {
      result.push({ rowId: id, section, matchPart: 'name' });
    } else if (path && path !== name && path.toLowerCase().includes(query)) {
      result.push({ rowId: id, section, matchPart: 'path' });
    } else {
      const fields = row.type === 'archive' ? row.archive.primaryFields : row.node.primaryFields;
      const hasTagMatch = fields?.some(
        (field) =>
          field.kind === 'tags' && Array.isArray(field.value) && field.value.some((tag) => tag.label.toLowerCase().includes(query)),
      );
      if (hasTagMatch) {
        result.push({ rowId: id, section, matchPart: 'tags' });
      }
    }
  }
}

// The matches of `query`: the FILTER panel's `essential` hint, then rows of the Files and folders,
// Archives and Path collisions sections (by name, else path, else tags).
export function findSearchMatches({ query, filesystemIndex, archivesIndex, collisionsIndex, hasEssentialHint }) {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return EMPTY_MATCHES;
  const result = [];

  if (hasEssentialHint && 'essential'.includes(trimmed)) {
    result.push({ rowId: 'filter-essential-hint', section: 'filter', matchPart: 'name' });
  }

  searchIndex(filesystemIndex, 'filesystem', trimmed, result);
  searchIndex(archivesIndex, 'archives', trimmed, result);
  searchIndex(collisionsIndex, 'collisions', trimmed, result);

  return result;
}

// The match after `index` (Enter), before it (Shift+Enter), or at a 1-based position, wrapping.
export function nextMatchIndex(index, count) {
  return (index + 1) % count;
}

export function previousMatchIndex(index, count) {
  return (index - 1 + count) % count;
}

export function matchIndexAt(oneBasedIndex, count) {
  return Math.max(0, Math.min(count - 1, oneBasedIndex - 1));
}
