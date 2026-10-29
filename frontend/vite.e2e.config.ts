import { mergeConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import config from './vite.config';

export default mergeConfig(config, {
  resolve: {
    alias: {
      '@mercadopago/sdk-react': fileURLToPath(
        new URL('./test/card-sdk.tsx', import.meta.url),
      ),
    },
  },
  server: { proxy: { '/api': { target: 'http://127.0.0.1:3100' } } },
});
