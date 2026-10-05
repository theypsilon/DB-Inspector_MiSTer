import FieldValue from './FieldValue.jsx';
import TagList from './TagList.jsx';

/**
 * A row's primary fields: its tags, and pills for the rest. `tagView` is how its tags show, and
 * `tagsShown` how many of them the compact view shows (see TagList).
 * @param {{ fields: any[], tagView?: 'compact' | 'expanded' | 'all', tagsShown?: number, onToggleTags?: () => void }} props
 */
function PrimaryFieldRow({ fields, tagView = 'all', tagsShown, onToggleTags }) {
  if (!fields.length) {
    return null;
  }

  return (
    <div className="primary-row">
      {fields.map((field, index) =>
        field.kind === 'tags' ? (
          <div key={`${field.label}:${index}`} className="primary-tags">
            <TagList tags={field.value} view={tagView} shownCount={tagsShown} onToggle={onToggleTags} />
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
