import "@testing-library/jest-dom/vitest";

/**
 * jsdom doesn't implement matchMedia — framer-motion's useReducedMotion and
 * canvas-confetti's reduced-motion check both call it directly. Without
 * this, any component using either throws in every test.
 */
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

/**
 * jsdom doesn't implement IntersectionObserver — framer-motion's
 * whileInView (used by the Reveal component wrapping several dashboard
 * sections) needs it to exist, even though it never actually observes
 * anything meaningful in a test environment.
 */
class MockIntersectionObserver implements IntersectionObserver {
  readonly root: Element | Document | null = null;
  readonly rootMargin: string = "";
  readonly thresholds: ReadonlyArray<number> = [];
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}
window.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver;

/** jsdom doesn't implement ResizeObserver either — recharts (dashboard
 * charts) relies on it for responsive sizing. */
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
