import { blurOnEnter } from '../lib/interactions.js';

// A FILTER text box. Enter applies the filter by leaving the box instead of adding a new line.
function FilterInput({ id, label, placeholder = 'console !cheats', value, onChange }) {
  return (
    <textarea
      id={id}
      className="filter-input"
      aria-label={label}
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={blurOnEnter}
      rows={1}
      wrap="off"
      spellCheck={false}
    />
  );
}

export default FilterInput;
