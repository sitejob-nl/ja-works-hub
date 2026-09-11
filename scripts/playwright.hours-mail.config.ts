import { defineConfig } from '@playwright/test';

// Dedicated connected mail-intake QA: never inherit an old login, trace, HAR or
// video. The caller starts a local server against the verified demo tenant on a
// port of its own, so a parallel session's dev server is never tested by mistake.
export default defineConfig({
  testDir: './',
  testMatch: 'e2e-hours-mail-demo.spec.ts',
  timeout: 900_000,
  expect: { timeout: 30_000 },
  retries: 0,
  workers: 1,
  reporter: [['list']],
  outputDir: process.env.HOURS_MAIL_EVIDENCE_DIR
    ? `${process.env.HOURS_MAIL_EVIDENCE_DIR}/playwright-output`
    : '../test-results/hours-mail',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8096',
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
