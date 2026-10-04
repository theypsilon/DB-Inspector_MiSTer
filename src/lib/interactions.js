// Small interactions of the page, kept out of the components so they can be tested.

// Enter in a FILTER box applies it by leaving the box, instead of adding a new line.
export function blurOnEnter(event) {
  if (event.key !== 'Enter') {
    return false;
  }

  event.preventDefault();
  event.target.blur();
  return true;
}

// A hint's tooltip toggles on click (for touch), and closes when the pointer leaves or focus moves
// away ('mouseleave', 'blur').
export function nextInfoHintOpen(open, eventType) {
  return eventType === 'click' ? !open : false;
}

// A section's anchor puts the section in the address, opens it when it is collapsed, and scrolls
// to it. `section` is the section's element, if any.
export function activateSectionAnchor({ anchor, section, history }) {
  history.replaceState(null, '', `#${anchor}`);
  if (section) {
    if (section.tagName === 'DETAILS' && !section.open) {
      section.open = true;
    }
    section.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
}
