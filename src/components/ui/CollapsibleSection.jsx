import SectionAnchor from './SectionAnchor.jsx';

function CollapsibleSection({
  label,
  title,
  defaultOpen = false,
  actions,
  children,
  className = '',
  open,
  onToggle,
  summaryAside = null,
  anchor,
}) {
  return (
    <details
      id={anchor ? `section-${anchor}` : undefined}
      className={className ? `panel collapsible-panel ${className}` : 'panel collapsible-panel'}
      open={open ?? defaultOpen}
      onToggle={(event) => onToggle?.(event.currentTarget.open)}
    >
      <summary className="section-summary">
        <div>
          <p className="section-label">{label}</p>
          <h2>
            {anchor ? (
              <SectionAnchor anchor={anchor} />
            ) : null}
            {title}
          </h2>
        </div>
        <div className="section-summary-side">
          {summaryAside}
          <span className="summary-indicator" />
        </div>
      </summary>
      <div className="collapsible-content">
        {actions ? <div className="collapsible-actions">{actions}</div> : null}
        {children}
      </div>
    </details>
  );
}

export default CollapsibleSection;
