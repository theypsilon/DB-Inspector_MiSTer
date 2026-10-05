import { formatBytes } from './database.js';

export const FILTER_INPUT_DEBOUNCE_MS = 600;
export const DEFAULT_CLUSTER_SIZE_BYTES = 128 * 1024;
// The hint next to the cluster size.
export const CLUSTER_SIZE_TIP =
  'SD cards over 32 GB are usually formatted with 128 KB clusters (exFAT default). ' +
  'Cards of 32 GB or smaller typically use 32 KB clusters (FAT32 default).';
export const CLUSTER_SIZE_OPTIONS = [4096, 8192, 16384, 32768, 65536, 131072, 262144, 524288, 1048576];
// Up to this many combined databases, the page shows each one in full: a card each, and the filter
// each one gets. With more, it lists them compactly.
export const COMBINED_DATABASES_IN_FULL_MAX = 3;
// Screens where tree rows stack their heading (app.css's 960px rule): there a file's tags are left to
// its details (see rowTagsHidden).
export const NARROW_SCREEN_QUERY = '(max-width: 960px)';
export const isTouchDevice = typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 0);

const TOOLTIP_FLIP_THRESHOLD_PX = 80;

export function buildFilterSummaryCopy(activeFilter) {
  if (!activeFilter) {
    return 'Showing the full database.';
  }

  if (activeFilter.hasError) {
    return 'The current filter is invalid, so the full database is shown.';
  }

  const { files, folders, archives } = activeFilter.resultCounts;
  if (!activeFilter.isFiltering) {
    return `Showing the full database: ${files} files, ${folders} folders, ${archives} archives.`;
  }

  return `Showing ${files} files, ${folders} folders, and ${archives} archives for this filter.`;
}

export function buildRawByteHoverCopy(storageSummary) {
  if (!storageSummary) {
    return '';
  }

  const suffix = storageSummary.unsizedFileCount
    ? ` ${storageSummary.unsizedFileCount.toLocaleString()} file${
        storageSummary.unsizedFileCount === 1 ? ' has' : 's have'
      } no declared size and ${storageSummary.unsizedFileCount === 1 ? 'is' : 'are'} excluded.`
    : '';

  return `Raw file sizes: ${formatBytes(storageSummary.rawBytes)}\n${storageSummary.rawBytes.toLocaleString()} bytes${suffix}`;
}

export function isFileDragEvent(event) {
  const types = Array.from(event.dataTransfer?.types ?? []);
  return types.includes('Files');
}

// Like Promise.allSettled over `task(item)` for each item, running at most `limit` tasks at a time.
// `onSettled` receives the number of tasks settled so far.
/**
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T) => Promise<R>} task
 * @param {(settledCount: number) => void} [onSettled]
 * @returns {Promise<PromiseSettledResult<R>[]>}
 */
export async function settleWithConcurrency(items, limit, task, onSettled = () => {}) {
  const results = new Array(items.length);
  let nextIndex = 0;
  let settledCount = 0;

  async function work() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = { status: 'fulfilled', value: await task(items[index]) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
      settledCount += 1;
      onSettled(settledCount);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, work));
  return results;
}

export function runAfterNextPaint(callback) {
  window.requestAnimationFrame(() => {
    window.setTimeout(() => {
      callback();
    }, 0);
  });
}

export function extractGitHubRepo(source) {
  const url = source.requestedUrl || source.sourceLabel;
  if (!url) return null;
  let match = url.match(/raw\.githubusercontent\.com\/([^/]+\/[^/]+)/);
  if (match) return match[1];
  match = url.match(/github\.com\/([^/]+\/[^/]+)/);
  if (match) return match[1].replace(/\.git$/, '');
  return null;
}

// Tooltips open above their anchor, and below it when the anchor is near the top of the viewport.
export function updateTooltipPlacement(element, rect = element.getBoundingClientRect()) {
  element.classList.toggle('tooltip-below', rect.top < TOOLTIP_FLIP_THRESHOLD_PX);
}

// Ranges for every occurrence of `query` (already lowercased) in the text under `root`, for
// CSS custom highlights. `firstMatchPerNode` keeps only the first occurrence in each text node.
export function collectTextMatchRanges(root, query, { firstMatchPerNode = false } = {}) {
  const ranges = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let textNode = walker.nextNode();
  while (textNode) {
    const text = textNode.textContent.toLowerCase();
    let position = 0;
    while (position < text.length) {
      const index = text.indexOf(query, position);
      if (index === -1) break;
      const range = new Range();
      range.setStart(textNode, index);
      range.setEnd(textNode, index + query.length);
      ranges.push(range);
      if (firstMatchPerNode) break;
      position = index + query.length;
    }
    textNode = walker.nextNode();
  }
  return ranges;
}

export function buildCombinedFilterSummaryCopy({ resultCounts, isFiltering, databases }) {
  const { files, folders, archives } = resultCounts;
  if (isFiltering) {
    return `Showing ${files} files, ${folders} folders, and ${archives} archives for these filters.`;
  }

  return `Showing all ${databases.length} databases: ${files} files, ${folders} folders, ${archives} archives.`;
}

// The line a source read through the release mirror adds to its details, or nothing.
/** @param {{ readThrough?: string | null } | null | undefined} source */
export function readThroughFields(source) {
  return source?.readThrough
    ? [{ label: 'Read through', value: `${source.readThrough}, since GitHub does not let websites read release downloads` }]
    : [];
}
