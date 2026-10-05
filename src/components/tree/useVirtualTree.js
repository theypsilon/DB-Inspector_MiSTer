import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import useWindowViewport from '../../hooks/useWindowViewport.js';
import {
  buildVirtualRowLayout,
  buildVirtualRows,
  getMeasurementScrollDelta,
  getRemainingScrollAnchorDelta,
  getRowJumpScrollTop,
  mergeMeasuredHeights,
  shouldApplyScrollAnchor,
  shouldDeferRowMeasurement,
} from '../../lib/treeLayout.js';
import { isTouchDevice } from '../../lib/utils.js';

// Tree virtualization comes in two hooks that the section calls around useTreeNavigation:
// useMeasuredRowLayout (the row offsets, with measured heights replacing estimates; no effects)
// and useVirtualRowWindow (viewport tracking, the rendered row window, and row measurement).
// Splitting them keeps the navigation effects running before the viewport and measurement
// effects, which is the order the virtualization was tuned against.

// `narrow`: a narrow screen, where files leave their tags off their line (see rowTagsHidden).
export function useMeasuredRowLayout({ index, visibleRowIds, collapsedIds, detailOverrides, detailed, expandedTagIds, narrow = false }) {
  const containerRef = useRef(null);
  const pendingMeasuredHeightsRef = useRef(new Map());
  const measuredHeightsRef = useRef(new Map());
  const heightFlushFrameRef = useRef(0);
  const scrollIdleTimeoutRef = useRef(0);
  const scrollingRef = useRef(false);
  const [measuredHeights, setMeasuredHeights] = useState(() => new Map());
  const [containerTop, setContainerTop] = useState(0);
  const virtualLayout = useMemo(
    () =>
      buildVirtualRowLayout({
        rowIds: visibleRowIds,
        rowsById: index.rowsById,
        collapsedIds,
        detailOverrides,
        defaultDetailed: detailed,
        measuredHeights,
        expandedTagIds,
        narrow,
      }),
    [visibleRowIds, index.rowsById, collapsedIds, detailOverrides, detailed, measuredHeights, expandedTagIds, narrow],
  );
  const virtualLayoutRef = useRef(virtualLayout);
  virtualLayoutRef.current = virtualLayout;

  return {
    containerRef,
    pendingMeasuredHeightsRef,
    measuredHeightsRef,
    heightFlushFrameRef,
    scrollIdleTimeoutRef,
    scrollingRef,
    setMeasuredHeights,
    containerTop,
    setContainerTop,
    virtualLayout,
    virtualLayoutRef,
  };
}

