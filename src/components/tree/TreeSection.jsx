import { memo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import CollapsibleSection from '../ui/CollapsibleSection.jsx';
import SectionControls from '../ui/SectionControls.jsx';
import EmptyState from '../ui/EmptyState.jsx';
import ScrollToSectionTopButton from '../ui/ScrollToSectionTopButton.jsx';
import VirtualTreeEntryRow from './VirtualTreeEntryRow.jsx';
import GhostParentRow from './GhostParentRow.jsx';
import useTreeRowState from './useTreeRowState.js';
import useTreeNavigation from './useTreeNavigation.js';
import useGhostParent from './useGhostParent.js';
import { scrollToMeasuredRow, useMeasuredRowLayout, useVirtualRowWindow } from './useVirtualTree.js';
import { collectTextMatchRanges } from '../../lib/utils.js';

// A collapsible tree list that renders only the rows near the viewport (plus overscan), with its
// expand/collapse controls, empty state, and scroll-to-top button.
const TreeSection = memo(function TreeSection({
  label,
  title,
  listClassName,
  emptyMessage,
  index,
  detailed,
  anchorRowId,
  altAnchorRowId,
  onAnchorHandled,
  searchMatch,
  searchQuery,
  anchor,
  onDownloadError,
}) {
  const rows = useTreeRowState(index, detailed);
  const layout = useMeasuredRowLayout({
    index,
    visibleRowIds: rows.visibleRowIds,
    collapsedIds: rows.collapsedIds,
    detailOverrides: rows.detailOverrides,
    detailed,
  });
  const navigation = useTreeNavigation({
    index,
    anchor,
    anchorRowId,
    altAnchorRowId,
    onAnchorHandled,
    searchMatch,
    setCollapsedIds: rows.setCollapsedIds,
    scrollToUnrenderedRow: (request) => scrollToMeasuredRow(layout, rows.visibleRowIds, request),
  });
  const { viewport, virtualRows, handleRowHeightChange } = useVirtualRowWindow({
    layout,
    index,
    visibleRowIds: rows.visibleRowIds,
    collapsedIds: rows.collapsedIds,
    detailOverrides: rows.detailOverrides,
    detailed,
    suppressAnchoringRef: navigation.suppressAnchoringRef,
  });
  const { containerRef } = layout;

  // Highlights the find-in-page query in every rendered row except the current match.
  const searchHighlightName = `search-match-all-${anchor}`;
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
      ranges.push(...collectTextMatchRanges(rowEl, queryLower));
    }
    if (ranges.length && CSS.highlights) {
      CSS.highlights.set(searchHighlightName, new Highlight(...ranges));
    } else {
      CSS.highlights?.delete(searchHighlightName);
    }
  }, [containerRef, searchHighlightName, searchQuery, searchMatch, virtualRows]);

  const ghost = useGhostParent({
    containerRef,
    index,
    virtualRows,
    virtualLayout: layout.virtualLayout,
    visibleRowIds: rows.visibleRowIds,
    scrollY: viewport.scrollY,
  });
  const hasRows = rows.visibleRowIds.length > 0;

  return (
    <CollapsibleSection
      label={label}
      title={title}
      defaultOpen
      anchor={anchor}
      actions={
        <SectionControls
          onExpandAll={rows.handleExpandAll}
          onCollapseAll={rows.handleCollapseAll}
        />
      }
    >
      {ghost.ghostParentId && typeof document !== 'undefined'
        ? createPortal(
            <GhostParentRow
              row={index.rowsById.get(ghost.ghostParentId)}
              containerLeft={containerRef.current ? containerRef.current.getBoundingClientRect().left : 0}
              onNavigate={() => {
                const targetId = ghost.ghostParentId;
                ghost.clearGhost();
                navigation.scrollToRow(targetId);
              }}
            />,
            document.body,
          )
        : null}
      {hasRows ? (
        <div
          className={`${listClassName}${ghost.hoveredColumnDepth >= 0 ? ' tree-column-hovered' : ''}`}
          ref={containerRef}
          style={{
            height: `${virtualRows.totalHeight}px`,
            '--hovered-column-x': `calc(${ghost.hoveredColumnDepth} * var(--tree-indent-step, 1.55rem) + var(--tree-control-center, 1.125rem))`,
            '--hovered-column-bottom': ghost.columnLineBottom != null ? `${virtualRows.totalHeight - ghost.columnLineBottom}px` : '0px',
          }}
          onMouseMove={ghost.handleTreeMouseMove}
          onMouseLeave={ghost.handleTreeMouseLeave}
        >
          {virtualRows.items.map(({ rowId, top, trimTopGuide, trimBottomGuide }) => {
            const row = index.rowsById.get(rowId);
            if (!row) {
              return null;
            }

            return (
              <VirtualTreeEntryRow
                key={row.id}
                row={row}
                collapsed={rows.collapsedIds.has(row.id)}
                detailsVisible={rows.detailOverrides.get(row.id) ?? detailed}
                highlighted={row.id === navigation.highlightedRowId}
                onToggleCollapsed={rows.handleToggleCollapsed}
                onToggleDetails={rows.handleToggleDetails}
                onSetRowState={rows.handleSetRowState}
                onAnchorRow={navigation.handleAnchorRow}
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
        <EmptyState message={emptyMessage} />
      )}
      {hasRows ? <ScrollToSectionTopButton anchor={anchor} /> : null}
    </CollapsibleSection>
  );
});

export default TreeSection;
