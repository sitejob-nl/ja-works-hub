import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './scripts', testMatch: 'qa-record-cleanup.spec.ts', workers: 1, retries: 0,
  timeout: 120_000, reporter: [['list']], outputDir: 'scripts/.qa/record-cleanup-artifacts',
  use: {
    baseURL: process.env.E2E_BASE_URL || 'https://ja-works-hub.vercel.app',
    headless: true, viewport: { width: 1440, height: 1200 }, serviceWorkers: 'block',
    trace: 'off', video: 'off', actionTimeout: 15_000,
  },
});
