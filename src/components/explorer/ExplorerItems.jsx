import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { EntryIcon, InfoIcon } from './ExplorerIcons.jsx';
import { explorerWindow, moveExplorerSelection, revealExplorerLine, splitNameEnd, splitTileName } from '../../lib/explorer.js';
import { formatBytes } from '../../lib/database.js';

// The sizes app.css gives rows and icons (--explorer-row-height and the rest), as they are before
// the list can read them, and where nothing lays the page out (tests).
const DEFAULT_SIZES = { rowHeight: 40, tileWidth: 124, tileHeight: 128 };

/**
 * A folder's contents, as a list or as icons, in a box of its own that scrolls. Every row (or row
 * of icons) has one height, set in app.css, so only those in view are rendered, placed by their
 * index; the selected one is scrolled into view when it changes.
 * @param {{
 *   entries: import('../../lib/explorer.js').ExplorerEntry[],
 *   folderPath: string,
 *   view: 'list' | 'icons',
 *   label: string,
 *   selectedIndex: number,
 *   listboxRef: import('react').RefObject<HTMLDivElement>,
 *   onSelect: (index: number) => void,
 *   onActivate: (entry: import('../../lib/explorer.js').ExplorerEntry) => void,
 *   onClickEntry: (entry: import('../../lib/explorer.js').ExplorerEntry, event: import('react').MouseEvent) => void,
 *   onDoubleClickEntry: (entry: import('../../lib/explorer.js').ExplorerEntry) => void,
 *   onInfo: (entry: import('../../lib/explorer.js').ExplorerEntry) => void,
 * }} props
 */
