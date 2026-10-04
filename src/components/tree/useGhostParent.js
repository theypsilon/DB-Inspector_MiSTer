import { useCallback, useEffect, useRef, useState } from 'react';
import { findHoveredColumnDepth, findRowNearestTo, resolveGhostParent } from '../../lib/ghostParent.js';

// Hovering an indentation column whose parent row has scrolled out of view shows that parent as
// a "ghost" row (click to jump back to it) and highlights the column's guide line.
export default function useGhostParent({ containerRef, index, virtualRows, virtualLayout, visibleRowIds, scrollY }) {
  const [ghostParentId, setGhostParentId] = useState(null);
  const [hoveredColumnDepth, setHoveredColumnDepth] = useState(-1);
  const [columnLineBottom, setColumnLineBottom] = useState(null);
  const lastCursorRef = useRef(null);

  const resolveGhostFromCursor = useCallback((clientX, clientY) => {
    if (!containerRef.current) {
      setGhostParentId(null);
      return;
    }

    const containerRect = containerRef.current.getBoundingClientRect();
    const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const hoveredDepth = findHoveredColumnDepth(clientX - containerRect.left, rootFontSize);
    const measureRow = (rowId) => document.getElementById(`row-${rowId}`)?.getBoundingClientRect() ?? null;
    const targetRowId =
      hoveredDepth < 0 ? null : findRowNearestTo(virtualRows.items.map((item) => item.rowId), clientY, measureRow);
    const update = resolveGhostParent({
      hoveredDepth,
      targetRow: targetRowId === null ? null : index.rowsById.get(targetRowId),
      rowsById: index.rowsById,
      visibleRowIds,
      bottoms: virtualLayout.bottoms,
      ancestorTopOf: (ancestor) => measureRow(ancestor.id)?.top ?? -100,
    });
    if ('ghostParentId' in update) {
      setGhostParentId(update.ghostParentId);
    }
    if ('hoveredColumnDepth' in update) {
      setHoveredColumnDepth(update.hoveredColumnDepth);
    }
    if ('columnLineBottom' in update) {
      setColumnLineBottom(update.columnLineBottom);
    }
  }, [containerRef, index.rowsById, virtualLayout, virtualRows, visibleRowIds]);

  const handleTreeMouseMove = useCallback((event) => {
    lastCursorRef.current = { x: event.clientX, y: event.clientY };
    resolveGhostFromCursor(event.clientX, event.clientY);
  }, [resolveGhostFromCursor]);

  const handleTreeMouseLeave = useCallback(() => {
    if (!ghostParentId) {
      lastCursorRef.current = null;
      setHoveredColumnDepth(-1);
    }
  }, [ghostParentId]);

  const clearGhost = useCallback(() => {
    setGhostParentId(null);
    setHoveredColumnDepth(-1);
    setColumnLineBottom(null);
    lastCursorRef.current = null;
  }, []);

  useEffect(() => {
    if (!ghostParentId || typeof document === 'undefined') {
      return undefined;
    }

    const onDocMouseMove = (event) => {
      lastCursorRef.current = { x: event.clientX, y: event.clientY };
      resolveGhostFromCursor(event.clientX, event.clientY);
    };

    document.addEventListener('mousemove', onDocMouseMove, { passive: true });
    return () => {
      document.removeEventListener('mousemove', onDocMouseMove);
    };
  }, [ghostParentId, resolveGhostFromCursor]);

  useEffect(() => {
    const cursor = lastCursorRef.current;
    if (cursor) {
      resolveGhostFromCursor(cursor.x, cursor.y);
    }
  }, [scrollY, resolveGhostFromCursor]);

  return {
    ghostParentId,
    hoveredColumnDepth,
    columnLineBottom,
    handleTreeMouseMove,
    handleTreeMouseLeave,
    clearGhost,
  };
}
