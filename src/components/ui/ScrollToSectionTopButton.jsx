import { useState, useEffect } from 'react';

function ScrollToSectionTopButton({ anchor }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const update = () => {
      const section = document.getElementById(`section-${anchor}`);
      if (!section) { setVisible(false); return; }
      const rect = section.getBoundingClientRect();
      setVisible(rect.top < -120 && rect.height > window.innerHeight);
    };

    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update, { passive: true });
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [anchor]);

  if (!visible) return null;

  return (
    <div className="scroll-to-section-top-track">
      <button
        type="button"
        className="scroll-to-section-top"
        aria-label="Scroll to top of section"
        onClick={() => {
          document.getElementById(`section-${anchor}`)?.scrollIntoView({ block: 'start' });
        }}
      >
        <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor">
          <path d="M3.22 9.78a.749.749 0 0 1 0-1.06l4.25-4.25a.749.749 0 0 1 1.06 0l4.25 4.25a.749.749 0 1 1-1.06 1.06L8 6.06 4.28 9.78a.749.749 0 0 1-1.06 0Z" />
        </svg>
      </button>
    </div>
  );
}

export default ScrollToSectionTopButton;
