import { memo } from 'react';
import TreeSection from './TreeSection.jsx';

const ArchiveSummariesSection = memo(function ArchiveSummariesSection({ index, emptyMessage, detailed, onDetailedChange, anchorRowId, altAnchorRowId, onAnchorHandled, searchMatch, searchQuery, onDownloadError }) {
  return (
    <TreeSection
      label="Content"
      title="Archives"
      listClassName="archive-list"
      emptyMessage={emptyMessage}
      index={index}
      detailed={detailed}
      onDetailedChange={onDetailedChange}
      anchorRowId={anchorRowId}
      altAnchorRowId={altAnchorRowId}
      onAnchorHandled={onAnchorHandled}
      searchMatch={searchMatch}
      searchQuery={searchQuery}
      anchor="archives"
      onDownloadError={onDownloadError}
    />
  );
});

export default ArchiveSummariesSection;
