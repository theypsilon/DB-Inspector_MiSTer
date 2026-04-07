function DetailedToggle({ detailed, onDetailedChange }) {
  return (
    <button
      type="button"
      className="toggle-group toggle-group-button"
      aria-label="Detailed toggle"
      aria-pressed={detailed}
      onClick={() => onDetailedChange(!detailed)}
    >
      <span className="toggle-label">Detailed</span>
      <span className={!detailed ? 'toggle-chip active' : 'toggle-chip'}>
        Off
      </span>
      <span className={detailed ? 'toggle-chip active' : 'toggle-chip'}>
        On
      </span>
    </button>
  );
}

export default DetailedToggle;
