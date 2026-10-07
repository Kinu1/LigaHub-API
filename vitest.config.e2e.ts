import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    fileParallelism: false,
    env: {
      JWT_SECRET: 'segredo-exclusivo-testes-ligahub-nao-usar-em-producao',
      PAYMENT_RECONCILIATION_ENABLED: 'false',
    },
  },
});
