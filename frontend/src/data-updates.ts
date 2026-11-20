import { QueryClient } from '@tanstack/react-query';

const changes = new EventTarget();

export function notifyDataChanged() {
  changes.dispatchEvent(new Event('change'));
}

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        staleTime: 5_000,
        refetchInterval: 5_000,
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: 'always',
        refetchOnReconnect: 'always',
      },
      mutations: { retry: false },
    },
  });
}

// Only a change signal crosses tabs; participant data stays in the API cache.
export function connectDataUpdates(client: QueryClient) {
  const channel =
    typeof BroadcastChannel === 'undefined'
      ? undefined
      : new BroadcastChannel('ligahub-data-updates');
  const refresh = () => {
    void client.invalidateQueries();
  };
  const onChange = () => {
    refresh();
    channel?.postMessage('changed');
  };
  if (channel) channel.onmessage = refresh;
  changes.addEventListener('change', onChange);
  return () => {
    changes.removeEventListener('change', onChange);
    channel?.close();
  };
}