export function useVirtualRowWindow({
  layout,
  index,
  visibleRowIds,
  collapsedIds,
  detailOverrides,
  detailed,
  expandedTagIds,
  narrow = false,
  suppressAnchoringRef,
}) {
  const {
    containerRef,
    pendingMeasuredHeightsRef,
    measuredHeightsRef,
    heightFlushFrameRef,
    scrollIdleTimeoutRef,
    scrollingRef,
    setMeasuredHeights,
    containerTop,
    setContainerTop,
    virtualLayout,
  } = layout;
  const viewport = useWindowViewport();
  const virtualRows = useMemo(
    () =>
      buildVirtualRows({
        layout: virtualLayout,
        rowsById: index.rowsById,
        containerTop,
        scrollY: viewport.scrollY,
        viewportHeight: viewport.height,
      }),
    [virtualLayout, index.rowsById, containerTop, viewport.scrollY, viewport.height],
  );

  const resetMeasuredHeights = useCallback(() => {
    pendingMeasuredHeightsRef.current.clear();
    measuredHeightsRef.current = new Map();
    if (heightFlushFrameRef.current && typeof window !== 'undefined') {
      window.cancelAnimationFrame(heightFlushFrameRef.current);
      heightFlushFrameRef.current = 0;
    }
    setMeasuredHeights(new Map());
  }, [heightFlushFrameRef, measuredHeightsRef, pendingMeasuredHeightsRef, setMeasuredHeights]);

  const flushMeasuredHeights = useCallback(() => {
    heightFlushFrameRef.current = 0;
    const pendingEntries = Array.from(pendingMeasuredHeightsRef.current.entries());
    pendingMeasuredHeightsRef.current.clear();
    if (!pendingEntries.length) {
      return;
    }

    const currentMeasuredHeights = measuredHeightsRef.current;
    const nextMeasuredHeights = mergeMeasuredHeights(currentMeasuredHeights, pendingEntries);
    if (nextMeasuredHeights === currentMeasuredHeights) {
      return;
    }

    let scrollAnchorDelta = 0;
    if (typeof window !== 'undefined') {
      scrollAnchorDelta = getMeasurementScrollDelta({
        rowIds: visibleRowIds,
        rowsById: index.rowsById,
        collapsedIds,
        detailOverrides,
        defaultDetailed: detailed,
        expandedTagIds,
        narrow,
        currentMeasuredHeights,
        nextMeasuredHeights,
        viewportTop: Math.max(0, viewport.scrollY - containerTop),
      });
    }

    measuredHeightsRef.current = nextMeasuredHeights;
    const scrollYBefore = typeof window !== 'undefined' ? window.scrollY : 0;
    flushSync(() => {
      setMeasuredHeights(nextMeasuredHeights);
    });

    if (typeof window !== 'undefined') {
      const remainingDelta = getRemainingScrollAnchorDelta({ delta: scrollAnchorDelta, scrollYBefore, scrollYAfter: window.scrollY });
      if (shouldApplyScrollAnchor(remainingDelta, { touchDevice: isTouchDevice, suppressed: suppressAnchoringRef.current })) {
        window.scrollBy(0, remainingDelta);
      }
    }
  }, [
    collapsedIds,
    containerTop,
    detailOverrides,
    detailed,
    expandedTagIds,
    heightFlushFrameRef,
    index.rowsById,
    measuredHeightsRef,
    narrow,
    pendingMeasuredHeightsRef,
    setMeasuredHeights,
    suppressAnchoringRef,
    viewport.scrollY,
    visibleRowIds,
  ]);

  const handleRowHeightChange = useCallback((rowId, height, { immediate = false } = {}) => {
    const hadMeasuredHeight = measuredHeightsRef.current.has(rowId);
    pendingMeasuredHeightsRef.current.set(rowId, height);

    if (typeof window === 'undefined') {
      flushMeasuredHeights();
      return;
    }

    if (immediate) {
      if (heightFlushFrameRef.current) {
        window.cancelAnimationFrame(heightFlushFrameRef.current);
        heightFlushFrameRef.current = 0;
      }
      queueMicrotask(flushMeasuredHeights);
      return;
    }

    if (shouldDeferRowMeasurement({ scrolling: scrollingRef.current, hadMeasuredHeight })) {
      return;
    }

    if (!heightFlushFrameRef.current) {
      heightFlushFrameRef.current = window.requestAnimationFrame(() => {
        flushMeasuredHeights();
      });
    }
  }, [flushMeasuredHeights, heightFlushFrameRef, measuredHeightsRef, pendingMeasuredHeightsRef, scrollingRef]);

  useEffect(() => {
    resetMeasuredHeights();
  }, [index, resetMeasuredHeights]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    scrollingRef.current = true;
    if (scrollIdleTimeoutRef.current) {
      window.clearTimeout(scrollIdleTimeoutRef.current);
    }

    scrollIdleTimeoutRef.current = window.setTimeout(() => {
      scrollIdleTimeoutRef.current = 0;
      scrollingRef.current = false;
      flushMeasuredHeights();
    }, 120);

    return undefined;
  }, [viewport.scrollY, flushMeasuredHeights, scrollIdleTimeoutRef, scrollingRef]);

  useEffect(
    () => () => {
      if (heightFlushFrameRef.current && typeof window !== 'undefined') {
        window.cancelAnimationFrame(heightFlushFrameRef.current);
      }
      if (scrollIdleTimeoutRef.current && typeof window !== 'undefined') {
        window.clearTimeout(scrollIdleTimeoutRef.current);
      }
    },
    [heightFlushFrameRef, scrollIdleTimeoutRef],
  );

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element || typeof window === 'undefined') {
      setContainerTop(0);
      return;
    }

    const nextTop = Math.round(element.getBoundingClientRect().top + window.scrollY);
    setContainerTop((current) => (current === nextTop ? current : nextTop));
  }, [containerRef, index, setContainerTop, viewport.layoutVersion]);

  return { viewport, virtualRows, handleRowHeightChange };
}

// Scrolls to a row that is outside the rendered window: jumps to its estimated offset, then
// corrects the position once the row has rendered and been measured.
export function scrollToMeasuredRow(layout, visibleRowIds, { rowId, applyRowHighlight, suppressAnchoringRef }) {
  const { containerRef, containerTop, virtualLayout, virtualLayoutRef } = layout;
  const readContainerTop = () =>
    containerRef.current
      ? Math.round(containerRef.current.getBoundingClientRect().top + window.scrollY)
      : containerTop;
  const rowIndex = visibleRowIds.indexOf(rowId);
  if (rowIndex < 0) {
    return;
  }

  const offset = virtualLayout.offsets[rowIndex];
  if (offset == null) {
    return;
  }

  const viewportHeight = window.innerHeight;
  const jumpTop = (rowOffset) => getRowJumpScrollTop({ containerTop: readContainerTop(), offset: rowOffset, viewportHeight });
  suppressAnchoringRef.current = true;
  window.scrollTo(0, jumpTop(offset));

  const correctScroll = (attemptsLeft) => {
    const el = document.getElementById(`row-${rowId}`);
    if (el) {
      el.scrollIntoView({ block: 'start' });
      applyRowHighlight(el);
      window.setTimeout(() => {
        const target = document.getElementById(`row-${rowId}`);
        if (target) {
          target.scrollIntoView({ block: 'start' });
        }
        suppressAnchoringRef.current = false;
      }, 300);
      return;
    }

    if (attemptsLeft > 0) {
      const freshOffset = virtualLayoutRef.current.offsets[rowIndex];
      if (freshOffset != null) {
        window.scrollTo(0, jumpTop(freshOffset));
      }
      window.setTimeout(() => correctScroll(attemptsLeft - 1), 200);
      return;
    }

    suppressAnchoringRef.current = false;
  };

  window.setTimeout(() => correctScroll(3), 200);
}
