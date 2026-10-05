import { useEffect, useState } from 'react';

// Whether the page matches a media query, following it as the window changes. Without matchMedia
// it never matches.
/** @param {string} query */
export default function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => Boolean(window.matchMedia?.(query)?.matches));

  useEffect(() => {
    const list = window.matchMedia?.(query);
    if (!list?.addEventListener) {
      return undefined;
    }
    const follow = () => setMatches(list.matches);
    follow();
    list.addEventListener('change', follow);
    return () => list.removeEventListener('change', follow);
  }, [query]);

  return matches;
}
