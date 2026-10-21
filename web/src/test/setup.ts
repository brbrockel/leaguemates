import { configure } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// jsdom has no matchMedia; the theme code asks for prefers-color-scheme.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

// The service worker isn't registered in tests.
vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [false, () => {}],
    offlineReady: [false, () => {}],
    updateServiceWorker: async () => {},
  }),
}));

afterEach(() => {
  cleanup();
  // Each test starts with nothing kept on the device (e.g. unsaved scorecard edits).
  localStorage.clear();
  vi.restoreAllMocks();
});

// findBy*/waitFor default to 1s, which is tight when the whole workspace tests in parallel.
configure({ asyncUtilTimeout: 3000 });
