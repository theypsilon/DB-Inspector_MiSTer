import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import TreeEntryRow from './TreeEntryRow.jsx';
import { buildVirtualRowStyle, getRowMeasurementKey } from '../../lib/treeLayout.js';

// A TreeEntryRow placed at its virtual offset, and drawn over its place in the list with its part
// of the list's outline (see rowOutline). It reports its rendered height so the list can replace
// the estimated height with the measured one. Keeping this apart from TreeEntryRow means
// a new `onHeightChange` (which changes as the page scrolls) re-measures the row without
// re-rendering its content.
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
  ...rowProps
}) {
  const { row, collapsed, detailsVisible, tagsExpanded, tagsRevealed } = rowProps;
  const allTags = Boolean(tagsExpanded || tagsRevealed);
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

    const measurementSignature = `${collapsed ? '1' : '0'}:${detailsVisible ? '1' : '0'}:${allTags ? '1' : '0'}`;
    const measurementKey = getRowMeasurementKey(row.id, { collapsed, detailsVisible, tagsExpanded: allTags });
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
  }, [row.id, collapsed, detailsVisible, allTags, onHeightChange]);

  return <TreeEntryRow {...rowProps} containerRef={rowRef} virtualStyle={virtualStyle} />;
});

export default VirtualTreeEntryRow;
