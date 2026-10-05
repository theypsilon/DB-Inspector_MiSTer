import { useEffect, useEffectEvent } from 'react';
import ModalFrame from './ModalFrame.jsx';
import ImagePreview from '../ui/ImagePreview.jsx';

/**
 * An image of a tree row, which its VIEW shows over the page: loaded only then, so the row keeps
 * its height. OPEN shows it in a new tab. Escape, Close or a click outside close it.
 * @param {{ name: string, url: string, onClose: () => void }} props
 */
export default function ImageViewerModal({ name, url, onClose }) {
  const handleKeyDown = useEffectEvent((event) => {
    if (event.key === 'Escape' && !event.defaultPrevented) {
      event.preventDefault();
      onClose();
    }
  });

  useEffect(() => {
    const listener = (event) => handleKeyDown(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  return (
    <ModalFrame
      label="View"
      title={name}
      className="image-viewer-panel"
      onClose={onClose}
      footer={
        <>
          <a className="inline-action-button open-button" href={url} target="_blank" rel="noreferrer">
            OPEN
          </a>
          <button type="button" className="secondary-button" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <ImagePreview key={url} className="image-viewer-preview" name={name} url={url} />
    </ModalFrame>
  );
}
