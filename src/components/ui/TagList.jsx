import TagChip from './TagChip.jsx';
import { compactTagList } from '../../lib/tagFit.js';

/**
 * A row's tags. 'compact' shows the first `shownCount` (by default the first few), one name each,
 * and a button with how many more there are; 'expanded' shows them all, with their aliases and a
 * button to show fewer again; 'all' shows them all, with nothing to change.
 * @param {{ tags: any[], view: 'compact' | 'expanded' | 'all', shownCount?: number, onToggle?: () => void }} props
 */
export default function TagList({ tags, view, shownCount, onToggle }) {
  if (view === 'compact') {
    const { shown, hiddenCount } = compactTagList(tags, shownCount);
    return (
      <div className="tag-chip-list">
        {shown.map((tag) => (
          <TagChip key={tag.id} tag={tag} compact />
        ))}
        {hiddenCount ? (
          <button type="button" className="tag-chip-toggle" aria-label={`+${hiddenCount} more tags`} onClick={onToggle}>
            +{hiddenCount}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="tag-chip-list">
      {tags.map((tag) => (
        <TagChip key={tag.id} tag={tag} />
      ))}
      {view === 'expanded' ? (
        <button type="button" className="tag-chip-toggle" onClick={onToggle}>
          Show fewer
        </button>
      ) : null}
    </div>
  );
}
