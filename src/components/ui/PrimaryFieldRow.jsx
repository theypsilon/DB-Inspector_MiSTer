import FieldValue from './FieldValue.jsx';

function PrimaryFieldRow({ fields }) {
  if (!fields.length) {
    return null;
  }

  return (
    <div className="primary-row">
      {fields.map((field, index) =>
        field.kind === 'tags' ? (
          <div key={`${field.label}:${index}`} className="primary-tags">
            <FieldValue field={field} />
          </div>
        ) : (
          <div key={`${field.label}:${index}`} className="primary-pill">
            <span>{field.label}</span>
            <FieldValue field={field} />
          </div>
        ),
      )}
    </div>
  );
}

export default PrimaryFieldRow;
