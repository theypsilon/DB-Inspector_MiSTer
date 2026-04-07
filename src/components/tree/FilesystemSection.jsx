import { memo } from 'react';
import TreeSection from './TreeSection.jsx';

const FilesystemSection = memo(function FilesystemSection({ index, emptyMessage, detailed, onDetailedChange, anchorRowId, altAnchorRowId, onAnchorHandled, searchMatch, searchQuery, onDownloadError }) {
  return (
    <TreeSection
      label="Content"
      title="Files and folders"
      listClassName="tree-root"
      emptyMessage={emptyMessage}
      index={index}
      detailed={detailed}
      onDetailedChange={onDetailedChange}
      anchorRowId={anchorRowId}
      altAnchorRowId={altAnchorRowId}
      onAnchorHandled={onAnchorHandled}
      searchMatch={searchMatch}
      searchQuery={searchQuery}
      anchor="files"
      onDownloadError={onDownloadError}
    />
  );
});

export default FilesystemSection;
