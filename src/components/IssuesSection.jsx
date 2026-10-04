import CollapsibleSection from './ui/CollapsibleSection.jsx';
import EmptyState from './ui/EmptyState.jsx';

function IssuesSection({ issues }) {
  return (
    <CollapsibleSection
      label="Diagnostics"
      title="Issues and warnings"
      defaultOpen
      anchor="issues"
    >
      {issues.length ? (
        <ul className="issue-list">
          {issues.map((issue) => (
            <li key={issue.id} className={`issue issue-${issue.level}`}>
              <span className="issue-level">{issue.level}</span>
              {issue.dbId ? <span className="db-chip">{issue.dbId}</span> : null}
              <strong>{issue.context}</strong>
              <span>{issue.message}</span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState message="No schema or path issues were detected by the browser-side inspector." />
      )}
    </CollapsibleSection>
  );
}

export default IssuesSection;
