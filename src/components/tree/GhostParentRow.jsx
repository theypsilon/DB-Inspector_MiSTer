function GhostParentRow({ row, containerLeft, onNavigate }) {
  if (!row) return null;
  const isArchive = row.type === 'archive';
  const title = isArchive ? row.archive.title : row.node.name;
  const badge = isArchive ? 'ZIP' : row.node.badge;
  const badgeClassName = isArchive
    ? 'node-badge archive-badge'
    : `node-badge ${row.node.kind === 'file' ? 'file-badge' : 'folder-badge'}`;

  const rootFontSize = typeof document !== 'undefined'
    ? parseFloat(getComputedStyle(document.documentElement).fontSize)
    : 16;
  const indentPx = row.depth * 1.55 * rootFontSize;
  const controlCenterPx = (2.25 / 2) * rootFontSize;
  const linePx = (containerLeft || 0) + indentPx + controlCenterPx;

  return (
    <div
      className="ghost-parent-row"
      style={{ '--ghost-line-x': `${linePx}px` }}
      onClick={onNavigate}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onNavigate();
      }}
    >
      <div className="ghost-badge-stack">
        <span className={badgeClassName}>{badge}</span>
        <span className="ghost-nav-arrow" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
            <path d="M3.22 9.78a.749.749 0 0 1 0-1.06l4.25-4.25a.749.749 0 0 1 1.06 0l4.25 4.25a.749.749 0 1 1-1.06 1.06L8 6.06 4.28 9.78a.749.749 0 0 1-1.06 0Z" />
          </svg>
        </span>
      </div>
      <span className="ghost-parent-name">{title}</span>
    </div>
  );
}

export default GhostParentRow;
