import { useState, useRef, useEffect } from 'react';
import { isFileDragEvent } from '../lib/utils.js';
import { captureDrop } from '../lib/uploads.js';

const DROP_PULSE_DURATION_MS = 560;

// Drag-and-drop state for the upload card: highlighted while files hover over it, and a short
// pulse after a drop. What was dropped (see captureDrop) is handed to `onDrop`.
function useFileDropzone(onDrop) {
  const dragDepthRef = useRef(0);
  const dropPulseTimeoutRef = useRef(0);
  const [isDragActive, setIsDragActive] = useState(false);
  const [isDropPulseActive, setIsDropPulseActive] = useState(false);

  useEffect(
    () => () => {
      if (dropPulseTimeoutRef.current) {
        window.clearTimeout(dropPulseTimeoutRef.current);
      }
    },
    [],
  );

  function triggerDropPulse() {
    setIsDropPulseActive(false);

    window.requestAnimationFrame(() => {
      setIsDropPulseActive(true);
    });

    if (dropPulseTimeoutRef.current) {
      window.clearTimeout(dropPulseTimeoutRef.current);
    }

    dropPulseTimeoutRef.current = window.setTimeout(() => {
      setIsDropPulseActive(false);
      dropPulseTimeoutRef.current = 0;
    }, DROP_PULSE_DURATION_MS);
  }

  function handleDragEnter(event) {
    if (!isFileDragEvent(event)) {
      return;
    }

    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDragActive(true);
  }

  function handleDragOver(event) {
    if (!isFileDragEvent(event)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';

    if (!isDragActive) {
      setIsDragActive(true);
    }
  }

  function handleDragLeave(event) {
    if (!isFileDragEvent(event)) {
      return;
    }

    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);

    if (dragDepthRef.current === 0) {
      setIsDragActive(false);
    }
  }

  function handleDrop(event) {
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDragActive(false);

    if (isFileDragEvent(event)) {
      triggerDropPulse();
    }

    void onDrop(captureDrop(event.dataTransfer));
  }

  return {
    isDragActive,
    isDropPulseActive,
    dropzoneProps: {
      onDragEnter: handleDragEnter,
      onDragOver: handleDragOver,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop,
    },
  };
}

export default useFileDropzone;
