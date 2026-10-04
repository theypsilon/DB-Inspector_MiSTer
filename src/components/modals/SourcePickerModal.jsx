import { memo, useMemo, useState } from 'react';
import DatabasePickerModal from './DatabasePickerModal.jsx';
import { formatFilterPromptValue } from '../../lib/filterDefaults.js';
import { selectOnePerDbId } from '../../lib/selection.js';
import { chosenMisterFilter, firstMisterKey } from '../../lib/pickerSelection.js';

const NO_KEYS = [];
const NO_PRESETS = [];

const MISTER_FILTER_HELP =
  'It applies to every database you open without a filter of its own, and fills in [mister] in the filters that inherit it.';

// The [mister] filters of the lists being opened. One is applied with a checkbox; between several,
// one (or none) is chosen, since databases opened together share one [mister] filter.
function MisterFilterChoice({ options, showSources, value, onChange }) {
  if (options.length === 1) {
    const [option] = options;
    return (
      <article className="mister-option">
        <p className="section-label">[mister] section</p>
        <label className="mister-option-toggle">
          <input
            type="checkbox"
            className="catalog-option-check"
            checked={value === option.key}
            onChange={(event) => onChange(event.target.checked ? option.key : null)}
          />
          <span>Apply the [mister] filter</span>
          <code>{formatFilterPromptValue(option.filter)}</code>
        </label>
        {showSources ? (
          <span className="catalog-option-origin">
            From <code>{option.label}</code>
          </span>
        ) : null}
        <p className="helper-copy">{MISTER_FILTER_HELP}</p>
      </article>
    );
  }

  return (
    <fieldset className="mister-option">
      <legend className="section-label">[mister] sections</legend>
      <p className="helper-copy">
        Several lists set a [mister] filter, and the databases you open share one. {MISTER_FILTER_HELP}
      </p>
      {options.map((option) => (
        <label key={option.key} className="mister-option-toggle">
          <input
            type="radio"
            name="mister-filter"
            className="catalog-option-check"
            checked={value === option.key}
            onChange={() => onChange(option.key)}
          />
          <span>
            From <code>{option.label}</code>
          </span>
          <code>{formatFilterPromptValue(option.filter)}</code>
        </label>
      ))}
      <label className="mister-option-toggle">
        <input
          type="radio"
          name="mister-filter"
          className="catalog-option-check"
          checked={value === null}
          onChange={() => onChange(null)}
        />
        <span>No [mister] filter</span>
      </label>
    </fieldset>
  );
}

// The databases of a database list, or of uploaded files, all selected at first (one per db_id).
// `choice` is built by buildListChoice or buildUploadChoice.
/**
 * @typedef {object} SourcePickerModalProps
 * @property {any} choice a list or upload choice (see selection.js)
 * @property {any[]} loadedDatabases
 * @property {() => void} onClose
 * @property {(entries: any[], options: { misterFilter: string | null }) => void} onOpenDatabases
 */
const SourcePickerModal = memo(/** @param {SourcePickerModalProps} props */ function SourcePickerModal({ choice, loadedDatabases, onClose, onOpenDatabases }) {
  const [misterKey, setMisterKey] = useState(() => firstMisterKey(choice));
  const [misterChoice, setMisterChoice] = useState(choice);
  const initialSelectedKeys = useMemo(() => selectOnePerDbId(choice.entries), [choice]);

  // A new list or upload starts with its first [mister] filter applied.
  if (misterChoice !== choice) {
    setMisterChoice(choice);
    setMisterKey(firstMisterKey(choice));
  }

  const misterFilter = chosenMisterFilter(choice, misterKey);
  return (
    <DatabasePickerModal
      label={choice.label}
      title={choice.title}
      entries={choice.entries}
      search={choice.search}
      initialSelectedKeys={initialSelectedKeys}
      preferredKeys={NO_KEYS}
      presets={NO_PRESETS}
      loadedDatabases={loadedDatabases}
      listLabel={choice.listLabel}
      emptyMessage="No entries match the current search."
      intro={
        choice.misterOptions.length ? (
          <MisterFilterChoice
            options={choice.misterOptions}
            showSources={choice.kind === 'upload'}
            value={misterKey}
            onChange={setMisterKey}
          />
        ) : null
      }
      onClose={onClose}
      onOpen={(entries) => onOpenDatabases(entries, { misterFilter })}
    />
  );
});

export default SourcePickerModal;
