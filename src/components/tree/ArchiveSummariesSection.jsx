import { memo } from 'react';
import TreeSection from './TreeSection.jsx';

const ArchiveSummariesSection = memo(function ArchiveSummariesSection(props) {
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
