import { defineConfig, devices } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import 'dotenv/config';
import { testDatabaseEnvironment } from './scripts/test-database.mjs';

const database = testDatabaseEnvironment();
process.env.LIGAHUB_BROWSER_RUN_TOKEN ??= randomUUID();
const apiPort = process.env.LIGAHUB_BROWSER_API_PORT ?? '3100';
const webPort = process.env.LIGAHUB_BROWSER_WEB_PORT ?? '3101';

export default defineConfig({
  testDir: './test/browser',
  globalTeardown: './test/browser-teardown.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 45_000,
  globalTimeout: 180_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${webPort}`,
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
      url: `http://127.0.0.1:${apiPort}/`,
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
      command: `npm --prefix frontend run dev -- --port ${webPort} --config vite.e2e.config.ts --configLoader runner`,
      url: `http://localhost:${webPort}/`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
