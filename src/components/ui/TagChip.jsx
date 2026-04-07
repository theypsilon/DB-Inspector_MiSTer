function TagChip({ tag }) {
  return (
    <span
      className={tag.rawLabel ? 'tag-chip has-tooltip' : 'tag-chip'}
      onMouseEnter={tag.rawLabel ? (e) => {
        e.currentTarget.classList.toggle('tooltip-below', e.currentTarget.getBoundingClientRect().top < 80);
      } : undefined}
    >
      {tag.label}
      {tag.rawLabel ? <span className="chip-tooltip">Tag {tag.rawLabel}</span> : null}
    </span>
  );
}

export default TagChip;
