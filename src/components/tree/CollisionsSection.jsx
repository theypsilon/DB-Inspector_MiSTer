import { memo } from 'react';
import TreeSection from './TreeSection.jsx';

// Paths that more than one combined database would install, each with every version of it.
const CollisionsSection = memo(function CollisionsSection(props) {
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
