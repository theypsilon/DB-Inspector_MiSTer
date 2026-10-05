import { useLayoutEffect, useRef } from 'react';
import { TAG_FIT_SAMPLE, sameTagFitMetrics, tagFitMetrics } from '../../lib/tagFit.js';

/** @param {Element} element */
const box = (element) => element.getBoundingClientRect();

// A hidden row at the top of a tree list, shaped like a file's, that the list's rows fit their
// tags with (see tagFit.js): its tag line, one indentation step, and sample tags. It reports the
// widths as it mounts, before the page is drawn, and again when the list's width or the tags' font
// changes (a resized window, the web font arriving), and nothing while there is no layout (a
// closed section). It is not a `.tree-entry`, so nothing that looks for rows finds it.
/** @param {{ onMeasure: (metrics: import('../../lib/tagFit.js').TagFitMetrics) => void }} props */
export default function TagFitProbe({ onMeasure }) {
  const probeRef = useRef(null);
  const measuredRef = useRef(null);

  useLayoutEffect(() => {
    const probe = probeRef.current;
    const part = (name) => probe.querySelector(`[data-tag-fit="${name}"]`);
    const measure = () => {
      const next = tagFitMetrics({
        line: box(part('line')),
        indent: box(part('indent')),
        emptyChip: box(part('empty-chip')),
        sampleChip: box(part('sample-chip')),
        emptyToggle: box(part('empty-toggle')),
        sampleToggle: box(part('sample-toggle')),
      });
      if (next && !sameTagFitMetrics(measuredRef.current, next)) {
        measuredRef.current = next;
        onMeasure(next);
      }
    };

    measure();
    if (typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    const observer = new ResizeObserver(measure);
    for (const name of ['line', 'indent', 'sample-chip', 'sample-toggle']) {
      observer.observe(part(name));
    }
    return () => {
      observer.disconnect();
    };
  }, [onMeasure]);

  return (
    <div ref={probeRef} className="tag-fit-probe" aria-hidden="true" inert>
      <div className="tree-row">
        <span className="collapse-spacer" />
        <div className="tree-card">
          <div className="primary-row" data-tag-fit="line">
            <div className="primary-tags">
              <div className="tag-chip-list tag-fit-sample">
                <span className="tag-chip" data-tag-fit="empty-chip" />
                <span className="tag-chip" data-tag-fit="sample-chip">{TAG_FIT_SAMPLE}</span>
                <button type="button" tabIndex={-1} className="tag-chip-toggle" data-tag-fit="empty-toggle" />
                <button type="button" tabIndex={-1} className="tag-chip-toggle" data-tag-fit="sample-toggle">{TAG_FIT_SAMPLE}</button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <span className="tag-fit-indent" data-tag-fit="indent" />
    </div>
  );
}
