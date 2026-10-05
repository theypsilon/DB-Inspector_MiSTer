import { memo } from 'react';
import PrimaryFieldRow from '../ui/PrimaryFieldRow.jsx';
import MetadataList from '../ui/MetadataList.jsx';
import EmptyState from '../ui/EmptyState.jsx';
import { getRowFileLinks, triggerFileDownload } from '../../lib/downloads.js';
import { buildTreeDepthStyle, buildTreeGuideStyle } from '../../lib/treeLayout.js';
import { getRowBadge } from '../../lib/treeIndex.js';
import { updateTooltipPlacement } from '../../lib/utils.js';

// One tree row (archive, folder or file). TreeSection renders it through VirtualTreeEntryRow,
// which supplies `containerRef` and `virtualStyle` to position and measure it.
/**
 * @typedef {object} TreeEntryRowProps
 * @property {any} row the row (see treeIndex.js)
 * @property {boolean} collapsed
 * @property {boolean} detailsVisible
 * @property {boolean} [tagsExpanded] all its tags shown, as the user asked
 * @property {boolean} [tagsRevealed] all its tags shown, for the find-in-page match in one of them
 * @property {number} [tagsShown] how many tags it shows before "+N" (see fitTagCount); by default the first four
 * @property {boolean} [tagsHidden] its tags left off its line, for its details (see rowTagsHidden)
 * @property {boolean} [phone] laid out for a phone: no badge or "Path" label, its details button only
 *   for the keyboard, and a tap on the row shows or hides its details. Until they show, its heading
 *   is its name; with them, its full name and path, then its database and download links.
 * @property {boolean} highlighted
 * @property {(rowId: string) => void} onToggleCollapsed
 * @property {(rowId: string) => void} onToggleDetails
 * @property {(rowId: string) => void} [onToggleTags]
 * @property {(rowId: string, state: { collapsed: boolean, detailsVisible: boolean }) => void} onSetRowState
 * @property {(rowId: string) => void} onAnchorRow
 * @property {(error: any) => void} [onDownloadError]
 * @property {(image: { name: string, url: string }) => void} [onViewImage] shows an image's VIEW
 * @property {import('react').Ref<HTMLDivElement>} [containerRef]
 * @property {import('react').CSSProperties} [virtualStyle]
 */
