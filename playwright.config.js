import { defineConfig } from '@playwright/test';

// The dev server listens on the IPv6 loopback. Under WSL2 mirrored networking, connecting to a
// closed 127.0.0.1 port hangs for about two minutes instead of being refused, and Playwright
// does exactly that before every run to check whether the server is already up.
const BASE_URL = 'http://[::1]:4173';

export default defineConfig({
  testDir: './tests',
  // Unit tests use node:test and run with `npm run test:unit`.
  testIgnore: 'unit/**',
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
        command: 'npm run dev -- --host ::1 --port 4173 --strictPort',
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
});
