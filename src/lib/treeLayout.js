// Tree row styling and the virtualization layout math (row offsets, visible window, scroll
// anchoring). Changes here must be re-verified in a real browser, including against a real database.

export const TREE_LIST_GAP_PX = 13;
export const TREE_OVERSCAN_PX = 900;

export function buildTreeDepthStyle(depth) {
  return { '--tree-depth': depth };
}

export function buildTreeGuideStyle(depth) {
  return { '--tree-guide-depth': depth };
}

export function buildVirtualRowStyle(top, { trimTopGuide = false, trimBottomGuide = false } = {}) {
  return {
    position: 'absolute',
    top: `${top}px`,
    left: 0,
    right: 0,
    '--tree-guide-top-overlap': trimTopGuide ? '0px' : 'var(--tree-guide-overlap)',
    '--tree-guide-bottom-overlap': trimBottomGuide ? '0px' : 'var(--tree-guide-overlap)',
  };
}

export function getRowMeasurementKey(rowId, { collapsed, detailsVisible }) {
  return `${rowId}:${collapsed ? '1' : '0'}:${detailsVisible ? '1' : '0'}`;
}

export function buildVirtualRowLayout({
  rowIds,
  rowsById,
  collapsedIds,
  detailOverrides,
  defaultDetailed,
  measuredHeights,
}) {
  if (!rowIds.length) {
    return {
      rowIds: [],
      rowIndexById: new Map(),
      offsets: [],
      bottoms: [],
      totalHeight: 0,
    };
  }

  const offsets = new Array(rowIds.length);
  const bottoms = new Array(rowIds.length);
  const rowIndexById = new Map();
  let totalHeight = 0;

  for (let index = 0; index < rowIds.length; index += 1) {
    const rowId = rowIds[index];
    const row = rowsById.get(rowId);
    rowIndexById.set(rowId, index);
    const collapsed = collapsedIds.has(rowId);
    const detailsVisible = detailOverrides.get(rowId) ?? defaultDetailed;
    const measuredHeight = measuredHeights.get(
      getRowMeasurementKey(rowId, { collapsed, detailsVisible }),
    );
    const rowHeight =
      measuredHeight ?? estimateRowHeight(row, { collapsed, detailsVisible });

    offsets[index] = totalHeight;
    bottoms[index] = totalHeight + rowHeight;
    totalHeight += rowHeight;

    if (index < rowIds.length - 1) {
      totalHeight += TREE_LIST_GAP_PX;
    }
  }

  return {
    rowIds,
    rowIndexById,
    offsets,
    bottoms,
    totalHeight,
  };
}

export function buildVirtualRows({
  layout,
  rowsById,
  containerTop,
  scrollY,
  viewportHeight,
}) {
  if (!layout.rowIds.length) {
    return {
      totalHeight: 0,
      items: [],
    };
  }

  const { rowIds, rowIndexById, offsets, bottoms, totalHeight } = layout;
  const viewportTop = scrollY - containerTop - TREE_OVERSCAN_PX;
  const viewportBottom = scrollY + viewportHeight - containerTop + TREE_OVERSCAN_PX;
  const startIndex = lowerBound(bottoms, viewportTop);
  const endIndex = Math.min(rowIds.length, upperBound(offsets, viewportBottom));

  const renderedIndexes = new Set();
  for (let index = startIndex; index < endIndex; index += 1) {
    renderedIndexes.add(index);
  }

  // Always render rows that would be visible if the section were at the top of the
  // viewport. This keeps content in the DOM for sections below the initial scroll
  // position, avoiding empty sections when the page first loads or a filter changes.
  const sectionBaselineEnd = Math.min(rowIds.length, upperBound(offsets, viewportHeight));
  for (let i = 0; i < sectionBaselineEnd; i += 1) {
    renderedIndexes.add(i);
  }

  if (startIndex < rowIds.length) {
    let ancestorRowId = rowsById.get(rowIds[startIndex])?.parentId ?? null;
    while (ancestorRowId) {
      const ancestorIndex = rowIndexById.get(ancestorRowId);
      if (ancestorIndex == null) {
        break;
      }

      renderedIndexes.add(ancestorIndex);
      ancestorRowId = rowsById.get(ancestorRowId)?.parentId ?? null;
    }
  }

  const sortedIndexes = Array.from(renderedIndexes).sort((left, right) => left - right);
  if (!sortedIndexes.length) {
    sortedIndexes.push(Math.max(0, Math.min(rowIds.length - 1, startIndex)));
  }
  const items = [];

  for (const index of sortedIndexes) {
    items.push({
      rowId: rowIds[index],
      top: offsets[index],
      trimTopGuide: index === sortedIndexes[0] && sortedIndexes[0] > 0,
      trimBottomGuide:
        index === sortedIndexes[sortedIndexes.length - 1] &&
        sortedIndexes[sortedIndexes.length - 1] < rowIds.length - 1,
    });
  }

  return {
    totalHeight,
    items,
  };
}

