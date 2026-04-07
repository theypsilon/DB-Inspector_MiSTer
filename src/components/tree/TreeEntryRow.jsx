import { memo, useRef, useMemo, useLayoutEffect } from 'react';
import PrimaryFieldRow from '../ui/PrimaryFieldRow.jsx';
import MetadataList from '../ui/MetadataList.jsx';
import EmptyState from '../ui/EmptyState.jsx';
import { isBrowserOpenableFile, triggerFileDownload, buildVirtualRowStyle, buildTreeDepthStyle, buildTreeGuideStyle, getRowMeasurementKey } from '../../lib/utils.js';

const TreeEntryRow = memo(function TreeEntryRow({
  row,
  collapsed,
  detailsVisible,
  highlighted,
  onToggleCollapsed,
  onToggleDetails,
  onSetRowState,
  onAnchorRow,
  onDownloadError,
  onHeightChange,
  virtualTop,
  trimTopGuide,
  trimBottomGuide,
}) {
  if (__VIRTUALIZE__) {
    /* eslint-disable react-hooks/rules-of-hooks -- __VIRTUALIZE__ is a build-time constant */
    var rowRef = useRef(null);
    var previousMeasurementSignatureRef = useRef(null);
    var virtualStyle = useMemo(
      () =>
        buildVirtualRowStyle(virtualTop, {
          trimTopGuide,
          trimBottomGuide,
        }),
      [trimBottomGuide, trimTopGuide, virtualTop],
    );
    /* eslint-enable react-hooks/rules-of-hooks */
  }
  const isArchive = row.type === 'archive';
  const childIds = row.childIds;
  const showCollapseControl = isArchive || childIds.length > 0;
  const title = isArchive ? row.archive.title : row.node.name;
  const badge = isArchive ? 'ZIP' : row.node.badge;
  const badgeClassName = isArchive
    ? 'node-badge archive-badge'
    : `node-badge ${row.node.kind === 'file' ? 'file-badge' : 'folder-badge'}`;
  const identifier = isArchive ? row.archive.id : row.node.path;
  const identifierLabel = isArchive ? 'Archive' : 'Path';
  const showIdentifier = isArchive || identifier !== title;
  const titleTooltip = showIdentifier ? `${title}\n${identifierLabel}: ${identifier}` : title;
  const primaryFields = isArchive ? row.archive.primaryFields : row.node.primaryFields;
  const details = isArchive ? row.archive.details : row.node.details;
  const issues = isArchive ? row.archive.issues : [];
  const isFile = !isArchive && row.node.kind === 'file';
  const downloadUrl = isFile ? row.node.downloadUrl : null;
  const openUrl = isFile && isBrowserOpenableFile(row.node.path) ? downloadUrl : null;
  const bodyCollapsed = isFile && collapsed;
  const hasVisibleChildren = childIds.length > 0 && !collapsed;
  const containerClassName = [
    'tree-entry',
    row.depth ? 'tree-entry-indented' : '',
    isArchive ? 'archive-card' : '',
    highlighted ? 'tree-entry-highlighted' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const Container = isArchive ? 'article' : 'div';

  if (__VIRTUALIZE__) {
    /* eslint-disable react-hooks/rules-of-hooks -- __VIRTUALIZE__ is a build-time constant */
    useLayoutEffect(() => {
      const element = rowRef.current;
      if (!element) {
        return undefined;
      }

      const measurementSignature = `${collapsed ? '1' : '0'}:${detailsVisible ? '1' : '0'}`;
      const measurementKey = getRowMeasurementKey(row.id, { collapsed, detailsVisible });
      const previousMeasurementSignature = previousMeasurementSignatureRef.current;
      const shouldFlushImmediately =
        previousMeasurementSignature !== null && previousMeasurementSignature !== measurementSignature;
      previousMeasurementSignatureRef.current = measurementSignature;

      const reportHeight = (immediate = false) => {
        onHeightChange(measurementKey, Math.ceil(element.getBoundingClientRect().height), { immediate });
      };

      reportHeight(shouldFlushImmediately);

      if (typeof ResizeObserver === 'undefined') {
        return undefined;
      }

      const observer = new ResizeObserver(() => {
        reportHeight();
      });
      observer.observe(element);
      return () => {
        observer.disconnect();
      };
    }, [row.id, collapsed, detailsVisible, onHeightChange]);
    /* eslint-enable react-hooks/rules-of-hooks */
  }

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

  const handleDownload = () => {
    triggerFileDownload(downloadUrl, row.node.name).catch((error) => {
      onDownloadError?.({ url: downloadUrl, ...(error && typeof error === 'object' ? error : {}) });
    });
  };

  return (
    <Container
      id={`row-${row.id}`}
      ref={__VIRTUALIZE__ ? rowRef : undefined}
      className={containerClassName}
      style={__VIRTUALIZE__ ? { ...buildTreeDepthStyle(row.depth), ...virtualStyle } : buildTreeDepthStyle(row.depth)}
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
        <div className={isArchive ? 'tree-card archive-surface' : 'tree-card'}>
          <div className="tree-heading">
            <div className="tree-title-row">
              <span className={badgeClassName}>{badge}</span>
              <button
                type="button"
                className="copy-link-button"
                onClick={() => onAnchorRow(row.id)}
              >
                <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="m7.775 3.275 1.25-1.25a3.5 3.5 0 1 1 4.95 4.95l-2.5 2.5a3.5 3.5 0 0 1-4.95 0 .751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018 1.998 1.998 0 0 0 2.83 0l2.5-2.5a2.002 2.002 0 0 0-2.83-2.83l-1.25 1.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042Zm-4.69 9.64a1.998 1.998 0 0 0 2.83 0l1.25-1.25a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042l-1.25 1.25a3.5 3.5 0 1 1-4.95-4.95l2.5-2.5a3.5 3.5 0 0 1 4.95 0 .751.751 0 0 1-.018 1.042.751.751 0 0 1-1.042.018 1.998 1.998 0 0 0-2.83 0l-2.5 2.5a1.998 1.998 0 0 0 0 2.83Z"/></svg>
              </button>
              <h3 onMouseEnter={(e) => {
                const h3 = e.currentTarget;
                const heading = h3.closest('.tree-heading');
                const row = h3.closest('.tree-title-row');
                const nameTruncated = h3.scrollWidth > h3.clientWidth;
                const idCode = row.querySelector('.tree-identifier-inline code');
                const pathTruncated = idCode ? idCode.scrollWidth > idCode.clientWidth : false;
                heading.classList.toggle('tooltip-hidden', !nameTruncated && !pathTruncated);
                heading.classList.toggle('tooltip-name-hidden', !nameTruncated && pathTruncated);
                if (nameTruncated || pathTruncated) {
                  const rect = heading.getBoundingClientRect();
                  heading.style.setProperty('--tooltip-x', `${e.clientX - rect.left}px`);
                  heading.classList.toggle('tooltip-below', rect.top < 80);
                }
              }}>{title}</h3>
              {showIdentifier ? (
                <span className="tree-identifier-inline">
                  <span className="tree-identifier-label">{identifierLabel}</span>
                  <code>{identifier}</code>
                </span>
              ) : null}
            </div>
            <div className="tree-heading-actions">
              <div className="node-action-row">
                <button
                  type="button"
                  className="inline-action-button"
                  onClick={handleToggleRowDetails}
                >
                  {detailsVisible ? 'Hide details' : 'Show details'}
                </button>
                {openUrl || downloadUrl ? (
                  <div className="node-download-actions">
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
          {!bodyCollapsed ? <PrimaryFieldRow fields={primaryFields} /> : null}
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
