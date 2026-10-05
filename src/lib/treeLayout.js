// Tree row styling and the virtualization layout math (row offsets, visible window, scroll
// anchoring). Changes here must be re-verified in a real browser, including against a real database.

export const TREE_OVERSCAN_PX = 900;

// Row styles set CSS custom properties, which React's style type does not list.
/** @returns {import('react').CSSProperties} */
export function buildTreeDepthStyle(depth) {
  return /** @type {import('react').CSSProperties} */ ({ '--tree-depth': depth });
}

/** @returns {import('react').CSSProperties} */
export function buildTreeGuideStyle(depth) {
  return /** @type {import('react').CSSProperties} */ ({ '--tree-guide-depth': depth });
}

const CORNER_RADII = { outer: 'var(--tree-corner-outer)', step: 'var(--tree-corner-step)', none: '0px' };

// A row at `top`, drawn over `height` (its place in the list) with the lines and corners `rowOutline`
// gives it. Without a height (a row outside the virtual list), it is drawn as a card on its own.
/** @returns {import('react').CSSProperties} */
export function buildVirtualRowStyle(
  top,
  { trimTopGuide = false, trimBottomGuide = false, height = null, topLine = true, bottomLine = true, corners = null } = {},
) {
  return /** @type {import('react').CSSProperties} */ ({
    position: 'absolute',
    top: `${top}px`,
    left: 0,
    right: 0,
    '--tree-guide-top-overlap': trimTopGuide ? '0px' : 'var(--tree-guide-overlap)',
    '--tree-guide-bottom-overlap': trimBottomGuide ? '0px' : 'var(--tree-guide-overlap)',
    ...(height == null ? {} : { '--tree-row-height': `${height}px` }),
    '--tree-row-top-line': topLine ? '1px' : '0px',
    '--tree-row-bottom-line': bottomLine ? '1px' : '0px',
    ...(corners == null ? {} : { '--tree-row-corners': corners.split(' ').map((corner) => CORNER_RADII[corner]).join(' ') }),
  });
}

// How a row draws its part of the outline around the list. The rows touch, and each line between
// two rows is drawn by one of them only, so it is as thick as the rows' sides at any zoom: the
// wider row draws it (a row is wider the less it is indented), or the lower one when both are as
// wide. A row owns the corners it draws, and the outline's outer corners are rounded: the list's
// four (`outer`), and those where it steps in under a row or back out after one (`step`). Corners
// run top left, top right, bottom right, bottom left.
export function rowOutline(rowIds, rowsById, index) {
  const depthAt = (at) => rowsById.get(rowIds[at])?.depth ?? 0;
  const depth = depthAt(index);
  const first = index === 0;
  const last = index === rowIds.length - 1;
  const stepsIn = !first && depth > depthAt(index - 1);
  const stepsOut = !first && depth < depthAt(index - 1);
  const nextStepsIn = !last && depthAt(index + 1) > depth;
  return {
    topLine: !stepsIn,
    bottomLine: last || nextStepsIn,
    corners: [
      first ? 'outer' : stepsOut ? 'step' : 'none',
      first ? 'outer' : 'none',
      last ? 'outer' : 'none',
      last ? 'outer' : nextStepsIn ? 'step' : 'none',
    ].join(' '),
  };
}

// A row's measured height depends on what it shows: open or collapsed, its details, and all its
// tags or only the first few (`tagsExpanded`).
// The screens a tree lays its rows out for: 'wide', 'narrow' (NARROW_SCREEN_QUERY in utils.js:
// headings stacked, files' tags left to their details) and 'phone' (PHONE_SCREEN_QUERY: headings
// just the row's name until its details show). A row is measured apart on each.
/** @typedef {'wide' | 'narrow' | 'phone'} TreeScreen */

/**
 * @param {string} rowId
 * @param {{ collapsed: boolean, detailsVisible: boolean, tagsExpanded?: boolean, screen?: string }} state `screen`: a TreeScreen
 */
export function getRowMeasurementKey(rowId, { collapsed, detailsVisible, tagsExpanded = false, screen = 'wide' }) {
  return `${rowId}:${collapsed ? '1' : '0'}:${detailsVisible ? '1' : '0'}:${tagsExpanded ? '1' : '0'}:${screen}`;
}

