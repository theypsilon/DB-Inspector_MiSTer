// How the FILTER help sentence adapts to the content: with `essential` among the tags it says that
// essential stays included (and that untagged items remain visible, when there are any, in the
// middle); without it, untagged items get the closing clause instead.
export function filterHelpClauses({ hasEssentialHint, hasUntaggedItems }) {
  if (hasEssentialHint) {
    return { essential: true, untagged: hasUntaggedItems ? 'middle' : null };
  }

  return { essential: false, untagged: hasUntaggedItems ? 'end' : null };
}
