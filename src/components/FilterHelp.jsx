import { filterHelpClauses } from '../lib/filterHelp.js';

// How FILTER terms work, with the `essential` term searchable when the content uses it.
function FilterHelp({ hasEssentialHint, hasUntaggedItems, onSearchEssential }) {
  const clauses = filterHelpClauses({ hasEssentialHint, hasUntaggedItems });
  return (
    <p className="helper-copy">
      Filter content with terms (a.k.a. tags) like <code>console</code>, <code>arcade</code>,
      or <code>!cheats</code>. Positive terms keep matching tagged items, negative terms
      remove them
      {clauses.essential ? (
        <>
          {clauses.untagged === 'middle' ? <>, untagged items remain visible,</> : null}
          {' and '}
          <code
            id="filter-essential-hint"
            className="clickable-code"
            role="button"
            tabIndex={0}
            onClick={onSearchEssential}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onSearchEssential();
              }
            }}
          >
            essential
          </code>
          {' stays included unless you exclude it'}
        </>
      ) : clauses.untagged === 'end' ? (
        <>, and untagged items remain visible</>
      ) : null}
      .{' '}
      <a
        href="https://github.com/MiSTer-devel/Downloader_MiSTer/blob/main/docs/download-filters.md"
        target="_blank"
        rel="noreferrer"
        style={{ whiteSpace: 'nowrap' }}
      >
        Read the official guide
      </a>
      .
    </p>
  );
}

export default FilterHelp;
