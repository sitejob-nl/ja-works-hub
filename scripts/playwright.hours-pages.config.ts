import { defineConfig } from '@playwright/test';

// Dedicated connected page-assignment QA: never inherit an old login, trace,
// HAR or video. The caller starts a local server against the verified demo tenant.
export default defineConfig({
  testDir: './',
  testMatch: 'e2e-hours-pages-demo.spec.ts',
  timeout: 480_000,
  expect: { timeout: 20_000 },
  retries: 0,
  workers: 1,
  reporter: [['list']],
  outputDir: process.env.HOURS_PAGES_EVIDENCE_DIR
    ? `${process.env.HOURS_PAGES_EVIDENCE_DIR}/playwright-output`
    : '../test-results/hours-pages',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8087',
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
