import { defineConfig } from 'vitest/config';
import 'dotenv/config';
import { testDatabaseEnvironment } from './scripts/test-database.mjs';

const database = testDatabaseEnvironment();

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    fileParallelism: false,
    env: {
      ...database,
      JWT_SECRET: 'segredo-exclusivo-testes-ligahub-nao-usar-em-producao',
      PAYMENT_RECONCILIATION_ENABLED: 'false',
      EMAIL_DELIVERY_ENABLED: 'false',
      CREDENTIALS_ENCRYPTION_KEY:
        'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=',
    },
  },
});
