import { defineConfig, devices } from '@playwright/test';
import 'dotenv/config';
import { testDatabaseEnvironment } from './scripts/test-database.mjs';

const database = testDatabaseEnvironment();

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
      env: {
        // A URL habitual já foi validada acima. O filho seleciona somente a URL de teste.
        DATABASE_URL: '',
        DIRECT_URL: '',
        DATABASE_TEST_URL: database.DATABASE_URL,
        LIGAHUB_BROWSER_TEST: 'true',
        NODE_ENV: 'test',
        MERCADO_PAGO_PAYOUTS_ENABLED: 'false',
        MERCADO_PAGO_PIX_PLATFORM_ACCOUNT_ID: '',
      },
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
