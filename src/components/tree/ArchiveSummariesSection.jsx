import { memo } from 'react';
import TreeSection from './TreeSection.jsx';

// The section's own label, title, list class and anchor are set here.
const ArchiveSummariesSection = memo(
  /** @param {Omit<import('./TreeSection.jsx').TreeSectionProps, 'label' | 'title' | 'listClassName' | 'anchor'>} props */
  function ArchiveSummariesSection(props) {
  return (
    <TreeSection
      {...props}
      label="Content"
      title="Archives"
      listClassName="archive-list"
      anchor="archives"
    />
  );
});

export default ArchiveSummariesSection;
