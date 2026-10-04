import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { findSearchMatches, matchIndexAt, nextMatchIndex, previousMatchIndex } from '../lib/search.js';

// `tagGroups` is [{ dbId, tags }]: one group with a null dbId for a single database.
function useGlobalSearch({ filesystemIndex, archivesIndex, collisionsIndex, tagGroups, hasEssentialHint, hasInspection }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const [token, setToken] = useState(0);

  const matches = useMemo(
    () => findSearchMatches({ query, filesystemIndex, archivesIndex, collisionsIndex, tagGroups, hasEssentialHint }),
    [query, filesystemIndex, archivesIndex, collisionsIndex, tagGroups, hasEssentialHint],
  );

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
    setCurrentMatchIndex((i) => nextMatchIndex(i, matches.length));
  }, [matches.length]);

  const goToPrevMatch = useCallback(() => {
    if (!matches.length) return;
    setToken((t) => t + 1);
    setCurrentMatchIndex((i) => previousMatchIndex(i, matches.length));
  }, [matches.length]);

  const jumpToMatch = useCallback((oneBasedIndex) => {
    if (!matches.length) return;
    setToken((t) => t + 1);
    setCurrentMatchIndex(matchIndexAt(oneBasedIndex, matches.length));
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
      // An Escape inside a menu (the theme menu) closes the menu, not the find bar.
      if (event.key === 'Escape' && openRef.current && !event.target?.closest?.('[role="menu"]')) {
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
