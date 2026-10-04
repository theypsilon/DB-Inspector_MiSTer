import EmptyState from './ui/EmptyState.jsx';

// A database list, or a set of uploaded files, waiting for the user to choose the databases to
// open. `choice` is built by buildListChoice or buildUploadChoice.
function ChoicePanel({ choice, onBrowseEntries }) {
  return (
    <section className="panel source-panel">
      <p className="section-label">{choice.panelLabel}</p>
      <h2>Choose databases</h2>
      <p className="helper-copy">{choice.description} Choose the ones you want to open.</p>
      <div className="button-row">
        <button type="button" onClick={onBrowseEntries}>
          Browse entries
        </button>
      </div>
      <EmptyState message="Choose databases in the list modal to open them." />
    </section>
  );
}

export default ChoicePanel;
