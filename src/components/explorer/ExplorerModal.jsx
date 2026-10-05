import { useEffect, useEffectEvent, useRef, useState } from 'react';
import ExplorerPath from './ExplorerPath.jsx';
import ExplorerItems from './ExplorerItems.jsx';
import ExplorerDetails from './ExplorerDetails.jsx';
import { BackIcon, CloseIcon, ForwardIcon, IconsViewIcon, ListViewIcon, UpIcon } from './ExplorerIcons.jsx';
import {
  EXPLORER_DETAILS_DELAY_MS,
  readExplorerView,
  resolveExplorerLocation,
  startExplorerHistory,
  stepExplorerHistory,
  storeExplorerView,
  visitExplorerFolder,
} from '../../lib/explorer.js';

/**
 * The explorer: the SD card the databases shown would install (see src/lib/explorer.js), one folder
 * at a time, as Windows' File Explorer shows a drive. A click selects an entry and shows its
 * details; a double click goes into a folder (a tap, on a touch screen). Back, Forward and Up move
 * through the folders, and the path goes to any folder above. The details wait out the time of a
 * double click before they come up, so a double click goes in without the list changing width (and
 * its icons moving) under it; once up, they show what is clicked at once.
 *
 * It keeps its own history of folders, so the browser's Back and Forward still move between what
 * the page has open. `onLocationChange` gets the path the page's link names: the folder shown, or
 * the file whose details are shown.
 * @param {{
 *   tree: import('../../lib/explorer.js').ExplorerFolder,
 *   initialPath: string,
 *   filtering: boolean,
 *   suspended?: boolean,
 *   onLocationChange: (path: string) => void,
 *   onClose: () => void,
 *   onDownloadError?: (error: any) => void,
 * }} props
 */
