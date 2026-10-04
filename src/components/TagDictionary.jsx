import { useState, useEffect, useEffectEvent, useCallback, useRef } from 'react';
import CollapsibleSection from './ui/CollapsibleSection.jsx';
import EmptyState from './ui/EmptyState.jsx';
import { collectTextMatchRanges, tagPillId } from '../lib/utils.js';

// The tag dictionary: of the loaded database (`tags`), or of each combined database (`groups`,
// as [{ dbId, tags }]).
function TagDictionary({ tags, groups, searchQuery, searchMatch }) {
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
      ranges.push(...collectTextMatchRanges(pill, queryLower));
    }
    if (ranges.length && CSS.highlights) {
      CSS.highlights.set('search-match-all-tags', new Highlight(...ranges));
    } else {
      CSS.highlights?.delete('search-match-all-tags');
    }
  }, [searchQuery, searchMatch, tags, groups]);

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
      const ranges = collectTextMatchRanges(pill, queryLower);
      if (ranges.length) {
        CSS.highlights.set('search-match', new Highlight(...ranges));
      }
    });
  }, []);

  const pendingSearchMatchRef = useRef(null);

  // Runs only when the current match changes; reads `open` as of that render.
  const followSearchMatch = useEffectEvent(() => {
    if (!searchMatch) return;
    if (!open) {
      pendingSearchMatchRef.current = searchMatch;
      setOpen(true);
      return;
    }
    navigateToTagPill(searchMatch);
  });

  useEffect(() => {
    followSearchMatch();
  }, [searchMatch?.token]);

  useEffect(() => {
    if (!open || !pendingSearchMatchRef.current) return;
    const pending = pendingSearchMatchRef.current;
    pendingSearchMatchRef.current = null;
    requestAnimationFrame(() => navigateToTagPill(pending));
  }, [open, navigateToTagPill]);

  return (
    <CollapsibleSection
      label="Tags"
      title="Filter terms"
      className="tag-dictionary"
      open={open}
      onToggle={setOpen}
      anchor="tags"
    >
      {groups ? (
        <div className="tag-groups" ref={cloudRef}>
          {groups.map(({ dbId, tags: groupTags }) => (
            <div key={dbId} className="tag-group">
              <p className="dictionary-meta">
                <span className="db-chip">{dbId}</span> {groupTags.length} entries
              </p>
              {groupTags.length ? (
                <div className="tag-cloud">
                  {groupTags.map((tag) => (
                    <span key={`${tag.name}:${tag.index}`} id={tagPillId(tag, dbId)} className="dictionary-pill">
                      <strong>{tag.name}</strong>
                      <span>{tag.index}</span>
                    </span>
                  ))}
                </div>
              ) : (
                <EmptyState message="No tag dictionary was provided." />
              )}
            </div>
          ))}
        </div>
      ) : (
        <>
          <p className="dictionary-meta">{tags.length} entries</p>
          {tags.length ? (
            <div className="tag-cloud" ref={cloudRef}>
              {tags.map((tag) => (
                <span key={`${tag.name}:${tag.index}`} id={tagPillId(tag)} className="dictionary-pill">
                  <strong>{tag.name}</strong>
                  <span>{tag.index}</span>
                </span>
              ))}
            </div>
          ) : (
            <EmptyState message="No tag dictionary was provided." />
          )}
        </>
      )}
    </CollapsibleSection>
  );
}

export default TagDictionary;
