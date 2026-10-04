import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom has no layout: scrolling and element resizing are no-ops here, and tests that care about
// them replace these stubs.
Element.prototype.scrollIntoView = function scrollIntoView() {};
Element.prototype.scrollTo = function scrollTo() {};
window.scrollTo = () => {};
window.scrollBy = () => {};
globalThis.ResizeObserver ??= class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};
window.matchMedia ??= (query) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} });

afterEach(() => {
  cleanup();
});
