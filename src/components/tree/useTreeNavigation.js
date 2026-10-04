import { useCallback, useEffect, useRef, useState } from 'react';
import { buildNodeAnchorHash } from '../../lib/urlState.js';
import { createRowFlash } from '../../lib/rowFlash.js';
import { findAncestorIds } from '../../lib/treeIndex.js';
import { collectTextMatchRanges, runAfterNextPaint } from '../../lib/utils.js';

// Brings rows into view for URL anchors, find-in-page matches and anchor-icon clicks: expands
// collapsed ancestors, scrolls to the row, and highlights the row and its matched text.
// `scrollToUnrenderedRow` handles rows outside the rendered window, which are not in the DOM yet.
export default function useTreeNavigation({
  index,
  anchor,
  anchorRowId: anchorRowIdProp,
  altAnchorRowId,
  onAnchorHandled,
  searchMatch,
  setCollapsedIds,
  scrollToUnrenderedRow,
}) {
  const [searchAnchorRowId, setSearchAnchorRowId] = useState(null);
  const [highlightedRowId, setHighlightedRowId] = useState(null);
  const searchMatchPartRef = useRef('name');
  const searchQueryRef = useRef('');
  // The search jump's row flash; the token of the search match this section is showing; and the
  // token of the match that requested the pending jump.
  const [searchFlash] = useState(() =>
    createRowFlash({
      setTimeout: (callback, delay) => window.setTimeout(callback, delay),
      clearTimeout: (timer) => window.clearTimeout(timer),
      onChange: (rowId, flashing) =>
        setHighlightedRowId((current) => (flashing ? rowId : current === rowId ? null : current)),
    }),
  );
  const searchTokenRef = useRef(null);
  const searchAnchorTokenRef = useRef(null);
  const suppressAnchoringRef = useRef(false);
  const resolvedPropAnchor = anchorRowIdProp && index.rowsById.has(anchorRowIdProp)
    ? anchorRowIdProp
    : altAnchorRowId && index.rowsById.has(altAnchorRowId)
      ? altAnchorRowId
      : anchorRowIdProp;
  const anchorRowId = resolvedPropAnchor || searchAnchorRowId;

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
    const ranges = collectTextMatchRanges(searchRoot, term.toLowerCase());
    if (ranges.length) {
      CSS.highlights.set('search-match', new Highlight(...ranges));
    }
  }, []);

  const endSearchFlash = useCallback(() => searchFlash.end(), [searchFlash]);

  useEffect(() => () => searchFlash.dispose(), [searchFlash]);

  // The two effects below run only when a new search match or anchor arrives, and read everything
  // else as of that render. (useEffectEvent can't express this here: React 19.2 does not refresh
  // Effect Events inside memo() components, and the tree sections are memoized.)
  useEffect(() => {
    searchTokenRef.current = searchMatch?.token ?? null;
    if (!searchMatch) {
      // Search closed or moved to another section.
      endSearchFlash();
      return;
    }
    const section = /** @type {(HTMLElement & { open?: boolean }) | null} */ (document.getElementById(`section-${anchor}`));
    if (section && !section.open) section.open = true;
    searchMatchPartRef.current = searchMatch.matchPart || 'name';
    searchQueryRef.current = searchMatch.query || '';
    searchAnchorTokenRef.current = searchMatch.token;
    setSearchAnchorRowId(searchMatch.rowId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchMatch?.token, anchor]);

  useEffect(() => {
    if (!anchorRowId || !index.rowsById.has(anchorRowId)) {
      return;
    }

    const ancestorsToExpand = findAncestorIds(index.rowsById, anchorRowId);

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

    // A jump whose search has closed or moved on in the meantime still scrolls, but is not
    // highlighted. The check repeats when the deferred scroll lands.
    const searchToken = isSearchMatch ? searchAnchorTokenRef.current : null;
    const isCurrentSearchMatch = () => isSearchMatch && searchTokenRef.current === searchToken;

    if (isCurrentSearchMatch()) {
      // Not tied to this effect's lifetime: the effect re-runs right away when the search anchor
      // is consumed, and the flash must outlive that.
      searchFlash.start(anchorRowId);
    }

    const applyRowHighlight = (rowElement) => {
      if (!isCurrentSearchMatch()) return;
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

      scrollToUnrenderedRow({ rowId: anchorRowId, applyRowHighlight, suppressAnchoringRef });
    };

    runAfterNextPaint(scrollToAnchor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorRowId, index]);

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

  return {
    highlightedRowId,
    suppressAnchoringRef,
    scrollToRow,
    handleAnchorRow,
  };
}
