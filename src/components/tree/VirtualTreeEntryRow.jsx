import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import TreeEntryRow from './TreeEntryRow.jsx';
import { buildVirtualRowStyle, getRowMeasurementKey, rowTagsHidden } from '../../lib/treeLayout.js';
import { fitTagCount, getRowTags } from '../../lib/tagFit.js';

// A TreeEntryRow placed at its virtual offset, and drawn over its place in the list with its part
// of the list's outline (see rowOutline). It reports its rendered height so the list can replace
// the estimated height with the measured one. Keeping this apart from TreeEntryRow means
// a new `onHeightChange` (which changes as the page scrolls) re-measures the row without
// re-rendering its content. It counts the tags that fit on the row's line from the list's
// `tagFit` widths; when that count changes the row's height, its resize observer measures it again,
// as for any other change of width.
/**
 * @typedef {object} VirtualRowProps
 * @property {(rowId: string, height: number, options?: { immediate?: boolean }) => void} onHeightChange
 * @property {number} virtualTop
 * @property {number} virtualHeight
 * @property {boolean} topLine
 * @property {boolean} bottomLine
 * @property {string} corners
 * @property {boolean} [trimTopGuide]
 * @property {boolean} [trimBottomGuide]
 * @property {import('../../lib/tagFit.js').TagFitMetrics | null} [tagFit]
 * @property {import('../../lib/treeLayout.js').TreeScreen} [screen] the screen the row is laid out for
 */
const VirtualTreeEntryRow = memo(
  /** @param {VirtualRowProps & Omit<import('./TreeEntryRow.jsx').TreeEntryRowProps, 'containerRef' | 'virtualStyle'>} props */
  function VirtualTreeEntryRow({
  onHeightChange,
  virtualTop,
  virtualHeight,
  topLine,
  bottomLine,
  corners,
  trimTopGuide,
  trimBottomGuide,
  tagFit = null,
  screen = 'wide',
  ...rowProps
}) {
  const { row, collapsed, detailsVisible, tagsExpanded, tagsRevealed } = rowProps;
  const allTags = Boolean(tagsExpanded || tagsRevealed);
  const tagsHidden = rowTagsHidden(row, { narrow: screen !== 'wide', detailsVisible, tagsExpanded: allTags });
  const tags = getRowTags(row);
  const tagsShown = useMemo(() => fitTagCount(tags, tagFit, row.depth), [tags, tagFit, row.depth]);
  const rowRef = useRef(null);
  const previousMeasurementSignatureRef = useRef(null);
  const virtualStyle = useMemo(
    () =>
      buildVirtualRowStyle(virtualTop, {
        trimTopGuide,
        trimBottomGuide,
        height: virtualHeight,
        topLine,
        bottomLine,
        corners,
      }),
    [bottomLine, corners, topLine, trimBottomGuide, trimTopGuide, virtualHeight, virtualTop],
  );

  useLayoutEffect(() => {
    const element = rowRef.current;
    if (!element) {
      return undefined;
    }

    const measurementSignature = `${collapsed ? '1' : '0'}:${detailsVisible ? '1' : '0'}:${allTags ? '1' : '0'}:${screen}`;
    const measurementKey = getRowMeasurementKey(row.id, { collapsed, detailsVisible, tagsExpanded: allTags, screen });
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
  }, [row.id, collapsed, detailsVisible, allTags, screen, onHeightChange]);

  return (
    <TreeEntryRow
      {...rowProps}
      tagsShown={tagsShown}
      tagsHidden={tagsHidden}
      phone={screen === 'phone'}
      containerRef={rowRef}
      virtualStyle={virtualStyle}
    />
  );
});

export default VirtualTreeEntryRow;
