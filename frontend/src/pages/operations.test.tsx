import { beforeEach, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '../api';
import { OperationsPage } from './operations';

const auth = vi.hoisted(() => ({ role: 'admin', loading: false }));
vi.mock('../auth', () => ({
  useAuth: () => ({
    user: { id: 'admin-1', role: auth.role },
    loading: auth.loading,
  }),
}));

vi.mock('../api', async (original) => ({
  ...(await original<typeof import('../api')>()),
  api: vi.fn(),
}));

const mockData = {
  flags: {
    backgroundJobsEnabled: true,
    backgroundTimersEnabled: true,
    emailDeliveryEnabled: true,
    paymentReconciliationEnabled: true,
  },
  routines: [
    {
      name: 'emails' as const,
      startedAt: '2026-10-27T10:00:00.000Z',
      finishedAt: '2026-10-27T10:00:05.000Z',
      lastSucceededAt: '2026-10-27T10:00:05.000Z',
      lastFailedAt: null,
      status: 'completed' as const,
      errorCode: null,
      runCount: 15,
      failureCount: 0,
      processedCount: 10,
      succeededCount: 10,
      failedCount: 0,
      skippedCount: 0,
      activeLease: false,
      leaseExpiresAt: null,
    },
    {
      name: 'payments' as const,
      startedAt: '2026-10-27T10:01:00.000Z',
      finishedAt: '2026-10-27T10:01:08.000Z',
      lastSucceededAt: '2026-10-27T09:00:00.000Z',
      lastFailedAt: '2026-10-27T10:01:08.000Z',
      status: 'partial' as const,
      errorCode: 'PARTIAL_FAILURE',
      runCount: 20,
      failureCount: 2,
      processedCount: 12,
      succeededCount: 10,
      failedCount: 2,
      skippedCount: 0,
      activeLease: true,
      leaseExpiresAt: '2026-10-27T10:06:00.000Z',
    },
  ],
  queues: {
    confirmation: {
      pending: 3,
      processing: 1,
      sent: 25,
      failed: 2,
      skipped: 0,
      oldestNextAttemptAt: '2026-10-27T10:05:00.000Z',
    },
    access: {
      pending: 1,
      processing: 0,
      sent: 18,
      failed: 1,
      skipped: 2,
      oldestNextAttemptAt: '2026-10-27T10:02:00.000Z',
    },
  },
  failedPayments: {
    items: [
      {
        id: 'pay-uuid-1',
        registrationId: 'reg-uuid-1',
        event: { id: 'evt-1', title: 'Congresso Médico Anual' },
        method: 'pix',
        amountInCents: 15000,
        status: 'pending',
        lastSyncAttemptAt: '2026-10-27T10:01:05.000Z',
        lastSyncSucceededAt: null,
        lastSyncErrorCode: 'provider_unavailable',
        createdAt: '2026-10-27T09:30:00.000Z',
        updatedAt: '2026-10-27T10:01:05.000Z',
      },
    ],
    total: 25,
    page: 1,
    limit: 20,
  },
};

function renderOperations() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <OperationsPage />
    </QueryClientProvider>,
  );
  return client;
}

beforeEach(() => {
  vi.resetAllMocks();
  auth.role = 'admin';
  auth.loading = false;
  vi.mocked(api).mockResolvedValue(mockData);
});

it.each(['organizer', 'attendee', ''])(
  'não permite acesso a usuários sem papel de admin (%s)',
  (role) => {
    auth.role = role;
    renderOperations();
    expect(screen.getByRole('alert').textContent).toContain(
      'Você não tem acesso a esta página.',
    );
    expect(api).not.toHaveBeenCalled();
  },
);

it('aguarda carregamento de autenticação', () => {
  auth.loading = true;
  renderOperations();
  expect(api).not.toHaveBeenCalled();
});

it('renderiza diagnósticos, rotinas, timestamps, legendas e contadores em pt-BR', async () => {
  renderOperations();
  expect(await screen.findByText('Operação e rotinas')).toBeTruthy();

  // Flags
  expect(await screen.findByText('Endpoints HTTP de rotina')).toBeTruthy();
  expect(screen.getByText('Timers automáticos')).toBeTruthy();

  // Rotinas
  expect(screen.getByText('Fila de e-mails')).toBeTruthy();
  expect(
    screen.getByRole('heading', { name: 'Reconciliação de pagamentos' }),
  ).toBeTruthy();
  expect(screen.getByText('Concluído')).toBeTruthy();
  expect(screen.getByText('Parcial')).toBeTruthy();
  expect(screen.getByText('Em execução')).toBeTruthy();

  // Legendas
  expect(screen.getByText(/Último sucesso verificável:/)).toBeTruthy();
  expect(
    screen.getByText(/Aceito pelo provedor não significa entregue/),
  ).toBeTruthy();

  // Filas
  expect(screen.getByText('Confirmações de inscrição')).toBeTruthy();
  expect(screen.getByText('Links de acesso e gestão')).toBeTruthy();

  // Pagamento com falha
  expect(screen.getByText('Congresso Médico Anual')).toBeTruthy();
  expect(screen.getByText('Provedor indisponível')).toBeTruthy();
  expect(screen.getByText(/R\$\s*150,00/)).toBeTruthy();

  // Segurança: nenhum segredo ou dado confidencial
  expect(screen.queryByText(/secret|token|senha|password|cpf/i)).toBeNull();
});

it.each(['running', 'unfinished'])(
  'não exibe sucesso antigo como resultado da rotina %s',
  async (status) => {
    vi.mocked(api).mockResolvedValue({
      ...mockData,
      routines: [
        {
          ...mockData.routines[0],
          status,
          finishedAt: null,
          activeLease: status === 'running',
          processedCount: null,
          succeededCount: null,
          failedCount: null,
          skippedCount: null,
        },
      ],
    });
    renderOperations();
    expect(
      await screen.findByText(
        status === 'running' ? 'Em execução' : 'Sem conclusão registrada',
      ),
    ).toBeTruthy();
    expect(screen.queryByText('Concluído')).toBeNull();
    expect(
      screen.getByText('Contadores disponíveis após o término'),
    ).toBeTruthy();
    expect(screen.getAllByText('—')).toHaveLength(4);
  },
);

it('permite atualizar e paginar a lista de pagamentos com falha', async () => {
  renderOperations();
  const user = userEvent.setup();

  await screen.findByText('Congresso Médico Anual');
  expect(api).toHaveBeenLastCalledWith('/admin/operations?page=1&limit=20');

  // Próxima página
  await user.click(screen.getByRole('button', { name: 'Próxima página' }));
  expect(api).toHaveBeenLastCalledWith('/admin/operations?page=2&limit=20');

  // Atualizar diagnóstico
  await user.click(
    screen.getByRole('button', { name: 'Atualizar diagnóstico' }),
  );
  expect(api).toHaveBeenCalledTimes(3);
});

it('não mascara falha de atualização nem apresenta dados obsoletos como saudáveis', async () => {
  const client = renderOperations();
  await screen.findByText('Congresso Médico Anual');

  vi.mocked(api).mockRejectedValueOnce(new Error('Falha de rede'));
  await act(async () => {
    await client.refetchQueries({ queryKey: ['admin-operations'] });
  });

  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain(
    'Não foi possível atualizar o diagnóstico operacional. Os dados anteriores foram mantidos e podem estar desatualizados.',
  );
});
