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
  webServer: process.env.PLAYWRIGHT_SKIP_WEBSERVER === '1'
    ? undefined
    : {
        command: 'npm run dev -- --host 127.0.0.1 --port 8081',
        url: 'http://127.0.0.1:8081',
        reuseExistingServer: true,
        timeout: 120_000,
      },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8081',
    headless: process.env.HEADED !== '1',
    viewport: { width: 1400, height: 900 },
    trace: 'retain-on-failure',
    video: 'off',
    storageState: fs.existsSync(STORAGE) ? STORAGE : undefined,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
