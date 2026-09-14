import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './scripts',
  testMatch: 'qa-candidate-skills.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: [['list']],
  outputDir: 'scripts/.qa/candidate-skills-artifacts',
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:8195',
    headless: true,
    viewport: { width: 1400, height: 1600 },
    serviceWorkers: 'block',
    trace: 'off',
    video: 'off',
    actionTimeout: 15_000,
  },
});
