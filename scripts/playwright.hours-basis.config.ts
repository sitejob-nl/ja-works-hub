import { defineConfig } from '@playwright/test';

// Dedicated connected QA for the explicit matrix-basis replacement. Never inherit
// an old login, trace, HAR or video. The caller starts a local server on its own
// port against the verified demo tenant; PLAYWRIGHT_SKIP_WEBSERVER keeps this run
// from attaching to another session's dev server.
export default defineConfig({
  testDir: './',
  testMatch: 'e2e-hours-basis-demo.spec.ts',
  timeout: 600_000,
  expect: { timeout: 20_000 },
  retries: 0,
  workers: 1,
  reporter: [['list']],
  outputDir: process.env.HOURS_BASIS_EVIDENCE_DIR
    ? `${process.env.HOURS_BASIS_EVIDENCE_DIR}/playwright-output`
    : '../test-results/hours-basis',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8091',
    browserName: 'chromium',
    headless: process.env.HEADED !== '1',
    viewport: { width: 1440, height: 1100 },
    locale: 'nl-NL',
    timezoneId: 'Europe/Amsterdam',
    storageState: { cookies: [], origins: [] },
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
});