// The row a measurement key was made for: the key without the four parts getRowMeasurementKey adds
// after the row's ID (which may hold colons itself).
function getMeasurementKeyRowId(key) {
  let end = key.length;
  for (let part = 0; part < 4; part += 1) {
    end = key.lastIndexOf(':', end - 1);
  }
  return key.slice(0, end);
}

// Whether a row leaves its tags off its line: a file on a narrow screen (NARROW_SCREEN_QUERY in
// utils.js), unless its details show, or all its tags were asked for or hold the find-in-page match.
// Folders and archives keep theirs.
export function rowTagsHidden(row, { narrow, detailsVisible, tagsExpanded }) {
  return Boolean(narrow && row && row.type !== 'archive' && row.node?.kind === 'file' && !detailsVisible && !tagsExpanded);
}

const NO_ROW_IDS = new Set();

// What each layout was built from (buildVirtualRowLayout's arguments) and its rows' heights, for
// updateVirtualRowLayout.
const layoutSources = new WeakMap();
// For measured heights from mergeMeasuredHeights: the heights they were merged into, and the keys
// whose height changed.
const measuredHeightChanges = new WeakMap();

function withSource(layout, source, heights) {
  layoutSources.set(layout, { source: { ...source }, heights });
  return layout;
}

export function buildVirtualRowLayout(source) {
  const {
    rowIds,
    rowsById,
    collapsedIds,
    detailOverrides,
    defaultDetailed,
    measuredHeights,
    expandedTagIds = NO_ROW_IDS,
    screen = 'wide',
  } = source;
  if (!rowIds.length) {
    return withSource(
      {
        rowIds: [],
        rowIndexById: new Map(),
        offsets: [],
        bottoms: [],
        totalHeight: 0,
      },
      source,
      [],
    );
  }

  const heights = new Array(rowIds.length);
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
    const tagsExpanded = expandedTagIds.has(rowId);
    const measuredHeight = measuredHeights.get(getRowMeasurementKey(rowId, { collapsed, detailsVisible, tagsExpanded, screen }));
    const rowHeight =
      measuredHeight ?? estimateRowHeight(row, { collapsed, detailsVisible, screen });

    // Rows touch: each one starts where the one above ends.
    heights[index] = rowHeight;
    offsets[index] = totalHeight;
    bottoms[index] = totalHeight + rowHeight;
    totalHeight += rowHeight;
  }

  return withSource(
    {
      rowIds,
      rowIndexById,
      offsets,
      bottoms,
      totalHeight,
    },
    source,
    heights,
  );
}

// The layout buildVirtualRowLayout would build from `source`, updated from `previous` when nothing
// but measured heights changed since it was built, and those heights were merged into its own
// (mergeMeasuredHeights): only the rows whose height changed are read, and only the offsets from
// the first of them on are added up again, as the build adds them. Otherwise it is built again.
// Building the whole layout for each batch of rows measured while scrolling took most of each frame
// on a large tree (226 combined databases, about 100,000 rows).
export function updateVirtualRowLayout(previous, source) {
  const built = previous ? layoutSources.get(previous) : null;
  if (!built || !sameLayoutSourceApartFromHeights(built.source, source)) {
    return buildVirtualRowLayout(source);
  }

  const { measuredHeights } = source;
  if (built.source.measuredHeights === measuredHeights) {
    return previous;
  }

  const change = measuredHeightChanges.get(measuredHeights);
  if (!change || change.from !== built.source.measuredHeights) {
    return buildVirtualRowLayout(source);
  }

  const { collapsedIds, detailOverrides, defaultDetailed, expandedTagIds = NO_ROW_IDS, screen = 'wide' } = source;
  const { rowIds, rowIndexById } = previous;
  let heights = built.heights;
  let first = rowIds.length;
  for (const key of change.keys) {
    // A key counts only for a row in the list, in the state it was measured in, as in the build.
    const rowId = getMeasurementKeyRowId(key);
    const index = rowIndexById.get(rowId);
    if (index == null) {
      continue;
    }

    const rowKey = getRowMeasurementKey(rowId, {
      collapsed: collapsedIds.has(rowId),
      detailsVisible: detailOverrides.get(rowId) ?? defaultDetailed,
      tagsExpanded: expandedTagIds.has(rowId),
      screen,
    });
    if (rowKey !== key) {
      continue;
    }

    if (heights === built.heights) {
      heights = heights.slice();
    }
    heights[index] = measuredHeights.get(key);
    first = Math.min(first, index);
  }

  if (first === rowIds.length) {
    return withSource({ ...previous }, source, heights);
  }

  const offsets = previous.offsets.slice();
  const bottoms = previous.bottoms.slice();
  let totalHeight = offsets[first];
  for (let index = first; index < rowIds.length; index += 1) {
    const rowHeight = heights[index];
    offsets[index] = totalHeight;
    bottoms[index] = totalHeight + rowHeight;
    totalHeight += rowHeight;
  }

  return withSource({ rowIds, rowIndexById, offsets, bottoms, totalHeight }, source, heights);
}

