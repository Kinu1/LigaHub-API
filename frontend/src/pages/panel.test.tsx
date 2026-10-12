import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FinancePage } from './panel';
import { api } from '../api';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: vi.fn(),
}));
vi.mock('../auth', () => ({
  useAuth: () => ({ user: { id: 'owner', role: 'organizer' } }),
}));
beforeEach(() => vi.resetAllMocks());

describe('Histórico financeiro', () => {
  it('mostra nome completo e CPF do pagador e explicita registros antigos sem dados', async () => {
    const payment = {
      id: 'p',
      method: 'pix',
      status: 'approved',
      amountInCents: 2000,
      installments: 1,
      createdAt: '2026-10-12T19:50:00Z',
    };
    vi.mocked(api).mockImplementation(async (path) =>
      path.startsWith('/payments?')
        ? {
            items: [
              {
                ...payment,
                payer: { name: 'Mariana Souza Oliveira', cpf: '12345678909' },
              },
              { ...payment, id: 'legacy', payer: null },
            ],
            total: 2,
            page: 1,
            limit: 50,
          }
        : { connected: true },
    );
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <FinancePage />
      </QueryClientProvider>,
    );
    const cell = await screen.findByRole('cell', {
      name: 'Mariana Souza Oliveira',
    });
    const row = cell.closest('tr')!;
    expect(
      within(row).getByRole('cell', { name: '123.456.789-09' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('columnheader', { name: 'Nome completo do pagador' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('columnheader', { name: 'CPF do pagador' }),
    ).toBeTruthy();
    expect(screen.getAllByRole('cell', { name: 'Não informado' })).toHaveLength(
      2,
    );
    expect(api).toHaveBeenCalledWith('/payments?page=1');
  });
});
