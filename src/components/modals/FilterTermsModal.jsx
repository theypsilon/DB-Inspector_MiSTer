import { useEffect, useEffectEvent, useState } from 'react';
import ModalFrame from './ModalFrame.jsx';
import EmptyState from '../ui/EmptyState.jsx';
import { searchFilterTerms, termUse, toggleTerm } from '../../lib/filterTerms.js';
import { COMBINED_DATABASES_IN_FULL_MAX } from '../../lib/utils.js';

// The databases that have a term, as the terms list names them: each, or how many past a few.
function TermDatabases({ dbIds }) {
  if (dbIds.length > COMBINED_DATABASES_IN_FULL_MAX) {
    return <span title={dbIds.join(', ')}>{`${dbIds.length} databases`}</span>;
  }

  return dbIds.map((dbId, index) => (
    <span key={dbId}>
      {index ? ' ' : null}
      <span className="db-chip">{dbId}</span>
    </span>
  ));
}

function describeEntries(count) {
  if (!count) {
    return 'No entries';
  }
  return `${count.toLocaleString()} ${count === 1 ? 'entry' : 'entries'}`;
}

// A term's numbers in the tag dictionaries, for database authors.
function describeNumbers(term, combined) {
  if (!term.numbers.length) {
    return undefined;
  }
  return term.numbers
    .map(({ dbId, number }) => (combined ? `Tag ${number} in ${dbId}` : `Tag ${number} in the tag dictionary`))
    .join('\n');
}

/**
 * The terms one FILTER box can use (see src/lib/filterTerms.js), to keep or exclude in it: Keep
 * writes the term, Exclude writes it with `!`, and choosing what is already there takes it out.
 * @param {{
 *   intro: string,
 *   terms: import('../../lib/filterTerms.js').FilterTerm[],
 *   withoutTerms: string[],
 *   combined: boolean,
 *   filter: string,
 *   onFilterChange: (filter: string) => void,
 *   onClose: () => void,
 * }} props `intro` says which FILTER box the terms go in.
 */
export default function FilterTermsModal({ intro, terms, withoutTerms, combined, filter, onFilterChange, onClose }) {
  const [query, setQuery] = useState('');
  const shown = searchFilterTerms(terms, query);

  const handleKeyDown = useEffectEvent((event) => {
    if (event.key === 'Escape' && !event.defaultPrevented) {
      event.preventDefault();
      onClose();
    }
  });

  useEffect(() => {
    const listener = (event) => handleKeyDown(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  return (
    <ModalFrame
      label="FILTER"
      title="Filter terms"
      className="picker-panel filter-terms-panel"
      onClose={onClose}
      footer={
        <>
          <p className="filter-terms-current">
            <span className="catalog-meta-label">FILTER</span>{' '}
            {filter.trim() ? <code>{filter.trim()}</code> : <span className="filter-terms-empty">No terms</span>}
          </p>
          <button type="button" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <p className="helper-copy">
        {intro} Choosing a term again takes it out.
      </p>
      <div className="catalog-search">
        <label className="field-label" htmlFor="filter-terms-search">
          Search terms
        </label>
        <input
          id="filter-terms-search"
          type="search"
          placeholder="Name of a term"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoFocus
        />
      </div>
      <ul className="filter-terms-list modal-list" aria-label="Terms">
        {shown.map((term) => {
          const use = termUse(filter, term);
          return (
            <li key={term.id} className="filter-term">
              <div className="filter-term-text">
                <p className="filter-term-names">
                  <strong title={describeNumbers(term, combined)}>{term.name}</strong>
                  {term.aliases.length ? <> <span className="filter-term-aliases">also {term.aliases.join(', ')}</span></> : null}
                </p>
                <p className="filter-term-meta">
                  <span>{describeEntries(term.entries)}</span>
                  {combined ? <> <TermDatabases dbIds={term.dbIds} /></> : null}
                </p>
              </div>
              <div className="filter-term-actions">
                <button
                  type="button"
                  className={use.kept ? 'filter-term-use active' : 'filter-term-use'}
                  aria-pressed={use.kept}
                  aria-label={`Keep ${term.name}`}
                  onClick={() => onFilterChange(toggleTerm(filter, term, 'kept'))}
                >
                  Keep
                </button>
                <button
                  type="button"
                  className={use.excluded ? 'filter-term-use active' : 'filter-term-use'}
                  aria-pressed={use.excluded}
                  aria-label={`Exclude ${term.name}`}
                  onClick={() => onFilterChange(toggleTerm(filter, term, 'excluded'))}
                >
                  Exclude
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {!shown.length ? <EmptyState message={terms.length ? 'No term has that name.' : 'There are no terms to filter by.'} /> : null}
      {combined && withoutTerms.length ? (
        <p className="helper-copy filter-terms-without">
          No terms in{' '}
          {withoutTerms.map((dbId, index) => (
            <span key={dbId}>
              {index ? ', ' : null}
              <span className="db-chip">{dbId}</span>
            </span>
          ))}
          .
        </p>
      ) : null}
    </ModalFrame>
  );
}
