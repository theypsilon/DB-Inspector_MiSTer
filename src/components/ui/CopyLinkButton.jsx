import { useState } from 'react';

function CopyLinkButton({ url, tooltip }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      });
    }
  };

  return (
    <button
      type="button"
      className={`copy-link-button-icon${copied ? ' copy-link-button-copied' : ''}`}
      onClick={handleCopy}
      aria-label={tooltip}
    >
      <span className="copy-link-button-svg" aria-hidden="true">
        {copied ? (
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3.5 8.5 6.5 11.5 12.5 4.5" />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
            <path d="M10.5 5.5V3.5a1.5 1.5 0 0 0-1.5-1.5H3.5A1.5 1.5 0 0 0 2 3.5V9a1.5 1.5 0 0 0 1.5 1.5h2" />
          </svg>
        )}
      </span>
      <span className="copy-link-button-tooltip">
        {copied ? 'Copied!' : tooltip}
      </span>
    </button>
  );
}

export default CopyLinkButton;