export function getViewportAnchorOffsetDelta({ currentLayout, nextLayout, viewportTop }) {
  if (!currentLayout.rowIds.length || !nextLayout.rowIds.length) {
    return 0;
  }

  const anchorIndex = Math.min(
    currentLayout.rowIds.length - 1,
    lowerBound(currentLayout.bottoms, viewportTop),
  );
  const anchorRowId = currentLayout.rowIds[anchorIndex];
  const nextAnchorIndex = nextLayout.rowIndexById.get(anchorRowId);

  if (nextAnchorIndex == null) {
    return 0;
  }

  return nextLayout.offsets[nextAnchorIndex] - currentLayout.offsets[anchorIndex];
}

// The measured row heights after `pendingEntries` ([key, height]) arrive: the same map when none
// of them changes a height.
export function mergeMeasuredHeights(measuredHeights, pendingEntries) {
  let next = measuredHeights;
  for (const [key, height] of pendingEntries) {
    if (next.get(key) === height) {
      continue;
    }

    if (next === measuredHeights) {
      next = new Map(measuredHeights);
    }
    next.set(key, height);
  }

  return next;
}

// How far the page must scroll so that the row at the top of the viewport stays put when rows are
// re-measured: measured heights replace estimates above it, which moves it.
export function getMeasurementScrollDelta({
  rowIds,
  rowsById,
  collapsedIds,
  detailOverrides,
  defaultDetailed,
  currentMeasuredHeights,
  nextMeasuredHeights,
  viewportTop,
}) {
  if (!rowIds.length) {
    return 0;
  }

  const layoutFor = (measuredHeights) =>
    buildVirtualRowLayout({ rowIds, rowsById, collapsedIds, detailOverrides, defaultDetailed, measuredHeights });
  return getViewportAnchorOffsetDelta({
    currentLayout: layoutFor(currentMeasuredHeights),
    nextLayout: layoutFor(nextMeasuredHeights),
    viewportTop,
  });
}

// Whether to scroll by a re-measurement's delta: not on touch devices, not for a couple of pixels,
// and not while a jump to a row is settling.
export function shouldApplyScrollAnchor(delta, { touchDevice, suppressed }) {
  return !touchDevice && Math.abs(delta) > 2 && !suppressed;
}

// While the page scrolls, a row that was measured before waits for the scroll to stop before its
// new height applies, so rows do not jump under the pointer.
export function shouldDeferRowMeasurement({ scrolling, hadMeasuredHeight }) {
  return scrolling && hadMeasuredHeight;
}

// Where to scroll to bring a row that is not rendered yet to the middle of the viewport, from its
// offset in the layout.
export function getRowJumpScrollTop({ containerTop, offset, viewportHeight }) {
  return containerTop + offset - viewportHeight / 2;
}

export function estimateRowHeight(row, { collapsed, detailsVisible }) {
  if (!row) {
    return 180;
  }

  if (row.type === 'archive') {
    let estimate = 180;
    if (detailsVisible) {
      estimate += 120;
    }

    if (row.archive.issues.length) {
      estimate += Math.min(row.archive.issues.length, 4) * 42;
    }

    if (!collapsed && !row.childIds.length) {
      estimate += 48;
    }

    return estimate;
  }

  if (row.node.kind === 'file' && collapsed) {
    return 120;
  }

  let estimate = row.node.kind === 'folder' ? 145 : 155;
  if (detailsVisible) {
    estimate += 110;
  }

  return estimate;
}

export function lowerBound(values, target) {
  let low = 0;
  let high = values.length;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (values[middle] < target) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
}

export function upperBound(values, target) {
  let low = 0;
  let high = values.length;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (values[middle] <= target) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
}
