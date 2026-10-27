import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './test/browser',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 45_000,
  globalTimeout: 180_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3101',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'celular',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
      },
    },
  ],
  webServer: [
    {
      name: 'API de teste',
      command: 'node scripts/browser-test-server.mjs',
      url: 'http://127.0.0.1:3100/',
      reuseExistingServer: false,
      env: { LIGAHUB_BROWSER_TEST: 'true', NODE_ENV: 'test' },
      timeout: 60_000,
    },
    {
      name: 'Web de teste',
      command:
        'npm --prefix frontend run dev -- --port 3101 --config vite.e2e.config.ts',
      url: 'http://localhost:3101/',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
