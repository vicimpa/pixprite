import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  outputDir: './dist/reports/e2e',
  testMatch: '**/*.e2e.ts',
  testIgnore: '**/desktop*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never', outputFolder: 'dist/reports/playwright' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1280, height: 900 },
    locale: 'en-US',
    serviceWorkers: 'allow',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: process.env.PIXPRITE_E2E_BROWSER === 'webkit'
    ? [{ name: 'webkit', use: { browserName: 'webkit' } }]
    : [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: process.env.PIXPRITE_E2E_PREBUILT === '1'
      ? 'bun e2e/server.ts' : 'bun run build && bun e2e/server.ts',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
