import { defineConfig, devices } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORAGE = path.resolve(__dirname, '.auth-state.json');

export default defineConfig({
  testDir: './',
  testMatch: '*.spec.ts',
  timeout: 120_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:8080',
    headless: false,
    viewport: { width: 1400, height: 900 },
    trace: 'retain-on-failure',
    video: 'off',
    storageState: fs.existsSync(STORAGE) ? STORAGE : undefined,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
