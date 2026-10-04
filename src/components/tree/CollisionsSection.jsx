import { memo } from 'react';
import TreeSection from './TreeSection.jsx';

// Paths that more than one combined database would install, each with every version of it.
// The section's own label, title, list class and anchor are set here.
const CollisionsSection = memo(
  /** @param {Omit<import('./TreeSection.jsx').TreeSectionProps, 'label' | 'title' | 'listClassName' | 'anchor'>} props */
  function CollisionsSection(props) {
  return (
    <TreeSection
      {...props}
      label="Content"
      title="Path collisions"
      listClassName="collision-list"
      anchor="collisions"
    />
  );
});

export default CollisionsSection;
