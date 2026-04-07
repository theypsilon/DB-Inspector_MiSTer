import { useState, useEffect, useMemo, useCallback, useRef } from 'react';

const EMPTY_MATCHES = [];

function useGlobalSearch({ filesystemIndex, archivesIndex, tagDictionary, hasEssentialHint, hasInspection }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const [token, setToken] = useState(0);

  const matches = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return EMPTY_MATCHES;
    const result = [];

    const searchIndex = (index, section) => {
      if (!index) return;
      for (const [id, row] of index.rowsById) {
        const name = (row.type === 'archive' ? row.archive.title : row.node.name) || '';
        const path = row.type !== 'archive' ? row.node.path || '' : '';
        if (name.toLowerCase().includes(trimmed)) {
          result.push({ rowId: id, section, matchPart: 'name' });
        } else if (path && path !== name && path.toLowerCase().includes(trimmed)) {
          result.push({ rowId: id, section, matchPart: 'path' });
        } else {
          const fields = row.type === 'archive' ? row.archive.primaryFields : row.node.primaryFields;
          const hasTagMatch = fields?.some(
            (f) => f.kind === 'tags' && Array.isArray(f.value) && f.value.some((t) => t.label.toLowerCase().includes(trimmed)),
          );
          if (hasTagMatch) {
            result.push({ rowId: id, section, matchPart: 'tags' });
          }
        }
      }
    };

    if (hasEssentialHint && 'essential'.includes(trimmed)) {
      result.push({ rowId: 'filter-essential-hint', section: 'filter', matchPart: 'name' });
    }

    searchIndex(filesystemIndex, 'filesystem');
    searchIndex(archivesIndex, 'archives');

    if (tagDictionary.length) {
      for (const tag of tagDictionary) {
        if (tag.name.toLowerCase().includes(trimmed)) {
          result.push({ rowId: `tagdict-${tag.name}-${tag.index}`, section: 'tags', matchPart: 'name' });
        }
      }
    }

    return result;
  }, [query, filesystemIndex, archivesIndex, tagDictionary, hasEssentialHint]);

  const clampedIndex = matches.length ? currentMatchIndex % matches.length : 0;
  const trimmedQuery = query.trim();
  const currentMatch = useMemo(
    () =>
      matches.length
        ? { rowId: matches[clampedIndex].rowId, section: matches[clampedIndex].section, matchPart: matches[clampedIndex].matchPart, query: trimmedQuery, token }
        : null,
    [matches, clampedIndex, trimmedQuery, token],
  );

  useEffect(() => {
    setCurrentMatchIndex(0);
    setToken((t) => t + 1);
  }, [matches]);

  const [focusToken, setFocusToken] = useState(0);
  const openSearch = useCallback(() => {
    const saved = sessionStorage.getItem('findBarQuery') || '';
    if (saved) setQuery(saved);
    setOpen(true);
    setFocusToken((t) => t + 1);
  }, []);
  const closeSearch = useCallback(() => {
    const trimmed = query.trim();
    if (trimmed) {
      sessionStorage.setItem('findBarQuery', trimmed);
    }
    setOpen(false);
    setQuery('');
    CSS.highlights?.delete('search-match');
    CSS.highlights?.delete('search-match-all-filter');
    CSS.highlights?.delete('search-match-all-files');
    CSS.highlights?.delete('search-match-all-archives');
    CSS.highlights?.delete('search-match-all-tags');
  }, [query]);

  const goToNextMatch = useCallback(() => {
    if (!matches.length) return;
    setToken((t) => t + 1);
    setCurrentMatchIndex((i) => (i + 1) % matches.length);
  }, [matches.length]);

  const goToPrevMatch = useCallback(() => {
    if (!matches.length) return;
    setToken((t) => t + 1);
    setCurrentMatchIndex((i) => (i - 1 + matches.length) % matches.length);
  }, [matches.length]);

  const jumpToMatch = useCallback((oneBasedIndex) => {
    if (!matches.length) return;
    const clamped = Math.max(0, Math.min(matches.length - 1, oneBasedIndex - 1));
    setToken((t) => t + 1);
    setCurrentMatchIndex(clamped);
  }, [matches.length]);

  const openRef = useRef(open);
  openRef.current = open;
  const closeSearchRef = useRef(closeSearch);
  closeSearchRef.current = closeSearch;
  const openSearchRef = useRef(openSearch);
  openSearchRef.current = openSearch;

  useEffect(() => {
    if (!hasInspection) return undefined;

    const onKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'f') {
        event.preventDefault();
        if (!openRef.current) {
          openSearchRef.current();
        } else {
          setFocusToken((t) => t + 1);
        }
      }
      if (event.key === 'Escape' && openRef.current) {
        closeSearchRef.current();
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [hasInspection]);

  return {
    open,
    query,
    setQuery,
    focusToken,
    currentMatchIndex: clampedIndex,
    totalMatches: matches.length,
    currentMatch,
    activeQuery: open ? trimmedQuery : '',
    openSearch,
    closeSearch,
    goToNextMatch,
    goToPrevMatch,
    jumpToMatch,
  };
}

export default useGlobalSearch;
