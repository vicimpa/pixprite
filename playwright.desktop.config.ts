import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', testMatch: '**/desktop*.e2e.ts',
  outputDir: './dist/reports/desktop', workers: 1, fullyParallel: false,
  forbidOnly: !!process.env.CI, retries: 0, timeout: 90_000,
  expect: { timeout: 15_000 }, reporter: 'list',
});
