import { afterEach, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { api } from './api';
import { connectDataUpdates, createQueryClient } from './data-updates';

let dispose: (() => void) | undefined;
let client: ReturnType<typeof createQueryClient>;
afterEach(() => {
  dispose?.();
  client?.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function Results() {
  const result = useQuery({
    queryKey: ['results'],
    queryFn: () => api<{ total: number }>('/results'),
  });
  return <p>Total: {result.data?.total}</p>;
}

function setup() {
  client = createQueryClient();
  dispose = connectDataUpdates(client);
  render(
    <QueryClientProvider client={client}>
      <Results />
    </QueryClientProvider>,
  );
}

it('atualiza dados visíveis após uma alteração bem-sucedida e mantém dados após erro', async () => {
  let total = 1;
  let failure = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/csrf')) return Response.json({ token: 'test' });
      if (options?.method === 'PATCH') {
        if (failure)
          return Response.json({ message: 'Conflito' }, { status: 409 });
        total = 2;
        return new Response(null, { status: 204 });
      }
      return Response.json({ total });
    }),
  );
  setup();
  await screen.findByText('Total: 1');
  await act(async () => {
    await api('/registrations/r/suspension', { method: 'PATCH' });
  });
  await screen.findByText('Total: 2');
  failure = true;
  await act(async () => {
    await expect(
      api('/registrations/r/suspension', { method: 'PATCH' }),
    ).rejects.toThrow('Conflito');
  });
  expect(screen.getByText('Total: 2')).toBeTruthy();
});

it('atualiza a tela ao receber uma alteração de outra aba sem reenviar o sinal', async () => {
  let receive: (() => void) | undefined;
  const postMessage = vi.fn();
  vi.stubGlobal(
    'BroadcastChannel',
    class {
      set onmessage(handler: () => void) {
        receive = handler;
      }
      postMessage = postMessage;
      close() {}
    },
  );
  let total = 1;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ total })),
  );
  setup();
  await screen.findByText('Total: 1');
  total = 3;
  await act(async () => receive?.());
  await screen.findByText('Total: 3');
  expect(postMessage).not.toHaveBeenCalled();
});

it('busca alterações externas automaticamente a cada cinco segundos', async () => {
  vi.useFakeTimers();
  let total = 1;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ total })),
  );
  setup();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });
  expect(screen.getByText('Total: 1')).toBeTruthy();
  total = 4;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5_010);
  });
  expect(screen.getByText('Total: 4')).toBeTruthy();
});
