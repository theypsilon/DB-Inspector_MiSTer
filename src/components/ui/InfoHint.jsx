import { nextInfoHintOpen } from '../../lib/interactions.js';
import { updateTooltipPlacement } from '../../lib/utils.js';

function followHint(element, eventType) {
  element.toggleAttribute('data-open', nextInfoHintOpen(element.hasAttribute('data-open'), eventType));
}

// Inline value with a tooltip that toggles on click (for touch) and closes when the pointer
// leaves or focus moves away.
function InfoHint({ className, label, tip, children }) {
  return (
    <span
      className={className ? `${className} info-hint` : 'info-hint'}
      tabIndex={0}
      role="button"
      aria-label={label}
      onClick={(event) => {
        updateTooltipPlacement(event.currentTarget);
        followHint(event.currentTarget, 'click');
      }}
      onMouseLeave={(event) => followHint(event.currentTarget, 'mouseleave')}
      onBlur={(event) => followHint(event.currentTarget, 'blur')}
    >
      {children}
      <span className="info-tip">{tip}</span>
    </span>
  );
}

export default InfoHint;
