import { mergeConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import config from './vite.config';

export default mergeConfig(config, {
  resolve: {
    alias: {
      '@mercadopago/sdk-react': fileURLToPath(
        new URL('./test/card-sdk.tsx', import.meta.url),
      ),
    },
  },
  cacheDir: '.test-temp/vite-e2e',
  server: {
    fs: {
      allow: [
        fileURLToPath(new URL('.', import.meta.url)),
        realpathSync(fileURLToPath(new URL('./node_modules', import.meta.url))),
      ],
    },
    proxy: { '/api': { target: 'http://127.0.0.1:3100' } },
  },
});