const TreeEntryRow = memo(/** @param {TreeEntryRowProps} props */ function TreeEntryRow({
  row,
  collapsed,
  detailsVisible,
  tagsExpanded = false,
  tagsRevealed = false,
  tagsShown,
  tagsHidden = false,
  phone = false,
  highlighted,
  onToggleCollapsed,
  onToggleDetails,
  onToggleTags,
  onSetRowState,
  onAnchorRow,
  onDownloadError,
  onViewImage,
  containerRef,
  virtualStyle,
}) {
  const isArchive = row.type === 'archive';
  const childIds = row.childIds;
  const showCollapseControl = isArchive || childIds.length > 0;
  const title = isArchive ? row.archive.title : row.node.name;
  const { badge, badgeClassName } = getRowBadge(row);
  // Set when several databases are combined: the database the row comes from.
  const dbId = isArchive ? row.archive.dbId : row.node.dbId;
  const identifier = isArchive ? row.archive.id : row.node.path;
  const identifierLabel = isArchive ? 'Archive' : 'Path';
  const showIdentifier = isArchive || identifier !== title;
  const primaryFields = isArchive ? row.archive.primaryFields : row.node.primaryFields;
  const details = isArchive ? row.archive.details : row.node.details;
  const issues = isArchive ? row.archive.issues : [];
  const isFile = !isArchive && row.node.kind === 'file';
  const { downloadUrl, openUrl, viewUrl } = getRowFileLinks(row);
  const bodyCollapsed = isFile && collapsed;
  // Details show every tag; otherwise a row shows those that fit on its line, unless they were
  // asked for or the find-in-page match is in one of them.
  const tagView = detailsVisible ? 'all' : tagsExpanded ? 'expanded' : tagsRevealed ? 'all' : 'compact';
  const hasVisibleChildren = childIds.length > 0 && !collapsed;
  const containerClassName = [
    'tree-entry',
    row.depth ? 'tree-entry-indented' : '',
    isArchive ? 'archive-card' : '',
    highlighted ? 'tree-entry-highlighted' : '',
    phone && detailsVisible ? 'tree-entry-full-name' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const Container = isArchive ? 'article' : 'div';
  // On a phone, its name alone until its details show: no database or download links. Its database
  // then shows beside them rather than before its name, which keeps its line.
  const nameOnly = phone && !detailsVisible;

  const handleToggleRowDetails = () => {
    if (isFile && collapsed && !detailsVisible) {
      onSetRowState(row.id, {
        collapsed: false,
        detailsVisible: true,
      });
      return;
    }

    onToggleDetails(row.id);
  };

  const handleToggleRowCollapsed = () => {
    if (isFile && !collapsed && detailsVisible) {
      onSetRowState(row.id, {
        collapsed: true,
        detailsVisible: false,
      });
      return;
    }

    onToggleCollapsed(row.id);
  };

  // On a phone a tap on the row shows or hides its details, as its details button does elsewhere: not
  // a tap on a control, in its details or issues, or one that ends a selection of its text.
  /** @param {import('react').MouseEvent<HTMLDivElement>} event */
  const handleCardClick = (event) => {
    const target = /** @type {Element} */ (event.target);
    const selection = window.getSelection();
    if (
      target.closest('a, button, input, select, textarea, label, .metadata-list, .inline-issues') ||
      (selection && !selection.isCollapsed && event.currentTarget.contains(selection.anchorNode))
    ) {
      return;
    }
    handleToggleRowDetails();
  };

  const handleDownload = () => {
    triggerFileDownload(downloadUrl, row.node.name).catch((error) => {
      onDownloadError?.({ url: downloadUrl, ...(error && typeof error === 'object' ? error : {}) });
    });
  };

  return (
    <Container
      id={`row-${row.id}`}
      ref={containerRef}
      className={containerClassName}
      style={{ ...buildTreeDepthStyle(row.depth), ...virtualStyle }}
    >
      {row.depth || hasVisibleChildren ? (
        <div className="tree-guides" aria-hidden="true">
          {row.depth ? (
            <span
              className={`tree-guide-parent${row.isLastSibling ? '' : ' tree-guide-parent-continue'}`}
              style={buildTreeGuideStyle(row.depth - 1)}
            />
          ) : null}
          {row.depth ? <span className="tree-guide-elbow" style={buildTreeGuideStyle(row.depth)} /> : null}
          {hasVisibleChildren ? (
            <span className="tree-guide-child" style={buildTreeGuideStyle(row.depth)} />
          ) : null}
        </div>
      ) : null}
      <div className="tree-row">
        {showCollapseControl ? (
          <button
            type="button"
            className="collapse-button"
            onClick={handleToggleRowCollapsed}
          >
            {collapsed ? '+' : '-'}
          </button>
        ) : (
          <span className="collapse-spacer" aria-hidden="true">
            <span className="leaf-marker" />
          </span>
        )}
        <div className={isArchive ? 'tree-card archive-surface' : 'tree-card'} onClick={phone ? handleCardClick : undefined}>
          <div className="tree-heading">
            <div className="tree-title-row">
              {phone ? null : <span className={badgeClassName}>{badge}</span>}
              {dbId && !phone ? <span className="db-chip" title={dbId}>{dbId}</span> : null}
              <button
                type="button"
                className="copy-link-button"
                onClick={() => onAnchorRow(row.id)}
              >
                <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="m7.775 3.275 1.25-1.25a3.5 3.5 0 1 1 4.95 4.95l-2.5 2.5a3.5 3.5 0 0 1-4.95 0 .751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018 1.998 1.998 0 0 0 2.83 0l2.5-2.5a2.002 2.002 0 0 0-2.83-2.83l-1.25 1.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042Zm-4.69 9.64a1.998 1.998 0 0 0 2.83 0l1.25-1.25a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042l-1.25 1.25a3.5 3.5 0 1 1-4.95-4.95l2.5-2.5a3.5 3.5 0 0 1 4.95 0 .751.751 0 0 1-.018 1.042.751.751 0 0 1-1.042.018 1.998 1.998 0 0 0-2.83 0l-2.5 2.5a1.998 1.998 0 0 0 0 2.83Z"/></svg>
              </button>
              <h3 onMouseEnter={(e) => {
                const h3 = e.currentTarget;
                const heading = /** @type {HTMLElement} */ (h3.closest('.tree-heading'));
                // On a phone a tap shows the details, with the full name and path: no tooltip.
                if (phone) {
                  heading.classList.add('tooltip-hidden');
                  return;
                }
                const titleRow = h3.closest('.tree-title-row');
                const nameTruncated = h3.scrollWidth > h3.clientWidth;
                const idCode = titleRow.querySelector('.tree-identifier-inline code');
                const pathTruncated = idCode ? idCode.scrollWidth > idCode.clientWidth : false;
                heading.classList.toggle('tooltip-hidden', !nameTruncated && !pathTruncated);
                heading.classList.toggle('tooltip-name-hidden', !nameTruncated && pathTruncated);
                if (nameTruncated || pathTruncated) {
                  const rect = heading.getBoundingClientRect();
                  heading.style.setProperty('--tooltip-x', `${e.clientX - rect.left}px`);
                  updateTooltipPlacement(heading, rect);
                }
              }}>{title}</h3>
              {showIdentifier && !nameOnly ? (
                <span className="tree-identifier-inline">
                  {phone ? null : <span className="tree-identifier-label">{identifierLabel}</span>}
                  <code>{identifier}</code>
                </span>
              ) : null}
            </div>
            <div className={nameOnly ? 'tree-heading-actions tree-heading-actions-keyboard' : 'tree-heading-actions'}>
              <div className="node-action-row">
                <button
                  type="button"
                  className={phone ? 'inline-action-button tree-details-toggle-keyboard' : 'inline-action-button'}
                  onClick={handleToggleRowDetails}
                >
                  {detailsVisible ? 'Hide details' : 'Show details'}
                </button>
                {dbId && phone && !nameOnly ? <span className="db-chip" title={dbId}>{dbId}</span> : null}
                {!nameOnly && (openUrl || viewUrl || downloadUrl) ? (
                  <div className="node-download-actions">
                    {viewUrl ? (
                      <button
                        type="button"
                        className="inline-action-button open-button"
                        onClick={() => onViewImage?.({ name: row.node.name, url: viewUrl })}
                      >
                        VIEW
                      </button>
                    ) : null}
                    {openUrl ? (
                      <a
                        className="inline-action-button open-button"
                        href={openUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        OPEN
                      </a>
                    ) : null}
                    {downloadUrl ? (
                      <button
                        type="button"
                        className="download-button"
                        onClick={handleDownload}
                      >
                        Download
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
            <span className="tree-title-tooltip">
              <span>{title}</span>
              {showIdentifier ? (
                <span className="tree-title-tooltip-path">
                  <span className="tree-identifier-label">{identifierLabel}</span>
                  {' '}
                  <code>{identifier}</code>
                </span>
              ) : null}
            </span>
          </div>
          {!bodyCollapsed && !tagsHidden ? (
            <PrimaryFieldRow fields={primaryFields} tagView={tagView} tagsShown={tagsShown} onToggleTags={() => onToggleTags?.(row.id)} />
          ) : null}
          {!bodyCollapsed && detailsVisible ? <MetadataList fields={details} /> : null}
          {issues.length ? (
            <ul className="inline-issues">
              {issues.map((issue) => (
                <li key={issue.id} className={`issue issue-${issue.level}`}>
                  <span className="issue-level">{issue.level}</span>
                  <span>{issue.message}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {isArchive && !collapsed && !childIds.length ? (
            <div className="archive-empty-inline">
              <EmptyState message="No summary entries could be rendered for this archive." />
            </div>
          ) : null}
        </div>
      </div>
    </Container>
  );
});

export default TreeEntryRow;
