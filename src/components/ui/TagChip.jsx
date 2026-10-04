import { updateTooltipPlacement } from '../../lib/utils.js';

function TagChip({ tag }) {
  return (
    <span
      className={tag.rawLabel ? 'tag-chip has-tooltip' : 'tag-chip'}
      onMouseEnter={tag.rawLabel ? (e) => updateTooltipPlacement(e.currentTarget) : undefined}
    >
      {tag.label}
      {tag.rawLabel ? <span className="chip-tooltip">Tag {tag.rawLabel}</span> : null}
    </span>
  );
}

export default TagChip;
