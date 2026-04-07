import { useState, useEffect, useCallback, useRef } from 'react';
import CollapsibleSection from './ui/CollapsibleSection.jsx';
import EmptyState from './ui/EmptyState.jsx';

function TagDictionary({ tags, searchQuery, searchMatch }) {
  const [open, setOpen] = useState(true);
  const cloudRef = useRef(null);

  useEffect(() => {
    if (!searchQuery || !cloudRef.current) {
      CSS.highlights?.delete('search-match-all-tags');
      return;
    }
    const queryLower = searchQuery.toLowerCase();
    const currentPillId = searchMatch?.rowId ?? null;
    const ranges = [];
    const pills = cloudRef.current.querySelectorAll('.dictionary-pill');
    for (const pill of pills) {
      if (currentPillId && pill.id === currentPillId) continue;
      const walker = document.createTreeWalker(pill, NodeFilter.SHOW_TEXT);
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
      CSS.highlights.set('search-match-all-tags', new Highlight(...ranges));
    } else {
      CSS.highlights?.delete('search-match-all-tags');
    }
  }, [searchQuery, searchMatch, tags]);

  const navigateToTagPill = useCallback((match) => {
    requestAnimationFrame(() => {
      const pill = document.getElementById(match.rowId);
      if (!pill) return;
      const rect = pill.getBoundingClientRect();
      const inViewport = rect.top >= 0 && rect.bottom <= window.innerHeight;
      if (!inViewport) {
        pill.scrollIntoView({ block: 'center' });
      }
      if (!CSS.highlights) return;
      CSS.highlights.delete('search-match');
      const queryLower = (match.query || '').toLowerCase();
      if (!queryLower) return;
      const ranges = [];
      const walker = document.createTreeWalker(pill, NodeFilter.SHOW_TEXT);
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
      if (ranges.length) {
        CSS.highlights.set('search-match', new Highlight(...ranges));
      }
    });
  }, []);

  const pendingSearchMatchRef = useRef(null);

  useEffect(() => {
    if (!searchMatch) return;
    if (!open) {
      pendingSearchMatchRef.current = searchMatch;
      setOpen(true);
      return;
    }
    navigateToTagPill(searchMatch);
  }, [searchMatch?.token]);

  useEffect(() => {
    if (!open || !pendingSearchMatchRef.current) return;
    const pending = pendingSearchMatchRef.current;
    pendingSearchMatchRef.current = null;
    requestAnimationFrame(() => navigateToTagPill(pending));
  }, [open]);

  return (
    <CollapsibleSection
      label="Tags"
      title="Filter terms"
      className="tag-dictionary"
      open={open}
      onToggle={setOpen}
      anchor="tags"
    >
      <p className="dictionary-meta">{tags.length} entries</p>
      {tags.length ? (
        <div className="tag-cloud" ref={cloudRef}>
          {tags.map((tag) => (
            <span key={`${tag.name}:${tag.index}`} id={`tagdict-${tag.name}-${tag.index}`} className="dictionary-pill">
              <strong>{tag.name}</strong>
              <span>{tag.index}</span>
            </span>
          ))}
        </div>
      ) : (
        <EmptyState message="No tag dictionary was provided." />
      )}
    </CollapsibleSection>
  );
}

export default TagDictionary;