export default function ExplorerItems({
  entries,
  folderPath,
  view,
  label,
  selectedIndex,
  listboxRef,
  onSelect,
  onActivate,
  onClickEntry,
  onDoubleClickEntry,
  onInfo,
}) {
  const scrollRef = useRef(null);
  const [box, setBox] = useState({ width: 0, height: 0, ...DEFAULT_SIZES });
  const [scrollTop, setScrollTop] = useState(0);
  const tileName = useTileNameLines(listboxRef, view, box.width);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    const measure = () => {
      const style = getComputedStyle(element);
      const next = {
        width: element.clientWidth,
        height: element.clientHeight,
        rowHeight: readPixels(style, '--explorer-row-height', DEFAULT_SIZES.rowHeight),
        tileWidth: readPixels(style, '--explorer-tile-width', DEFAULT_SIZES.tileWidth),
        tileHeight: readPixels(style, '--explorer-tile-height', DEFAULT_SIZES.tileHeight),
      };
      setBox((current) => (Object.keys(next).every((key) => current[key] === next[key]) ? current : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const columns = view === 'icons' ? Math.max(1, Math.floor(box.width / box.tileWidth)) : 1;
  const lineHeight = view === 'icons' ? box.tileHeight : box.rowHeight;
  const lineCount = Math.ceil(entries.length / columns);

  // Another folder, or the other view, starts at the top.
  useLayoutEffect(() => {
    scrollRef.current.scrollTop = 0;
    setScrollTop(0);
  }, [folderPath, view]);

  // The selected entry comes into view: chosen with the keyboard, or the folder just left.
  useLayoutEffect(() => {
    if (selectedIndex < 0) {
      return;
    }

    const element = scrollRef.current;
    const top = revealExplorerLine({
      line: Math.floor(selectedIndex / columns),
      scrollTop: element.scrollTop,
      viewportHeight: box.height,
      lineHeight,
    });
    if (top !== null) {
      element.scrollTop = top;
      setScrollTop(element.scrollTop);
    }
  }, [selectedIndex, folderPath, view, columns, lineHeight, box.height]);

  const { start, end } = explorerWindow({ scrollTop, viewportHeight: box.height, lineHeight, lineCount });
  const selectedLine = selectedIndex >= 0 ? Math.floor(selectedIndex / columns) : -1;
  const handleKeyDown = (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }

    if (event.key === 'Enter') {
      if (selectedIndex >= 0) {
        event.preventDefault();
        onActivate(entries[selectedIndex]);
      }
      return;
    }

    const next = moveExplorerSelection(selectedIndex, event.key, entries.length, columns);
    if (next !== null) {
      event.preventDefault();
      onSelect(next);
    }
  };

  const renderEntry = (entry, index) => (
    <ExplorerEntry
      key={entry.path}
      entry={entry}
      index={index}
      count={entries.length}
      view={view}
      selected={index === selectedIndex}
      lines={view === 'icons' ? tileName(entry.name) : null}
      style={view === 'icons' ? undefined : { top: `${index * lineHeight}px` }}
      onClick={onClickEntry}
      onDoubleClick={onDoubleClickEntry}
      onInfo={onInfo}
    />
  );

  const lines = [];
  for (let line = start; line < end; line += 1) {
    if (view === 'icons') {
      lines.push(
        <div
          key={line}
          role="none"
          className="explorer-tile-row"
          style={{ top: `${line * lineHeight}px`, gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {entries.slice(line * columns, (line + 1) * columns).map((entry, column) => renderEntry(entry, line * columns + column))}
        </div>,
      );
    } else {
      lines.push(renderEntry(entries[line], line));
    }
  }

  return (
    <div className="explorer-items" ref={scrollRef} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
      <div
        ref={listboxRef}
        role="listbox"
        tabIndex={0}
        aria-label={label}
        aria-orientation={view === 'icons' ? 'horizontal' : 'vertical'}
        aria-activedescendant={selectedLine >= start && selectedLine < end ? entryId(selectedIndex) : undefined}
        className={view === 'icons' ? 'explorer-listbox explorer-icons' : 'explorer-listbox explorer-list'}
        style={{ height: `${lineCount * lineHeight}px` }}
        onKeyDown={handleKeyDown}
      >
        {lines}
      </div>
    </div>
  );
}

function entryId(index) {
  return `explorer-entry-${index}`;
}

function readPixels(style, name, fallback) {
  const value = Number.parseFloat(style.getPropertyValue(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

// A folder's size is what its files add up to; a file without a size shows none.
function entrySize(entry) {
  if (entry.kind === 'folder') {
    return entry.fileCount ? formatBytes(entry.sizeBytes) : '';
  }
  return entry.sizeBytes === null ? '' : formatBytes(entry.sizeBytes);
}

/**
 * @param {{
 *   entry: import('../../lib/explorer.js').ExplorerEntry,
 *   index: number,
 *   count: number,
 *   view: 'list' | 'icons',
 *   selected: boolean,
 *   lines: [string, string] | null,
 *   style?: import('react').CSSProperties,
 *   onClick: (entry: any, event: import('react').MouseEvent) => void,
 *   onDoubleClick: (entry: any) => void,
 *   onInfo: (entry: any) => void,
 * }} props
 */
function ExplorerEntry({ entry, index, count, view, selected, lines, style, onClick, onDoubleClick, onInfo }) {
  const isFolder = entry.kind === 'folder';
  const size = entrySize(entry);
  const versionCount = entry.kind === 'file' ? entry.versions.length : 0;
  const versions = versionCount > 1 ? `${versionCount} versions` : '';
  const description = [isFolder ? 'folder' : 'file', versions, size].filter(Boolean).join(', ');
  const className = [
    view === 'icons' ? 'explorer-tile' : 'explorer-row',
    isFolder ? 'is-folder' : 'is-file',
    selected ? 'is-selected' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      id={entryId(index)}
      role="option"
      aria-selected={selected}
      aria-label={`${entry.name}, ${description}`}
      aria-setsize={count}
      aria-posinset={index + 1}
      className={className}
      style={style}
      onClick={(event) => onClick(entry, event)}
      onDoubleClick={() => onDoubleClick(entry)}
    >
      <EntryIcon kind={entry.kind} large={view === 'icons'} />
      {view === 'icons' ? (
        <TileName name={entry.name} lines={lines} />
      ) : (
        <RowName name={entry.name} />
      )}
      {view === 'icons' ? (
        versions ? <span className="explorer-versions explorer-tile-versions">{versionCount}</span> : null
      ) : (
        <span className="explorer-meta">
          {versions ? <span className="explorer-versions">{versions}</span> : null}
          {size ? <span className="explorer-size">{size}</span> : null}
        </span>
      )}
      {isFolder ? (
        <button
          type="button"
          className="explorer-info-button"
          tabIndex={-1}
          aria-label={`Details of ${entry.name}`}
          onClick={(event) => {
            event.stopPropagation();
            onInfo(entry);
          }}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          <InfoIcon />
        </button>
      ) : null}
    </div>
  );
}

// A row's name gives way from its start, so its end stays (see splitNameEnd).
function RowName({ name }) {
  const { start, end } = splitNameEnd(name);
  return (
    <span className="explorer-name" title={name}>
      {start ? <span className="explorer-name-start">{start}</span> : null}
      <span className="explorer-name-end">{end}</span>
    </span>
  );
}

// An icon's name, in two lines when it has them; until they are known, two lines cut at the end.
function TileName({ name, lines }) {
  return lines ? (
    <span className="explorer-tile-name" title={name}>
      <span>{lines[0]}</span>
      {lines[1] ? <span>{lines[1]}</span> : null}
    </span>
  ) : (
    <span className="explorer-tile-name is-clamped" title={name}>{name}</span>
  );
}

// Measures text as the icons' names are drawn, once the page has laid one out.
let measureContext = null;
const tileLineCache = new Map();

function useTileNameLines(listboxRef, view, width) {
  const [text, setText] = useState(null);
  const [fontsLoaded, setFontsLoaded] = useState(0);

  useEffect(() => {
    let active = true;
    document.fonts?.ready.then(() => {
      if (active) setFontsLoaded((count) => count + 1);
    });
    return () => {
      active = false;
    };
  }, []);

  useLayoutEffect(() => {
    if (view !== 'icons') {
      return;
    }

    const sample = listboxRef.current?.querySelector('.explorer-tile-name');
    if (!sample) {
      return;
    }

    const style = getComputedStyle(sample);
    const next = { font: style.font, width: Math.floor(sample.getBoundingClientRect().width) - 1, fontsLoaded };
    setText((current) =>
      current && current.font === next.font && current.width === next.width && current.fontsLoaded === next.fontsLoaded ? current : next,
    );
  }, [listboxRef, view, width, fontsLoaded]);

  return (name) => {
    if (!text || !text.font || text.width <= 0 || typeof OffscreenCanvas === 'undefined') {
      return null;
    }

    const key = `${text.font}|${text.width}|${text.fontsLoaded}|${name}`;
    if (!tileLineCache.has(key)) {
      measureContext ??= new OffscreenCanvas(1, 1).getContext('2d');
      if (!measureContext) {
        return null;
      }
      measureContext.font = text.font;
      if (tileLineCache.size > 5000) {
        tileLineCache.clear();
      }
      tileLineCache.set(key, splitTileName(name, text.width, (part) => measureContext.measureText(part).width));
    }
    return tileLineCache.get(key);
  };
}
