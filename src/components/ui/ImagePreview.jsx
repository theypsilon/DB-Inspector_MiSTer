import { useState } from 'react';

/**
 * An image loaded from its URL, without a referrer: "Loading preview…" until it has loaded, and
 * "The preview could not be loaded." when it cannot. Each URL needs its own `key`, to load afresh.
 * @param {{ name: string, url: string, className: string }} props
 */
export default function ImagePreview({ name, url, className }) {
  // 'loading', then 'loaded' or 'failed'.
  const [status, setStatus] = useState('loading');
  return (
    <figure className={className}>
      {status === 'failed' ? (
        <figcaption>The preview could not be loaded.</figcaption>
      ) : (
        <img
          className={status === 'loading' ? 'hidden' : undefined}
          src={url}
          alt={`Preview of ${name}`}
          referrerPolicy="no-referrer"
          onLoad={() => setStatus('loaded')}
          onError={() => setStatus('failed')}
        />
      )}
      {status === 'loading' ? <figcaption>Loading preview…</figcaption> : null}
    </figure>
  );
}
