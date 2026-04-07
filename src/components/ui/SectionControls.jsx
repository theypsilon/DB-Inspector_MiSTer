function SectionControls({
  onExpandAll,
  onCollapseAll,
}) {
  return (
    <div className="section-controls">
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
