import { updateTooltipPlacement } from '../../lib/utils.js';

// A tag. Its tooltip names its number in the tag dictionary; a `compact` chip shows only the
// tag's first name, and its tooltip all of them.
/** @param {{ tag: any, compact?: boolean }} props */
function TagChip({ tag, compact = false }) {
  const names = tag.names ?? [tag.label];
  const aliases = compact && names.length > 1 ? `: ${names.join(' / ')}` : '';
  const tooltip = tag.rawLabel ? `Tag ${tag.rawLabel}${aliases}` : null;
  return (
    <span
      className={tooltip ? 'tag-chip has-tooltip' : 'tag-chip'}
      onMouseEnter={tooltip ? (e) => updateTooltipPlacement(e.currentTarget) : undefined}
    >
      {compact ? names[0] : tag.label}
      {tooltip ? <span className="chip-tooltip">{tooltip}</span> : null}
    </span>
  );
}

export default TagChip;
