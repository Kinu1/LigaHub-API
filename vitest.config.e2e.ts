import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    fileParallelism: false,
    env: { JWT_SECRET: 'segredo-exclusivo-testes-ligahub-nao-usar-em-producao', PAYMENT_RECONCILIATION_ENABLED: 'false' },
  },
});
