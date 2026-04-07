import { useState } from 'react';
import { strToU8, zipSync } from 'fflate';
import ModalFrame from './ModalFrame.jsx';
import CopyLinkButton from '../ui/CopyLinkButton.jsx';
import { triggerBrowserDownload } from '../../lib/utils.js';

export default function InstallModal({ dbId, dbUrl, activeFilter, onClose }) {
  const [includeFilter, setIncludeFilter] = useState(false);
  const trimmedFilter = String(activeFilter || '').trim();
  const hasFilter = trimmedFilter.length > 0;
  const iniFileName = `downloader_${dbId}.ini`;
  const installUrl = typeof window !== 'undefined'
    ? window.location.origin + window.location.pathname + window.location.search + '#install'
    : '';

  const handleDownload = () => {
    let content = `[${dbId}]\ndb_url=${dbUrl}\n`;
    if (includeFilter && hasFilter) {
      content += `filter=${trimmedFilter}\n`;
    }

    const zipped = zipSync({ [iniFileName]: strToU8(content) });
    const blob = new Blob([zipped], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    triggerBrowserDownload(url, `downloader_${dbId}.zip`);
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  return (
    <ModalFrame
      label="Install"
      title={`Install \u201C${dbId}\u201D on MiSTer`}
      onClose={onClose}
      headerActions={<CopyLinkButton url={installUrl} tooltip="Copy install link to clipboard" />}
    >
      <p className="helper-copy">
        To install this database on your MiSTer, download the ZIP below, extract{' '}
        <strong>{iniFileName}</strong>, and copy it to the root of your SD card. The next time MiSTer
        Downloader or Update All runs, it will pick up this database automatically.
      </p>
      {hasFilter ? (
        <label className="install-filter-option">
          <input
            type="checkbox"
            checked={includeFilter}
            onChange={(event) => setIncludeFilter(event.target.checked)}
          />
          <span>
            Include the current filter in the INI file: <code>{trimmedFilter}</code>
          </span>
        </label>
      ) : null}
      <div className="install-download-row">
        <button type="button" className="install-button" onClick={handleDownload}>
          Download {dbId} database
        </button>
      </div>
    </ModalFrame>
  );
}
