import { EntryIcon } from '../explorer/ExplorerIcons.jsx';

// A tree section's controls: the explorer, when the section offers it, then opening and closing
// every row.
/**
 * @param {{ onExpandAll: () => void, onCollapseAll: () => void, onOpenExplorer?: () => void }} props
 */
function SectionControls({
  onExpandAll,
  onCollapseAll,
  onOpenExplorer,
}) {
  return (
    <div className="section-controls">
      {onOpenExplorer ? (
        <button type="button" className="secondary-button explorer-open-button" onClick={onOpenExplorer}>
          <EntryIcon kind="folder" />
          Explorer
        </button>
      ) : null}
      <div className="button-row">
        <button type="button" onClick={onExpandAll}>
          Open all
        </button>
        <button type="button" className="secondary-button" onClick={onCollapseAll}>
          Close all
        </button>
      </div>
    </div>
  );
}

export default SectionControls;
