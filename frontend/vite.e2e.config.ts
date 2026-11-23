import { mergeConfig, type ViteDevServer } from 'vite';
import { fileURLToPath } from 'node:url';
import config from './vite.config';
import { realpathSync } from 'node:fs';

export default mergeConfig(config, {
  plugins: [
    {
      name: 'browser-test-shutdown',
      configureServer(server: ViteDevServer) {
        server.middlewares.use('/__browser/shutdown', (req, res) => {
          if (
            req.method !== 'POST' ||
            req.headers['x-browser-test'] !== 'controle-local-de-testes' ||
            !process.env.LIGAHUB_BROWSER_RUN_TOKEN ||
            req.headers['x-browser-run'] !==
              process.env.LIGAHUB_BROWSER_RUN_TOKEN
          ) {
            res.statusCode = 403;
            res.end();
            return;
          }
          res.end('closing');
          setTimeout(() => {
            void server.close().finally(() => process.exit(0));
          }, 100);
        });
      },
    },
  ],
  resolve: {
    alias: {
      '@mercadopago/sdk-react': fileURLToPath(
        new URL('./test/card-sdk.tsx', import.meta.url),
      ),
    },
  },
  server: {
    fs: {
      allow: [
        fileURLToPath(new URL('.', import.meta.url)),
        realpathSync(fileURLToPath(new URL('./node_modules', import.meta.url))),
      ],
    },
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${process.env.LIGAHUB_BROWSER_API_PORT ?? '3100'}`,
      },
    },
  },
});
