import { beforeEach, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api, ApiError, send } from '../api';
import { OutboxPage } from './outbox';

const auth = vi.hoisted(() => ({ role: 'admin', loading: false }));
vi.mock('../auth', () => ({
  useAuth: () => ({
    user: { id: 'admin', role: auth.role },
    loading: auth.loading,
  }),
}));
vi.mock('../api', async (original) => ({
  ...(await original<typeof import('../api')>()),
  api: vi.fn(),
  send: vi.fn(),
}));
const entry = {
  id: 'email-1',
  registrationId: 'registration-1',
  status: 'failed',
  attempts: 2,
  createdAt: '2026-10-26T18:30:00Z',
  firstAttemptAt: new Date(Date.now() - 3600000).toISOString(),
  nextAttemptAt: null,
  leaseExpiresAt: null,
  sentAt: null,
  reason: 'manual_review_required',
  payload: 'segredo-payload',
  email: 'privado@example.test',
  token: 'segredo-token',
};
const result = (items = [entry]) => ({ items, total: 40, page: 1, limit: 20 });
function show() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: 3 } },
  });
  render(
    <QueryClientProvider client={client}>
      <OutboxPage />
    </QueryClientProvider>,
  );
  return client;
}
beforeEach(() => {
  vi.resetAllMocks();
  auth.role = 'admin';
  auth.loading = false;
  vi.mocked(api).mockResolvedValue(result());
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
it('filtra os cinco status e reinicia a paginação', async () => {
  show();
  const user = userEvent.setup();
  await screen.findByText('Tentativas: 2');
  expect(api).toHaveBeenLastCalledWith(
    '/admin/email-outbox?status=failed&page=1&limit=20',
  );
  await user.click(screen.getByRole('button', { name: 'Próxima página' }));
  expect(api).toHaveBeenLastCalledWith(
    '/admin/email-outbox?status=failed&page=2&limit=20',
  );
  for (const status of ['pending', 'processing', 'sent', 'skipped', 'failed']) {
    await user.selectOptions(screen.getByLabelText('Status'), status);
    expect(api).toHaveBeenLastCalledWith(
      `/admin/email-outbox?status=${status}&page=1&limit=20`,
    );
  }
});
it.each(['organizer', ''])(
  'não consulta nem permite ação sem administrador (%s)',
  (role) => {
    auth.role = role;
    show();
    expect(screen.getByRole('alert').textContent).toContain(
      'Você não tem acesso',
    );
    expect(api).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Retomar e-mail' })).toBeNull();
  },
);
it('aguarda autenticação sem consultar', () => {
  auth.loading = true;
  show();
  expect(api).not.toHaveBeenCalled();
});
it('mostra status, classificação e datas sem expor conteúdo privado', async () => {
  vi.mocked(api).mockResolvedValue(
    result(
      ['pending', 'processing', 'sent', 'failed', 'skipped'].map(
        (status, i) => ({ ...entry, id: `email-${i}`, status }),
      ),
    ),
  );
  show();
  for (const label of [
    'Pendente',
    'Em processamento',
    'Aceito pelo provedor',
    'Falhou',
    'Ignorado',
  ]) {
    expect(await screen.findByRole('heading', { name: label })).toBeTruthy();
  }
  expect(screen.getAllByText(/26\/10\/2026, 15:30:00/).length).toBe(5);
  expect(screen.getAllByText(/não comprova a causa histórica/).length).toBe(5);
  expect(screen.queryByText(/segredo|privado@example/)).toBeNull();
  await userEvent.setup().click(screen.getAllByText('Identificadores')[0]);
  expect(screen.getAllByText('registration-1').length).toBe(5);
});
it.each([
  null,
  'invalid',
  new Date(Date.now() - 23 * 3600000).toISOString(),
  new Date(Date.now() + 3600000).toISOString(),
])('não permite retomar fora da janela segura (%s)', async (firstAttemptAt) => {
  vi.mocked(api).mockResolvedValue(
    result([{ ...entry, firstAttemptAt } as typeof entry]),
  );
  show();
  await screen.findByText('Tentativas: 2');
  expect(screen.queryByRole('button', { name: 'Retomar e-mail' })).toBeNull();
});
it('confirma reutilização, impede envio duplo, envia POST sem corpo e recarrega', async () => {
  show();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole('button', { name: 'Retomar e-mail' }),
  );
  const dialog = screen.getByRole('dialog');
  expect(
    within(dialog).getByText(/reutiliza a mensagem e a chave originais/),
  ).toBeTruthy();
  expect(within(dialog).getByText(/SMTP.*duplicidade/)).toBeTruthy();
  let resolve!: (value: unknown) => void;
  vi.mocked(api).mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await user.dblClick(
    within(dialog).getByRole('button', { name: 'Confirmar' }),
  );
  expect(api).toHaveBeenCalledTimes(2);
  expect(api).toHaveBeenLastCalledWith(
    '/admin/email-outbox/email-1/retry',
    { method: 'POST' },
    false,
  );
  await act(async () => resolve({ id: entry.id, status: 'sent' }));
  expect(await screen.findByText(/Mensagem aceita pelo provedor/)).toBeTruthy();
  expect(api).toHaveBeenCalledTimes(3);
  expect(send).not.toHaveBeenCalled();
});
it.each([
  [409, /recusada por segurança/],
  [503, /envio desativado/],
  [500, /resultado pode ser incerto/],
])(
  'trata falha %s sem erro bruto e sem repetição automática',
  async (status, message) => {
    show();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: 'Retomar e-mail' }),
    );
    vi.mocked(api).mockRejectedValueOnce(
      new ApiError(status as number, 'segredo-provedor'),
    );
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Confirmar',
      }),
    );
    expect((await screen.findByRole('alert')).textContent).toMatch(
      message as RegExp,
    );
    expect(screen.queryByText('segredo-provedor')).toBeNull();
    expect(api).toHaveBeenCalledTimes(3);
  },
);
it('preserva dados após falha de atualização e não afirma vazio', async () => {
  const client = show();
  await screen.findByText('Tentativas: 2');
  vi.mocked(api).mockRejectedValueOnce(new Error('segredo-erro'));
  await act(async () => {
    await client.refetchQueries({ queryKey: ['email-outbox'] });
  });
  expect((await screen.findByRole('alert')).textContent).toContain(
    'dados anteriores foram mantidos',
  );
  expect(screen.getByText('Tentativas: 2')).toBeTruthy();
  expect(screen.queryByText('Nenhum e-mail neste status')).toBeNull();
  expect(screen.queryByText('segredo-erro')).toBeNull();
});
it('diferencia erro inicial de fila vazia', async () => {
  vi.mocked(api).mockRejectedValueOnce(new Error('segredo'));
  show();
  expect((await screen.findByRole('alert')).textContent).toContain(
    'dados não estão disponíveis',
  );
  expect(screen.queryByText('Nenhum e-mail neste status')).toBeNull();
});
