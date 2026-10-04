import { startTransition, useCallback, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  collectVisibleRowIds,
  findCollapsibleRowIds,
  setDetailVisibilityOverride,
  setSetMembership,
  toggleDetailOverride,
  toggleSetMembership,
} from '../../lib/treeIndex.js';

// Which rows are collapsed, show details or show all their tags, the rows that are visible as a
// result, and the handlers that change them.
export default function useTreeRowState(index, detailed) {
  const [collapsedIds, setCollapsedIds] = useState(() => new Set());
  const [detailOverrides, setDetailOverrides] = useState(() => new Map());
  const [expandedTagIds, setExpandedTagIds] = useState(() => new Set());
  const visibleRowIds = useMemo(
    () => collectVisibleRowIds(index.rootIds, index.rowsById, collapsedIds),
    [index, collapsedIds],
  );

  const handleExpandAll = useCallback(() => {
    startTransition(() => {
      setCollapsedIds(new Set());
    });
  }, []);

  const handleCollapseAll = useCallback(() => {
    startTransition(() => {
      setCollapsedIds(new Set(findCollapsibleRowIds(index)));
    });
  }, [index]);

  const handleToggleCollapsed = useCallback((rowId) => {
    flushSync(() => {
      setCollapsedIds((current) => toggleSetMembership(current, rowId));
    });
  }, []);

  const handleToggleTags = useCallback((rowId) => {
    flushSync(() => {
      setExpandedTagIds((current) => toggleSetMembership(current, rowId));
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

  return {
    collapsedIds,
    setCollapsedIds,
    detailOverrides,
    expandedTagIds,
    visibleRowIds,
    handleExpandAll,
    handleCollapseAll,
    handleToggleCollapsed,
    handleToggleDetails,
    handleToggleTags,
    handleSetRowState,
  };
}
