// Only the dedicated local browser harness exposes these authenticated controls.
// Closing servers explicitly avoids orphaned Windows shell children at teardown.
export default async function teardown() {
  const servers = [
    `http://127.0.0.1:${process.env.LIGAHUB_BROWSER_API_PORT ?? '3100'}`,
    `http://localhost:${process.env.LIGAHUB_BROWSER_WEB_PORT ?? '3101'}`,
  ];
  const closed = await Promise.all(
    servers.map(async (origin) => {
      try {
        const response = await fetch(`${origin}/__browser/shutdown`, {
          method: 'POST',
          headers: {
            'x-browser-test': 'controle-local-de-testes',
            'x-browser-run': process.env.LIGAHUB_BROWSER_RUN_TOKEN ?? '',
            Connection: 'close',
          },
          signal: AbortSignal.timeout(5000),
        });
        return response.ok ? origin : null;
      } catch {
        /* A server that never started has nothing to shut down. */
        return null;
      }
    }),
  );
  for (let attempt = 0; attempt < 50; attempt++) {
    const alive = await Promise.all(
      closed
        .filter((origin): origin is string => origin !== null)
        .map(async (origin) => {
          try {
            await fetch(origin, {
              signal: AbortSignal.timeout(200),
              headers: { Connection: 'close' },
            });
            return true;
          } catch {
            return false;
          }
        }),
    );
    if (alive.every((value) => !value)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Os servidores exclusivos do navegador não encerraram.');
}
