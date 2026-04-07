import { memo, useState, useMemo, useCallback, useRef, useEffect, useLayoutEffect, startTransition } from 'react';
import { createPortal, flushSync } from 'react-dom';
import CollapsibleSection from '../ui/CollapsibleSection.jsx';
import SectionControls from '../ui/SectionControls.jsx';
import EmptyState from '../ui/EmptyState.jsx';
import ScrollToSectionTopButton from '../ui/ScrollToSectionTopButton.jsx';
import TreeEntryRow from './TreeEntryRow.jsx';
import GhostParentRow from './GhostParentRow.jsx';
import useWindowViewport from '../../hooks/useWindowViewport.js';
import { collectVisibleRowIds, toggleSetMembership, setSetMembership, toggleDetailOverride, setDetailVisibilityOverride, buildVirtualRowLayout, buildVirtualRows, getViewportAnchorOffsetDelta, buildNodeAnchorHash, runAfterNextPaint, isTouchDevice } from '../../lib/utils.js';

const TreeSection = memo(function TreeSection({
  label,
  title,
  listClassName,
  emptyMessage,
  index,
  detailed,
  onDetailedChange,
  anchorRowId: anchorRowIdProp,
  altAnchorRowId,
  onAnchorHandled,
  searchMatch,
  searchQuery,
  anchor,
  onDownloadError,
}) {
  const [searchAnchorRowId, setSearchAnchorRowId] = useState(null);
  const searchMatchPartRef = useRef('name');
  const highlightClearTimerRef = useRef(0);
  const resolvedPropAnchor = anchorRowIdProp && index.rowsById.has(anchorRowIdProp)
    ? anchorRowIdProp
    : altAnchorRowId && index.rowsById.has(altAnchorRowId)
      ? altAnchorRowId
      : anchorRowIdProp;
  const anchorRowId = resolvedPropAnchor || searchAnchorRowId;
  const [collapsedIds, setCollapsedIds] = useState(() => new Set());
  const [detailOverrides, setDetailOverrides] = useState(() => new Map());
  const [highlightedRowId, setHighlightedRowId] = useState(null);
  const [ghostParentId, setGhostParentId] = useState(null);
  const [hoveredColumnDepth, setHoveredColumnDepth] = useState(-1);
  const [columnLineBottom, setColumnLineBottom] = useState(null);
  const lastCursorRef = useRef(null);
  const suppressAnchoringRef = useRef(false);
  const visibleRowIds = useMemo(
    () => collectVisibleRowIds(index.rootIds, index.rowsById, collapsedIds),
    [index, collapsedIds],
  );

  const applyHighlightToRow = useCallback((rowElement, row, matchPart, searchTerm) => {
    if (!CSS.highlights) return;
    CSS.highlights.delete('search-match');
    if (!row) return;

    let searchRoot;
    let term;

    if (searchTerm) {
      searchRoot = rowElement;
      term = searchTerm;
    } else if (matchPart === 'path') {
      searchRoot = rowElement.querySelector('.tree-identifier-inline code') || rowElement;
      term = row.type === 'archive' ? row.archive.id : row.node?.path || '';
    } else {
      searchRoot = rowElement.querySelector('h3') || rowElement;
      term = row.type === 'archive' ? row.archive.title : row.node?.name || '';
    }

    if (!term) return;
    const termLower = term.toLowerCase();
    const walker = document.createTreeWalker(searchRoot, NodeFilter.SHOW_TEXT);
    const ranges = [];
    let textNode = walker.nextNode();
    while (textNode) {
      const text = textNode.textContent.toLowerCase();
      let pos = 0;
      while (pos < text.length) {
        const idx = text.indexOf(termLower, pos);
        if (idx === -1) break;
        const range = new Range();
        range.setStart(textNode, idx);
        range.setEnd(textNode, idx + termLower.length);
        ranges.push(range);
        pos = idx + termLower.length;
      }
      textNode = walker.nextNode();
    }
    if (ranges.length) {
      CSS.highlights.set('search-match', new Highlight(...ranges));
    }
  }, []);

  const searchQueryRef = useRef('');
  useEffect(() => {
    if (!searchMatch) return;
    const section = document.getElementById(`section-${anchor}`);
    if (section && !section.open) section.open = true;
    searchMatchPartRef.current = searchMatch.matchPart || 'name';
    searchQueryRef.current = searchMatch.query || '';
    setSearchAnchorRowId(searchMatch.rowId);
  }, [searchMatch?.token, anchor]);

  useEffect(() => {
    if (!anchorRowId || !index.rowsById.has(anchorRowId)) {
      return;
    }

    const ancestorsToExpand = [];
    let parentId = index.rowsById.get(anchorRowId)?.parentId;
    while (parentId) {
      ancestorsToExpand.push(parentId);
      parentId = index.rowsById.get(parentId)?.parentId;
    }

    if (ancestorsToExpand.length) {
      setCollapsedIds((current) => {
        const next = new Set(current);
        for (const id of ancestorsToExpand) {
          next.delete(id);
        }
        return next;
      });
    }

    const isSearchMatch = !!searchAnchorRowId;
    if (searchAnchorRowId) {
      setSearchAnchorRowId(null);
    }
    onAnchorHandled?.();

    if (isSearchMatch) {
      setHighlightedRowId(anchorRowId);
    }

    const applyRowHighlight = (rowElement) => {
      if (!isSearchMatch) return;
      const row = index.rowsById.get(anchorRowId);
      const matchPart = searchMatchPartRef.current;
      applyHighlightToRow(rowElement, row, matchPart, searchQueryRef.current);
    };

    const scrollToAnchor = () => {
      const element = document.getElementById(`row-${anchorRowId}`);
      if (element) {
        const rect = element.getBoundingClientRect();
        const inViewport = rect.top >= 0 && rect.bottom <= window.innerHeight;
        if (inViewport) {
          applyRowHighlight(element);
          return;
        }
        suppressAnchoringRef.current = true;
        element.scrollIntoView({ block: 'start' });
        applyRowHighlight(element);
        window.setTimeout(() => {
          element.scrollIntoView({ block: 'start' });
          suppressAnchoringRef.current = false;
        }, 500);
        return;
      }

      if (__VIRTUALIZE__) {
        const readContainerTop = () =>
          containerRef?.current
            ? Math.round(containerRef.current.getBoundingClientRect().top + window.scrollY)
            : containerTop;
        const rowIndex = visibleRowIds.indexOf(anchorRowId);
        if (rowIndex >= 0 && virtualLayout) {
          const offset = virtualLayout.offsets[rowIndex];
          if (offset != null) {
            const viewportHalf = (typeof window !== 'undefined' ? window.innerHeight : 0) / 2;
            suppressAnchoringRef.current = true;
            window.scrollTo(0, readContainerTop() + offset - viewportHalf);

            const correctScroll = (attemptsLeft) => {
              const el = document.getElementById(`row-${anchorRowId}`);
              if (el) {
                el.scrollIntoView({ block: 'start' });
                applyRowHighlight(el);
                window.setTimeout(() => {
                  const target = document.getElementById(`row-${anchorRowId}`);
                  if (target) {
                    target.scrollIntoView({ block: 'start' });
                  }
                  suppressAnchoringRef.current = false;
                }, 300);
                return;
              }

              if (attemptsLeft > 0) {
                const freshLayout = virtualLayoutRef?.current ?? virtualLayout;
                const freshOffset = freshLayout.offsets[rowIndex];
                if (freshOffset != null) {
                  window.scrollTo(0, readContainerTop() + freshOffset - viewportHalf);
                }
                window.setTimeout(() => correctScroll(attemptsLeft - 1), 200);
                return;
              }

              suppressAnchoringRef.current = false;
            };

            window.setTimeout(() => correctScroll(3), 200);
          }
        }
      }
    };

    runAfterNextPaint(scrollToAnchor);

    if (!isSearchMatch) {
      return;
    }

    const clearHighlight = () => {
      setHighlightedRowId(null);
      CSS.highlights?.delete('search-match');
    };

    window.clearTimeout(highlightClearTimerRef.current);
    highlightClearTimerRef.current = window.setTimeout(clearHighlight, 3000);

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        clearHighlight();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(highlightClearTimerRef.current);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [anchorRowId, index]);

  // --- virtualization-only state and machinery ---
  if (__VIRTUALIZE__) {
    /* eslint-disable react-hooks/rules-of-hooks -- __VIRTUALIZE__ is a build-time constant */
    var containerRef = useRef(null);
    var pendingMeasuredHeightsRef = useRef(new Map());
    var measuredHeightsRef = useRef(new Map());
    var heightFlushFrameRef = useRef(0);
    var scrollIdleTimeoutRef = useRef(0);
    var scrollingRef = useRef(false);
    var [measuredHeights, setMeasuredHeights] = useState(() => new Map());
    var [containerTop, setContainerTop] = useState(0);
    var viewport = useWindowViewport();
    var virtualLayout = useMemo(
      () =>
        buildVirtualRowLayout({
          rowIds: visibleRowIds,
          rowsById: index.rowsById,
          collapsedIds,
          detailOverrides,
          defaultDetailed: detailed,
          measuredHeights,
        }),
      [visibleRowIds, index.rowsById, collapsedIds, detailOverrides, detailed, measuredHeights],
    );
    var virtualLayoutRef = useRef(virtualLayout);
    virtualLayoutRef.current = virtualLayout;
    var virtualRows = useMemo(
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
    var resetMeasuredHeights = useCallback(() => {
      pendingMeasuredHeightsRef.current.clear();
      measuredHeightsRef.current = new Map();
      if (heightFlushFrameRef.current && typeof window !== 'undefined') {
        window.cancelAnimationFrame(heightFlushFrameRef.current);
        heightFlushFrameRef.current = 0;
      }
      setMeasuredHeights(new Map());
    }, []);
    /* eslint-enable react-hooks/rules-of-hooks */
  }
  // --- end virtualization-only ---

  const handleExpandAll = useCallback(() => {
    startTransition(() => {
      setCollapsedIds(new Set());
    });
  }, []);

  const handleCollapseAll = useCallback(() => {
    startTransition(() => {
      setCollapsedIds(new Set(
        index.collapsibleIds.filter((id) => {
          const row = index.rowsById.get(id);
          return row && row.type === 'node' ? row.node.kind !== 'file' : row?.childIds?.length > 0;
        }),
      ));
    });
  }, [index]);

  const handleToggleCollapsed = useCallback((rowId) => {
    flushSync(() => {
      setCollapsedIds((current) => toggleSetMembership(current, rowId));
    });
  }, []);

  const handleToggleDetails = useCallback(
    (rowId) => {
      flushSync(() => {
        setDetailOverrides((current) => toggleDetailOverride(current, rowId, detailed));
      });
    },
    [detailed],
  );

  const handleSetRowState = useCallback(
    (rowId, { collapsed, detailsVisible }) => {
      flushSync(() => {
        if (typeof collapsed === 'boolean') {
          setCollapsedIds((current) => setSetMembership(current, rowId, collapsed));
        }

        if (typeof detailsVisible === 'boolean') {
          setDetailOverrides((current) =>
            setDetailVisibilityOverride(current, rowId, detailsVisible, detailed),
          );
        }
      });
    },
    [detailed],
  );

  if (__VIRTUALIZE__) {
    /* eslint-disable react-hooks/rules-of-hooks -- __VIRTUALIZE__ is a build-time constant */
    var flushMeasuredHeights = useCallback(() => {
      heightFlushFrameRef.current = 0;
      const pendingEntries = Array.from(pendingMeasuredHeightsRef.current.entries());
      pendingMeasuredHeightsRef.current.clear();
      if (!pendingEntries.length) {
        return;
      }

      let changed = false;
      const currentMeasuredHeights = measuredHeightsRef.current;
      const nextMeasuredHeights = new Map(currentMeasuredHeights);
      for (const [rowId, height] of pendingEntries) {
        if (nextMeasuredHeights.get(rowId) === height) {
          continue;
        }

        nextMeasuredHeights.set(rowId, height);
        changed = true;
      }

      if (!changed) {
        return;
      }

      let scrollAnchorDelta = 0;
      if (typeof window !== 'undefined' && visibleRowIds.length) {
        const currentLayout = buildVirtualRowLayout({
          rowIds: visibleRowIds,
          rowsById: index.rowsById,
          collapsedIds,
          detailOverrides,
          defaultDetailed: detailed,
          measuredHeights: currentMeasuredHeights,
        });
        const nextLayout = buildVirtualRowLayout({
          rowIds: visibleRowIds,
          rowsById: index.rowsById,
          collapsedIds,
          detailOverrides,
          defaultDetailed: detailed,
          measuredHeights: nextMeasuredHeights,
        });
        scrollAnchorDelta = getViewportAnchorOffsetDelta({
          currentLayout,
          nextLayout,
          viewportTop: Math.max(0, viewport.scrollY - containerTop),
        });
      }

      measuredHeightsRef.current = nextMeasuredHeights;
      flushSync(() => {
        setMeasuredHeights(nextMeasuredHeights);
      });

      if (typeof window !== 'undefined' && !isTouchDevice && Math.abs(scrollAnchorDelta) > 2 && !suppressAnchoringRef.current) {
        window.scrollBy(0, scrollAnchorDelta);
      }
    }, [
      collapsedIds,
      containerTop,
      detailOverrides,
      detailed,
      index.rowsById,
      viewport.scrollY,
      visibleRowIds,
    ]);

    var handleRowHeightChange = useCallback((rowId, height, { immediate = false } = {}) => {
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

      if (scrollingRef.current && hadMeasuredHeight) {
        return;
      }

      if (!heightFlushFrameRef.current) {
        heightFlushFrameRef.current = window.requestAnimationFrame(() => {
          flushMeasuredHeights();
        });
      }
    }, [flushMeasuredHeights]);

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
    }, [viewport.scrollY, flushMeasuredHeights]);

    useEffect(
      () => () => {
        if (heightFlushFrameRef.current && typeof window !== 'undefined') {
          window.cancelAnimationFrame(heightFlushFrameRef.current);
        }
        if (scrollIdleTimeoutRef.current && typeof window !== 'undefined') {
          window.clearTimeout(scrollIdleTimeoutRef.current);
        }
      },
      [],
    );

    useLayoutEffect(() => {
      const element = containerRef.current;
      if (!element || typeof window === 'undefined') {
        setContainerTop(0);
        return;
      }

      const nextTop = Math.round(element.getBoundingClientRect().top + window.scrollY);
      setContainerTop((current) => (current === nextTop ? current : nextTop));
    }, [index, viewport.layoutVersion]);

    var searchHighlightName = `search-match-all-${anchor}`;
    useEffect(() => {
      if (!searchQuery || !containerRef.current) {
        CSS.highlights?.delete(searchHighlightName);
        return;
      }
      const queryLower = searchQuery.toLowerCase();
      const currentRowId = searchMatch?.rowId ?? null;
      const ranges = [];
      const rowElements = containerRef.current.querySelectorAll('[id^="row-"]');
      for (const rowEl of rowElements) {
        if (currentRowId && rowEl.id === `row-${currentRowId}`) continue;
        const walker = document.createTreeWalker(rowEl, NodeFilter.SHOW_TEXT);
        let textNode = walker.nextNode();
        while (textNode) {
          const text = textNode.textContent.toLowerCase();
          let pos = 0;
          while (pos < text.length) {
            const idx = text.indexOf(queryLower, pos);
            if (idx === -1) break;
            const range = new Range();
            range.setStart(textNode, idx);
            range.setEnd(textNode, idx + queryLower.length);
            ranges.push(range);
            pos = idx + queryLower.length;
          }
          textNode = walker.nextNode();
        }
      }
      if (ranges.length && CSS.highlights) {
        CSS.highlights.set(searchHighlightName, new Highlight(...ranges));
      } else {
        CSS.highlights?.delete(searchHighlightName);
      }
    }, [searchHighlightName, searchQuery, searchMatch, virtualRows]);
    /* eslint-enable react-hooks/rules-of-hooks */
  }

  const resolveGhostFromCursor = useCallback((clientX, clientY) => {
    if (!__VIRTUALIZE__ || !containerRef?.current) {
      setGhostParentId(null);
      return;
    }

    const containerRect = containerRef.current.getBoundingClientRect();
    const mouseX = clientX - containerRect.left;
    const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const indentStepPx = 1.55 * rootFontSize;
    const hoveredDepth = Math.floor(mouseX / indentStepPx);

    if (mouseX < 0 || mouseX > (hoveredDepth + 1) * indentStepPx + 2.25 * rootFontSize) {
      setGhostParentId(null);
      setHoveredColumnDepth(-1);
      setColumnLineBottom(null);
      return;
    }

    let targetRow = null;
    let bestDistance = Infinity;
    for (const item of virtualRows.items) {
      const el = document.getElementById(`row-${item.rowId}`);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (rect.bottom < 0) continue;
      const distance = clientY < rect.top ? rect.top - clientY : clientY > rect.bottom ? clientY - rect.bottom : 0;
      if (distance < bestDistance) {
        bestDistance = distance;
        targetRow = index.rowsById.get(item.rowId);
        if (distance === 0) break;
      }
    }

    if (!targetRow || targetRow.depth < hoveredDepth) {
      setGhostParentId(null);
      setHoveredColumnDepth(-1);
      setColumnLineBottom(null);
      return;
    }

    let ancestor = targetRow;
    while (ancestor && ancestor.depth > hoveredDepth) {
      ancestor = index.rowsById.get(ancestor.parentId);
    }

    if (!ancestor || ancestor.depth !== hoveredDepth) {
      setGhostParentId(null);
      return;
    }

    const ancestorEl = document.getElementById(`row-${ancestor.id}`);
    const ancestorTop = ancestorEl?.getBoundingClientRect().top ?? -100;
    if (ancestorTop < -120) {
      setGhostParentId(ancestor.id);
      const isInnermostGhost = targetRow.depth <= hoveredDepth + 1;
      setHoveredColumnDepth(isInnermostGhost ? -1 : hoveredDepth);

      if (__VIRTUALIZE__ && virtualLayout) {
        const ancestorIndex = visibleRowIds.indexOf(ancestor.id);
        if (ancestorIndex >= 0) {
          let lastDescendantIndex = ancestorIndex;
          for (let i = ancestorIndex + 1; i < visibleRowIds.length; i++) {
            const r = index.rowsById.get(visibleRowIds[i]);
            if (!r || r.depth <= ancestor.depth) break;
            lastDescendantIndex = i;
          }
          setColumnLineBottom(virtualLayout.bottoms[lastDescendantIndex]);
        }
      }
    } else {
      setGhostParentId(null);
      setHoveredColumnDepth(-1);
      setColumnLineBottom(null);
    }
  }, [virtualRows, index.rowsById]);

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
  }, [__VIRTUALIZE__ ? viewport?.scrollY : null, resolveGhostFromCursor]);

  const scrollToRow = useCallback((rowId, { smooth = false } = {}) => {
    const el = document.getElementById(`row-${rowId}`);
    if (el) {
      el.scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'instant' });
    }
  }, []);

  const handleAnchorRow = useCallback((rowId) => {
    const hash = buildNodeAnchorHash(index.rowsById.get(rowId));
    if (hash) {
      history.replaceState(null, '', hash);
    }

    setHighlightedRowId(rowId);
    scrollToRow(rowId, { smooth: true });
    window.setTimeout(() => setHighlightedRowId(null), 3000);
  }, [index.rowsById, scrollToRow]);

  return (
    <CollapsibleSection
      label={label}
      title={title}
      defaultOpen
      anchor={anchor}
      actions={
        <SectionControls
          onExpandAll={handleExpandAll}
          onCollapseAll={handleCollapseAll}
        />
      }
    >
      {ghostParentId && typeof document !== 'undefined'
        ? createPortal(
            <GhostParentRow
              row={index.rowsById.get(ghostParentId)}
              containerLeft={__VIRTUALIZE__ && containerRef?.current ? containerRef.current.getBoundingClientRect().left : 0}
              onNavigate={() => {
                const targetId = ghostParentId;
                setGhostParentId(null);
                setHoveredColumnDepth(-1);
                setColumnLineBottom(null);
                lastCursorRef.current = null;
                scrollToRow(targetId);
              }}
            />,
            document.body,
          )
        : null}
      {visibleRowIds.length ? (
        __VIRTUALIZE__ ? (
          <div
            className={`${listClassName}${hoveredColumnDepth >= 0 ? ' tree-column-hovered' : ''}`}
            ref={containerRef}
            style={{ height: `${virtualRows.totalHeight}px`, '--hovered-column-x': `calc(${hoveredColumnDepth} * var(--tree-indent-step, 1.55rem) + var(--tree-control-center, 1.125rem))`, '--hovered-column-bottom': columnLineBottom != null ? `${virtualRows.totalHeight - columnLineBottom}px` : '0px' }}
            onMouseMove={handleTreeMouseMove}
            onMouseLeave={handleTreeMouseLeave}
          >
            {virtualRows.items.map(({ rowId, top, trimTopGuide, trimBottomGuide }) => {
              const row = index.rowsById.get(rowId);
              if (!row) {
                return null;
              }

              return (
                <TreeEntryRow
                  key={row.id}
                  row={row}
                  collapsed={collapsedIds.has(row.id)}
                  detailsVisible={detailOverrides.get(row.id) ?? detailed}
                  highlighted={row.id === highlightedRowId}
                  onToggleCollapsed={handleToggleCollapsed}
                  onToggleDetails={handleToggleDetails}
                  onSetRowState={handleSetRowState}
                  onAnchorRow={handleAnchorRow}
                  onDownloadError={onDownloadError}

                  onHeightChange={handleRowHeightChange}
                  virtualTop={top}
                  trimTopGuide={trimTopGuide}
                  trimBottomGuide={trimBottomGuide}
                />
              );
            })}
          </div>
        ) : (
          <div className={listClassName}>
            {visibleRowIds.map((rowId) => {
              const row = index.rowsById.get(rowId);
              if (!row) {
                return null;
              }

              return (
                <TreeEntryRow
                  key={row.id}
                  row={row}
                  collapsed={collapsedIds.has(row.id)}
                  detailsVisible={detailOverrides.get(row.id) ?? detailed}
                  highlighted={row.id === highlightedRowId}
                  onToggleCollapsed={handleToggleCollapsed}
                  onToggleDetails={handleToggleDetails}
                  onSetRowState={handleSetRowState}
                  onAnchorRow={handleAnchorRow}
                  onDownloadError={onDownloadError}

                />
              );
            })}
          </div>
        )
      ) : (
        <EmptyState message={emptyMessage} />
      )}
      {visibleRowIds.length > 0 ? <ScrollToSectionTopButton anchor={anchor} /> : null}
    </CollapsibleSection>
  );
});

export default TreeSection;
