import { defineConfig } from '@playwright/test';

// The journeys run the production build, as GitHub Pages serves it: built into a folder of its own
// and served by `vite preview`, afresh for every run, so a server already listening never stands in
// for the code under test. It listens on the IPv6 loopback: under WSL2 mirrored networking,
// connecting to a closed 127.0.0.1 port hangs for about two minutes instead of being refused, and
// Playwright does exactly that before every run to check whether the server is already up.
const BASE_URL = 'http://[::1]:4173';
const BUILD_DIR = 'node_modules/.journeys-build';
// The build writes to a log, shown only when it fails: its CSS optimizer warns about every
// ::highlight rule, which it does not know (docs/design.md, 14).
const BUILD = `npm run build -- --outDir ${BUILD_DIR} --emptyOutDir > ${BUILD_DIR}.log 2>&1 || (cat ${BUILD_DIR}.log >&2; exit 1)`;

export default defineConfig({
  testDir: './tests',
  // Unit tests use node:test (`npm run test:unit`), and component tests Vitest (`npm run test:component`).
  testIgnore: ['unit/**', 'component/**'],
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: true,
  // The opt-in real-database scroll tests (REAL_SCROLL_URL) measure scroll timing, so they run alone.
  workers: process.env.REAL_SCROLL_URL ? 1 : 4,
  use: {
    baseURL: BASE_URL,
    browserName: 'chromium',
    headless: true,
    viewport: {
      width: 1440,
      height: 960,
    },
    launchOptions: {
      executablePath: '/usr/bin/google-chrome',
      args: ['--no-sandbox'],
    },
  },
  webServer: process.env.PLAYWRIGHT_NO_WEBSERVER
    ? undefined
    : {
        command: `${BUILD} && npm run preview -- --outDir ${BUILD_DIR} --host ::1 --port 4173 --strictPort`,
        url: BASE_URL,
        reuseExistingServer: false,
        timeout: 60_000,
      },
});
