import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FinancePage } from './finance';
import { api } from '../api';
import axe from 'axe-core';

vi.mock('../api', async (original) => ({
  ...(await original<typeof import('../api')>()),
  api: vi.fn(),
}));
const auth = vi.hoisted(() => ({ user: { id: 'owner', role: 'organizer' } }));
vi.mock('../auth', () => ({ useAuth: () => auth }));

function show() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <FinancePage />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  auth.user = { id: 'owner', role: 'organizer' };
  history.replaceState({}, '', '/painel/financeiro');
  vi.mocked(api).mockImplementation(async (path) =>
    path.startsWith('/payments?')
      ? { items: [], total: 0, page: 1, limit: 50 }
      : {
          connected: true,
          merchantId: '900000001',
          publicKey: 'APP_USR-publica-de-teste',
          isTest: false,
          createdAt: '2026-11-15T18:00:00Z',
          tokenExpiresAt: '2027-05-15T18:00:00Z',
        },
  );
});
afterEach(() => history.replaceState({}, '', '/'));

describe('Conta conectada no Financeiro', () => {
  it('confirma o retorno com os dados autorizados e mantém filtros ao limpar o aviso da URL', async () => {
    history.replaceState(
      {},
      '',
      '/painel/financeiro?mercadoPago=connected&method=pix',
    );
    const view = show();
    expect(
      await screen.findByText('Conta do Mercado Pago conectada com sucesso.'),
    ).toBeTruthy();
    expect(screen.getByText('900000001')).toBeTruthy();
    expect(screen.getByText('APP_USR-publica-de-teste')).toBeTruthy();
    expect(screen.getByText('Produção — cobranças reais')).toBeTruthy();
    expect(screen.getByText('Autorização válida até')).toBeTruthy();
    expect(location.search).toBe('?method=pix');
    expect(
      (
        await axe.run(view.container, {
          rules: { 'color-contrast': { enabled: false } },
        })
      ).violations,
    ).toEqual([]);
  });
  it('não confirma conexão usando apenas um parâmetro de URL', async () => {
    vi.mocked(api).mockResolvedValue({ connected: false, items: [], total: 0 });
    history.replaceState({}, '', '/painel/financeiro?mercadoPago=connected');
    show();
    await screen.findByText(/Conecte a conta do organizador/);
    expect(
      screen.queryByText('Conta do Mercado Pago conectada com sucesso.'),
    ).toBeNull();
  });
  it.each([
    [
      'error',
      'Não foi possível concluir a conexão. Tente conectar a conta novamente.',
    ],
    [
      'canceled',
      'A autorização foi cancelada. Sua conexão anterior foi preservada.',
    ],
  ])(
    'explica o retorno %s e continua mostrando a conexão existente',
    async (result, message) => {
      history.replaceState({}, '', `/painel/financeiro?mercadoPago=${result}`);
      show();
      expect(screen.getByRole('alert').textContent).toBe(message);
      expect(await screen.findByText('900000001')).toBeTruthy();
    },
  );
  it('consulta a conta do organizador que voltou do OAuth quando o usuário é administrador', async () => {
    auth.user = { id: 'admin', role: 'admin' };
    vi.mocked(api).mockImplementation(async (path) =>
      path === '/users'
        ? [{ id: 'primeiro', role: 'organizer', active: true }]
        : path.startsWith('/payments?')
          ? { items: [], total: 0 }
          : { connected: true, merchantId: 'conta-do-retorno' },
    );
    history.replaceState(
      {},
      '',
      '/painel/financeiro?mercadoPago=connected&ownerId=outro-organizador',
    );
    show();
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        '/payments/accounts?ownerId=outro-organizador',
      ),
    );
    expect(await screen.findByText('conta-do-retorno')).toBeTruthy();
  });
  it('ignora ownerId recebido na URL quando o usuário é organizador', async () => {
    history.replaceState(
      {},
      '',
      '/painel/financeiro?ownerId=outro-organizador',
    );
    show();
    await screen.findByText('900000001');
    expect(api).toHaveBeenCalledWith('/payments/accounts');
    expect(api).not.toHaveBeenCalledWith(
      '/payments/accounts?ownerId=outro-organizador',
    );
  });
});
