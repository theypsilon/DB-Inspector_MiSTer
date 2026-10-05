import { useId, useState } from 'react';
import { strToU8, zipSync } from 'fflate';
import ModalFrame from './ModalFrame.jsx';
import CopyLinkButton from '../ui/CopyLinkButton.jsx';
import { triggerBrowserDownload } from '../../lib/downloads.js';
import { INSTALL_ALL_ANCHOR, buildDownloaderIni, hasInstallFilters } from '../../lib/downloaderIni.js';
import { buildLinkUrl } from '../../lib/urlState.js';

/**
 * The install dialog of every loaded database at once, which no button opens: install_all() in
 * the browser's console does, and so does its link. Its ZIP holds a downloader.ini that lists them
 * all, and the file is shown as it would be downloaded.
 * @param {{
 *   installable: { dbId: string, dbUrl: string }[],
 *   leftOut: string[],
 *   filters: { shared: { isSet: boolean, value: string }, overrides: Record<string, string> },
 *   onClose: () => void,
 * }} props
 */
export default function InstallAllModal({ installable, leftOut, filters, onClose }) {
  const [includeFilters, setIncludeFilters] = useState(false);
  const iniLabelId = useId();
  const withFilters = hasInstallFilters(installable, filters);
  const ini = buildDownloaderIni(installable, includeFilters && withFilters ? filters : null);
  const these = installable.length === 1 ? 'this database' : `these ${installable.length} databases`;

  const handleDownload = () => {
    const zipped = zipSync({ 'downloader.ini': strToU8(ini) });
    const url = URL.createObjectURL(new Blob([zipped], { type: 'application/zip' }));
    triggerBrowserDownload(url, 'downloader.zip');
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  return (
    <ModalFrame
      label="Install"
      title="Install all loaded databases on MiSTer"
      onClose={onClose}
      headerActions={<CopyLinkButton url={buildLinkUrl({ at: INSTALL_ALL_ANCHOR })} tooltip="Copy install link to clipboard" />}
    >
      {installable.length ? (
        <p className="helper-copy">
          To install {these} on your MiSTer, download the ZIP below, extract <strong>downloader.ini</strong>, and
          copy it to the root of your SD card in place of the one there. It lists {these} and no others.
        </p>
      ) : (
        <p className="helper-copy">None of the loaded databases can be installed.</p>
      )}
      {leftOut.length ? (
        <p className="helper-copy">
          Left out, since uploaded databases have no URL to install from:{' '}
          {leftOut.map((dbId, index) => (
            <span key={dbId}>
              {index ? ', ' : null}
              <code>{dbId}</code>
            </span>
          ))}
          .
        </p>
      ) : null}
      {installable.length ? (
        <>
          {withFilters ? (
            <label className="install-filter-option">
              <input type="checkbox" checked={includeFilters} onChange={(event) => setIncludeFilters(event.target.checked)} />
              <span>Include the current filters in the INI file</span>
            </label>
          ) : null}
          <div className="install-download-row">
            <button type="button" className="install-button" onClick={handleDownload}>
              Download downloader.ini
            </button>
          </div>
          <figure className="install-ini" aria-labelledby={iniLabelId}>
            <figcaption id={iniLabelId} className="section-label">downloader.ini</figcaption>
            <pre>{ini}</pre>
          </figure>
        </>
      ) : null}
    </ModalFrame>
  );
}
