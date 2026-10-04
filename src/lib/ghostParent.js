// Ghost parent rows: hovering an indentation column whose parent row has scrolled out of view shows
// that parent as a "ghost" row to jump back to.

const INDENT_STEP_REM = 1.55;
const COLUMN_SLOP_REM = 2.25;
// How far above the viewport a parent row must be before its ghost shows.
const GHOST_PARENT_HIDDEN_TOP_PX = -120;

// The depth of the indentation column at `mouseX` (pixels from the tree's left edge), or -1 when
// the pointer is outside the columns.
export function findHoveredColumnDepth(mouseX, rootFontSize) {
  const indentStepPx = INDENT_STEP_REM * rootFontSize;
  const depth = Math.floor(mouseX / indentStepPx);
  return mouseX < 0 || mouseX > (depth + 1) * indentStepPx + COLUMN_SLOP_REM * rootFontSize ? -1 : depth;
}

// The ancestor of `row` (or the row itself) at `depth`, or null when there is none.
export function findAncestorAtDepth(row, depth, rowsById) {
  let ancestor = row;
  while (ancestor && ancestor.depth > depth) {
    ancestor = rowsById.get(ancestor.parentId);
  }

  return ancestor && ancestor.depth === depth ? ancestor : null;
}

// Whether a row whose top is at `top` (viewport pixels) is far enough above the viewport for a ghost.
export function isGhostParentHidden(top) {
  return top < GHOST_PARENT_HIDDEN_TOP_PX;
}

// The index in `visibleRowIds` of the last row inside the ancestor at `ancestorIndex`, where the
// highlighted column line ends.
export function findLastDescendantIndex(visibleRowIds, ancestorIndex, rowsById) {
  const ancestorDepth = rowsById.get(visibleRowIds[ancestorIndex])?.depth;
  let lastDescendantIndex = ancestorIndex;
  for (let index = ancestorIndex + 1; index < visibleRowIds.length; index += 1) {
    const row = rowsById.get(visibleRowIds[index]);
    if (!row || row.depth <= ancestorDepth) {
      break;
    }
    lastDescendantIndex = index;
  }

  return lastDescendantIndex;
}

// The rendered row nearest to the pointer's `clientY`: the first one under it, else the closest.
// `measureRow(rowId)` gives a row's { top, bottom } in viewport pixels, or null when it is not in
// the page; rows above the viewport are skipped.
export function findRowNearestTo(rowIds, clientY, measureRow) {
  let nearestRowId = null;
  let bestDistance = Infinity;
  for (const rowId of rowIds) {
    const rect = measureRow(rowId);
    if (!rect || rect.bottom < 0) {
      continue;
    }

    const distance = clientY < rect.top ? rect.top - clientY : clientY > rect.bottom ? clientY - rect.bottom : 0;
    if (distance < bestDistance) {
      bestDistance = distance;
      nearestRowId = rowId;
      if (distance === 0) {
        break;
      }
    }
  }

  return nearestRowId;
}

// What hovering the indentation column at `hoveredDepth` next to `targetRow` shows, as the changes to
// { ghostParentId, hoveredColumnDepth, columnLineBottom } (only those that change). The column's
// row at that depth becomes a ghost when its top (`ancestorTopOf(row)`) is far enough above the
// viewport; its column line then ends at the bottom of its last visible descendant (`bottoms` are
// the layout's row bottoms, by index in `visibleRowIds`). The innermost column keeps no highlight.
export function resolveGhostParent({ hoveredDepth, targetRow, rowsById, visibleRowIds, bottoms, ancestorTopOf }) {
  const noGhost = { ghostParentId: null, hoveredColumnDepth: -1, columnLineBottom: null };
  if (hoveredDepth < 0 || !targetRow || targetRow.depth < hoveredDepth) {
    return noGhost;
  }

  const ancestor = findAncestorAtDepth(targetRow, hoveredDepth, rowsById);
  if (!ancestor) {
    return { ghostParentId: null };
  }

  if (!isGhostParentHidden(ancestorTopOf(ancestor))) {
    return noGhost;
  }

  const update = {
    ghostParentId: ancestor.id,
    hoveredColumnDepth: targetRow.depth <= hoveredDepth + 1 ? -1 : hoveredDepth,
  };
  const ancestorIndex = visibleRowIds.indexOf(ancestor.id);
  if (ancestorIndex >= 0) {
    update.columnLineBottom = bottoms[findLastDescendantIndex(visibleRowIds, ancestorIndex, rowsById)];
  }

  return update;
}
