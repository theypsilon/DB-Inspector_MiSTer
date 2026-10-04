import { memo } from 'react';
import TreeSection from './TreeSection.jsx';

// The section's own label, title, list class and anchor are set here.
const FilesystemSection = memo(
  /** @param {Omit<import('./TreeSection.jsx').TreeSectionProps, 'label' | 'title' | 'listClassName' | 'anchor'>} props */
  function FilesystemSection(props) {
  return (
    <TreeSection
      {...props}
      label="Content"
      title="Files and folders"
      listClassName="tree-root"
      anchor="files"
    />
  );
});

export default FilesystemSection;
