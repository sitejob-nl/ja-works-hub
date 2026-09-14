import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./scripts', testMatch:['qa-client-release.spec.ts','qa-tabel-sortering*.spec.ts'], workers:1, retries:0,
  timeout:120000, reporter:[['list']], outputDir:'scripts/.qa/client-release-artifacts',
  use:{baseURL:process.env.E2E_BASE_URL || 'http://127.0.0.1:8194',headless:true,viewport:{width:1400,height:1000},serviceWorkers:'block',trace:'off',video:'off',actionTimeout:15000},
});
