import { useState } from 'react';

function describeDownloadError(error) {
  const reason = error?.reason;
  const status = error?.status;

  if (reason === 'http' && status === 401) {
    return { message: 'Authentication required. This file is not publicly accessible.', code: 401, copyable: true };
  }
  if (reason === 'http' && status === 403) {
    return { message: 'Access denied by the server. The file may require authentication.', code: 403, copyable: true };
  }
  if (reason === 'http' && status === 404) {
    return { message: 'File not found. It may have been moved or removed.', code: 404, copyable: false };
  }
  if (reason === 'http' && status === 408) {
    return { message: 'The request timed out. The server took too long to respond \u2014 try again later.', code: 408, copyable: false };
  }
  if (reason === 'http' && status === 410) {
    return { message: 'This file has been permanently removed.', code: 410, copyable: false };
  }
  if (reason === 'http' && status === 429) {
    return { message: 'Too many requests. Try again later.', code: 429, copyable: false };
  }
  if (reason === 'http' && status >= 500) {
    return { message: 'This is usually temporary \u2014 try again later.', code: status, copyable: false };
  }
  if (reason === 'http') {
    return { message: 'Unexpected server response.', code: status, copyable: false };
  }
  if (reason === 'html') {
    return { message: 'The server returned a web page instead of the file. The file may live inside a remote archive that does not support direct downloads.', code: null, copyable: true };
  }
  if (reason === 'network') {
    return { message: 'The request could not reach the server. The host may not allow browser downloads, or there may be a network issue.', code: null, copyable: true };
  }
  return { message: 'This file could not be downloaded directly in the browser.', code: null, copyable: true };
}

export default function DownloadErrorModal({ error, onClose }) {
  const [copied, setCopied] = useState(false);
  const url = error?.url || '';
  const fileName = error?.fileName || 'file';
  const { message, code, copyable } = describeDownloadError(error);

  const handleCopy = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      });
    }
  };

  return (
    <div
      className="modal-overlay"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="download-error-card" role="alertdialog" aria-label="Download error">
        <p className="section-label download-error-label">Download failed</p>
        <strong className="download-error-title">{fileName}</strong>
        <div className="download-error-text">
          <span>{code ? <><code className="download-error-code">{code}</code> </> : null}{message}</span>
          {copyable ? <span>You can copy the URL and try it in another tab or tool.</span> : null}
        </div>
        <div className="download-error-footer">
          {copyable ? (
            <button type="button" className="copy-url-button" onClick={handleCopy}>
              {copied ? 'Copied' : 'Copy URL'}
            </button>
          ) : null}
          <button type="button" className="download-error-dismiss" onClick={onClose}>
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