export default function ExplorerModal({ tree, initialPath, filtering, suspended = false, onLocationChange, onClose, onDownloadError }) {
  const [start] = useState(() => resolveExplorerLocation(tree, initialPath));
  const [history, setHistory] = useState(() => startExplorerHistory(start.folder.path));
  const [selectedPath, setSelectedPath] = useState(start.file?.path ?? null);
  const [detailsOpen, setDetailsOpen] = useState(Boolean(start.file));
  const [view, setView] = useState(readExplorerView);
  const listboxRef = useRef(null);
  const panelRef = useRef(null);
  // The details waiting for the double click time to pass, and whether they came up that way.
  const detailsTimerRef = useRef(0);
  const detailsFromClickRef = useRef(false);

  const { folder } = resolveExplorerLocation(tree, history.paths[history.index]);
  const entries = folder.children;
  const selectedIndex = selectedPath === null ? -1 : entries.findIndex((entry) => entry.path === selectedPath);
  const selected = selectedIndex >= 0 ? entries[selectedIndex] : null;
  const detailsEntry = selected ?? folder;
  const linkPath = detailsOpen && selected?.kind === 'file' ? selected.path : folder.path;

  useEffect(() => {
    onLocationChange(linkPath);
  }, [linkPath, onLocationChange]);

  // Each folder shown takes the focus, so the keyboard moves through it.
  useEffect(() => {
    (listboxRef.current ?? panelRef.current)?.focus({ preventScroll: true });
  }, [folder.path]);

  useEffect(() => {
    const timers = detailsTimerRef;
    return () => window.clearTimeout(timers.current);
  }, []);

  const cancelWaitingDetails = () => {
    window.clearTimeout(detailsTimerRef.current);
    detailsTimerRef.current = 0;
  };

  const showDetails = (entry) => {
    cancelWaitingDetails();
    detailsFromClickRef.current = false;
    setSelectedPath(entry.path);
    setDetailsOpen(true);
  };

  // Shows a folder. Going to a folder above the one shown selects the folder that leads back, as
  // Windows does.
  const show = (target) => {
    cancelWaitingDetails();
    let child = folder;
    while (child && child.parent !== target) {
      child = child.parent;
    }
    setSelectedPath(child ? child.path : null);
  };

  const openFolder = (target) => {
    setHistory((current) => visitExplorerFolder(current, target.path));
    show(target);
  };

  const goThroughHistory = (step) => {
    const next = stepExplorerHistory(history, step);
    if (next !== history) {
      setHistory(next);
      show(resolveExplorerLocation(tree, next.paths[next.index]).folder);
    }
  };

  const goUp = () => {
    if (folder.parent) {
      openFolder(folder.parent);
    }
  };

  const toggleView = () => {
    const next = view === 'list' ? 'icons' : 'list';
    setView(next);
    storeExplorerView(next);
  };

  const closeDetails = () => {
    cancelWaitingDetails();
    setDetailsOpen(false);
    (listboxRef.current ?? panelRef.current)?.focus({ preventScroll: true });
  };

  // On a touch screen, which has no double tap, a tap goes into a folder or shows a file's details.
  const handleClick = (entry, event) => {
    const pointerType = /** @type {PointerEvent} */ (event.nativeEvent).pointerType;
    if (pointerType === 'touch' || pointerType === 'pen') {
      if (entry.kind === 'folder') {
        openFolder(entry);
      } else {
        showDetails(entry);
      }
      return;
    }

    // The second click of a double click: the double click decides.
    if (event.detail > 1) {
      return;
    }

    setSelectedPath(entry.path);
    detailsFromClickRef.current = false;
    if (!detailsOpen) {
      cancelWaitingDetails();
      detailsTimerRef.current = window.setTimeout(() => {
        detailsTimerRef.current = 0;
        detailsFromClickRef.current = true;
        setDetailsOpen(true);
      }, EXPLORER_DETAILS_DELAY_MS);
    }
  };

  // Going in, or showing a file's details, ends the wait of the first click's details.
  const handleDoubleClick = (entry) => {
    const detailsFromFirstClick = detailsFromClickRef.current;
    detailsFromClickRef.current = false;
    if (entry.kind === 'file') {
      showDetails(entry);
      return;
    }

    // A double click slower than the details' wait let its first click's details come up: going
    // in takes them away again.
    if (detailsFromFirstClick) {
      setDetailsOpen(false);
    }
    openFolder(entry);
  };

  const handleKeyDown = useEffectEvent((event) => {
    if (suspended || event.defaultPrevented || event.target?.closest?.('[role="menu"]')) {
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      cancelWaitingDetails();
      if (detailsOpen) {
        closeDetails();
      } else {
        onClose();
      }
    } else if (event.altKey && !event.ctrlKey && !event.metaKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      if (event.key === 'ArrowUp') {
        goUp();
      } else {
        goThroughHistory(event.key === 'ArrowLeft' ? -1 : 1);
      }
    } else if (event.key === 'Backspace' && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      goUp();
    }
  });

  useEffect(() => {
    const listener = (event) => handleKeyDown(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  const parentName = folder.parent?.name;
  return (
    <div
      className="modal-overlay explorer-overlay"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section className="explorer-panel" role="dialog" aria-modal="true" aria-label="Explorer" ref={panelRef} tabIndex={-1}>
        <div className="explorer-bar">
          <div className="explorer-bar-buttons">
            <button type="button" className="explorer-icon-button" aria-label="Back" title="Back (Alt+←)" disabled={history.index === 0} onClick={() => goThroughHistory(-1)}>
              <BackIcon />
            </button>
            <button
              type="button"
              className="explorer-icon-button"
              aria-label="Forward"
              title="Forward (Alt+→)"
              disabled={history.index === history.paths.length - 1}
              onClick={() => goThroughHistory(1)}
            >
              <ForwardIcon />
            </button>
            <button
              type="button"
              className="explorer-icon-button"
              aria-label={parentName ? `Up to ${parentName}` : 'Up'}
              title={parentName ? `Up to ${parentName} (Alt+↑)` : 'Up (Alt+↑)'}
              disabled={!folder.parent}
              onClick={goUp}
            >
              <UpIcon />
            </button>
            <button
              type="button"
              className="explorer-icon-button explorer-view-toggle"
              aria-label={view === 'list' ? 'Show as icons' : 'Show as list'}
              title={view === 'list' ? 'Show as icons' : 'Show as list'}
              onClick={toggleView}
            >
              {view === 'list' ? <IconsViewIcon /> : <ListViewIcon />}
            </button>
          </div>
          <ExplorerPath key={folder.path} folder={folder} onOpen={openFolder} />
          <button type="button" className="explorer-icon-button explorer-close" aria-label="Close explorer" title="Close (Esc)" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <div className="explorer-main">
          {entries.length ? (
            <ExplorerItems
              entries={entries}
              folderPath={folder.path}
              view={view}
              detailsOpen={detailsOpen}
              label={`${folder.name} contents`}
              selectedIndex={selectedIndex}
              listboxRef={listboxRef}
              onSelect={(index) => setSelectedPath(entries[index].path)}
              onActivate={(entry) => (entry.kind === 'folder' ? openFolder(entry) : showDetails(entry))}
              onClickEntry={handleClick}
              onDoubleClickEntry={handleDoubleClick}
              onInfo={showDetails}
            />
          ) : (
            <p className="explorer-empty">
              {filtering ? 'Nothing in this folder is installed with the current filter.' : 'This folder is empty.'}
            </p>
          )}
          {/* The details stay in the page while closed, hidden, so they can slide in and out. */}
          <div className={detailsOpen ? 'explorer-details-slot is-open' : 'explorer-details-slot'} aria-hidden={detailsOpen ? undefined : true} inert={!detailsOpen}>
            <ExplorerDetails
              entry={detailsEntry}
              folder={folder}
              onClose={closeDetails}
              onOpenFolder={openFolder}
              onDownloadError={onDownloadError}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
