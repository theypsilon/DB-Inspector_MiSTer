// Flat row indexes for the filesystem and archive trees, plus the collapse/detail state helpers
// that operate on them.

export function buildFlatNodeIndex(nodes) {
  const index = createRowIndex();

  nodes.forEach((node, nodeIndex) => {
    index.rootIds.push(addNodeRows(index, node, 0, [], nodeIndex, nodes.length, null));
  });

  return index;
}

export function buildFlatArchiveIndex(archiveViews) {
  const index = createRowIndex();

  archiveViews.forEach((archive, archiveIndex) => {
    const childIds = [];
    const isLastSibling = archiveIndex === archiveViews.length - 1;
    const row = {
      id: archive.nodeId,
      type: 'archive',
      archive,
      parentId: null,
      depth: 0,
      childIds,
      isLastSibling,
      ancestorContinuationDepths: [],
      canCollapse: true,
    };

    index.rowsById.set(row.id, row);
    index.rootIds.push(row.id);
    index.collapsibleIds.push(row.id);

    const nextAncestorContinuationDepths = isLastSibling ? [] : [0];

    archive.tree.children.forEach((child, childIndex) => {
      childIds.push(
        addNodeRows(
          index,
          child,
          1,
          nextAncestorContinuationDepths,
          childIndex,
          archive.tree.children.length,
          row.id,
        ),
      );
    });
  });

  return index;
}

function createRowIndex() {
  return {
    rootIds: [],
    rowsById: new Map(),
    collapsibleIds: [],
  };
}

function addNodeRows(index, node, depth, ancestorContinuationDepths, siblingIndex, siblingCount, parentId) {
  const childIds = [];
  const isLastSibling = siblingIndex === siblingCount - 1;
  const row = {
    id: node.id,
    type: 'node',
    node,
    parentId,
    depth,
    childIds,
    isLastSibling,
    ancestorContinuationDepths,
    canCollapse: node.kind === 'file' || (Array.isArray(node.children) && node.children.length > 0),
  };

  index.rowsById.set(row.id, row);
  if (row.canCollapse) {
    index.collapsibleIds.push(row.id);
  }

  if (Array.isArray(node.children) && node.children.length) {
    const nextAncestorContinuationDepths = isLastSibling
      ? ancestorContinuationDepths
      : ancestorContinuationDepths.concat(depth);

    node.children.forEach((child, childIndex) => {
      childIds.push(
        addNodeRows(
          index,
          child,
          depth + 1,
          nextAncestorContinuationDepths,
          childIndex,
          node.children.length,
          row.id,
        ),
      );
    });
  }

  return row.id;
}

export function getRowBadge(row) {
  if (row.type === 'archive') {
    return { badge: 'ZIP', badgeClassName: 'node-badge archive-badge' };
  }

  if (row.node.kind === 'collision') {
    return { badge: row.node.badge, badgeClassName: 'node-badge collision-badge' };
  }

  return {
    badge: row.node.badge,
    badgeClassName: `node-badge ${row.node.kind === 'file' ? 'file-badge' : 'folder-badge'}`,
  };
}

// The ids of a row's ancestors, nearest first: the rows to expand to show it.
export function findAncestorIds(rowsById, rowId) {
  const ancestorIds = [];
  let parentId = rowsById.get(rowId)?.parentId;
  while (parentId) {
    ancestorIds.push(parentId);
    parentId = rowsById.get(parentId)?.parentId;
  }

  return ancestorIds;
}

// The rows "Close all" collapses: folders and archives with entries (files have nothing to hide).
export function findCollapsibleRowIds(index) {
  return index.collapsibleIds.filter((id) => {
    const row = index.rowsById.get(id);
    return row && row.type === 'node' ? row.node.kind !== 'file' : row?.childIds?.length > 0;
  });
}

export function collectVisibleRowIds(rootIds, rowsById, collapsedIds) {
  const visibleRowIds = [];

  function visit(rowId) {
    const row = rowsById.get(rowId);
    if (!row) {
      return;
    }

    visibleRowIds.push(rowId);
    if (row.childIds.length && !collapsedIds.has(row.id)) {
      for (const childId of row.childIds) {
        visit(childId);
      }
    }
  }

  for (const rowId of rootIds) {
    visit(rowId);
  }

  return visibleRowIds;
}

export function toggleSetMembership(currentSet, value) {
  const next = new Set(currentSet);
  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }

  return next;
}

export function setSetMembership(currentSet, value, shouldHave) {
  const hasValue = currentSet.has(value);
  if (hasValue === shouldHave) {
    return currentSet;
  }

  const next = new Set(currentSet);
  if (shouldHave) {
    next.add(value);
  } else {
    next.delete(value);
  }

  return next;
}

export function toggleDetailOverride(currentMap, rowId, defaultDetailed) {
  const currentVisible = currentMap.get(rowId) ?? defaultDetailed;
  const nextVisible = !currentVisible;
  const next = new Map(currentMap);

  if (nextVisible === defaultDetailed) {
    next.delete(rowId);
  } else {
    next.set(rowId, nextVisible);
  }

  return next;
}

export function setDetailVisibilityOverride(currentMap, rowId, nextVisible, defaultDetailed) {
  const currentVisible = currentMap.get(rowId) ?? defaultDetailed;
  if (currentVisible === nextVisible) {
    return currentMap;
  }

  const next = new Map(currentMap);
  if (nextVisible === defaultDetailed) {
    next.delete(rowId);
  } else {
    next.set(rowId, nextVisible);
  }

  return next;
}
