import { memo } from 'react';
import TreeSection from './TreeSection.jsx';

const FilesystemSection = memo(function FilesystemSection(props) {
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
