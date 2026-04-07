import { useState, useEffect } from 'react';

function useWindowViewport() {
  const [viewport, setViewport] = useState(() => ({
    scrollY: typeof window === 'undefined' ? 0 : window.scrollY,
    height: typeof window === 'undefined' ? 0 : window.innerHeight,
    layoutVersion: 0,
  }));

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    let frameId = 0;
    let resizeObserver = null;
    let pendingForce = false;

    const updateViewport = () => {
      const force = pendingForce;
      frameId = 0;
      pendingForce = false;
      setViewport((current) => {
        const next = {
          scrollY: window.scrollY,
          height: window.innerHeight,
          layoutVersion: force ? current.layoutVersion + 1 : current.layoutVersion,
        };

        if (
          current.scrollY === next.scrollY &&
          current.height === next.height &&
          current.layoutVersion === next.layoutVersion
        ) {
          return current;
        }

        return next;
      });
    };

    const scheduleUpdate = (force = false) => {
      if (force) {
        pendingForce = true;
      }

      if (!frameId) {
        frameId = window.requestAnimationFrame(updateViewport);
      }
    };

    const handleToggle = () => {
      scheduleUpdate(true);
    };

    scheduleUpdate();
    window.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('resize', scheduleUpdate);
    document.addEventListener('toggle', handleToggle, true);

    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        scheduleUpdate(true);
      });
      resizeObserver.observe(document.body);
      resizeObserver.observe(document.documentElement);
    }

    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }

      window.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('resize', scheduleUpdate);
      document.removeEventListener('toggle', handleToggle, true);
      resizeObserver?.disconnect();
    };
  }, []);

  return viewport;
}

export default useWindowViewport;