// Whether two layouts' arguments are the same but for their measured heights.
function sameLayoutSourceApartFromHeights(left, right) {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  keys.delete('measuredHeights');
  for (const key of keys) {
    if (left[key] !== right[key]) {
      return false;
    }
  }
  return true;
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
      height: bottoms[index] - offsets[index],
      ...rowOutline(rowIds, rowsById, index),
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
  const changedKeys = [];
  for (const [key, height] of pendingEntries) {
    if (next.get(key) === height) {
      continue;
    }

    if (next === measuredHeights) {
      next = new Map(measuredHeights);
    }
    next.set(key, height);
    changedKeys.push(key);
  }

  if (next !== measuredHeights) {
    // For updateVirtualRowLayout. Only the last merge is kept, so that each map of heights does not
    // keep every map before it.
    measuredHeightChanges.delete(measuredHeights);
    measuredHeightChanges.set(next, { from: measuredHeights, keys: changedKeys });
  }
  return next;
}

// How far the page must scroll so that the row at the top of the viewport stays put when rows are
// re-measured: measured heights replace estimates above it, which moves it. `currentLayout`, the
// layout the page shows, if any, is used rather than built again when it was built from the same
// arguments (see updateVirtualRowLayout).
export function getMeasurementScrollDelta({
  rowIds,
  rowsById,
  collapsedIds,
  detailOverrides,
  defaultDetailed,
  expandedTagIds = NO_ROW_IDS,
  screen = 'wide',
  currentMeasuredHeights,
  nextMeasuredHeights,
  viewportTop,
  currentLayout = null,
}) {
  if (!rowIds.length) {
    return 0;
  }

  const layoutFor = (previous, measuredHeights) =>
    updateVirtualRowLayout(previous, { rowIds, rowsById, collapsedIds, detailOverrides, defaultDetailed, measuredHeights, expandedTagIds, screen });
  const current = layoutFor(currentLayout, currentMeasuredHeights);
  return getViewportAnchorOffsetDelta({
    currentLayout: current,
    nextLayout: layoutFor(current, nextMeasuredHeights),
    viewportTop,
  });
}

// What is left to scroll of a re-measurement's `delta` once its heights apply: when they make the
// page shorter than its scroll position allows, as at the bottom of the page, the browser pulls the
// scroll position back by itself (from `scrollYBefore` to `scrollYAfter`), and that already moved
// the rows.
export function getRemainingScrollAnchorDelta({ delta, scrollYBefore, scrollYAfter }) {
  return delta - (scrollYAfter - scrollYBefore);
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

// A row's height before it is measured. The estimates keep the ratios to the measured heights they
// were tuned with (a file with a line of tags measures about 101px, a row without tags 61px, and a
// file with its details about 353px), which the scrolling of the virtual tree relies on.
/**
 * @param {any} row
 * @param {{ collapsed: boolean, detailsVisible: boolean, screen?: string }} state `screen`: a TreeScreen
 */
export function estimateRowHeight(row, { collapsed, detailsVisible, screen = 'wide' }) {
  if (!row) {
    return 129;
  }

  // On a phone, a file or folder without its details is its name, and a folder's line of tags
  // (measured at 49px and 89px), estimated in the proportions above: 123 to 101 for a file, 104 to
  // 101 for a folder.
  if (screen === 'phone' && row.type !== 'archive' && !detailsVisible) {
    return row.node.kind === 'folder' ? 92 : 60;
  }

  if (row.type === 'archive') {
    let estimate = 129;
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
    return 86;
  }

  let estimate = row.node.kind === 'folder' ? 104 : 123;
  if (detailsVisible) {
    estimate += 125;
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
