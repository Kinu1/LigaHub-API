import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EventDetails, FinancePage } from './panel';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { api } from '../api';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: vi.fn(),
}));
vi.mock('../auth', () => ({
  useAuth: () => ({ user: { id: 'owner', role: 'organizer' } }),
}));
beforeEach(() => vi.resetAllMocks());

describe('Solicitações de cancelamento no painel', () => {
  it('distingue solicitação aberta de histórico concluído e cancelamento sem solicitação', async () => {
    const registration = {
      answers: {},
      reservationExpiresAt: '2026-10-12T19:50:00Z',
      cancellationRequestedAt: '2026-10-12T19:50:00Z',
    };
    vi.mocked(api).mockImplementation(async (path) =>
      path.includes('/registrations?')
        ? {
            items: [
              {
                ...registration,
                id: 'open',
                name: 'Aberta',
                email: 'aberta@example.test',
                status: 'confirmed',
              },
              {
                ...registration,
                id: 'resolved',
                name: 'Resolvida',
                email: 'resolvida@example.test',
                status: 'canceled',
              },
              {
                ...registration,
                id: 'none',
                name: 'Sem solicitação',
                email: 'sem@example.test',
                status: 'canceled',
                cancellationRequestedAt: null,
              },
            ],
            total: 3,
            page: 1,
            limit: 50,
          }
        : {
            id: 'event',
            publicId: 'public',
            title: 'Encontro',
            status: 'closed',
            form: [],
            priceInCents: 2500,
            capacity: 10,
          },
    );
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <MemoryRouter initialEntries={['/events/event']}>
          <Routes>
            <Route path="/events/:id" element={<EventDetails />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const open = (await screen.findByText('Aberta')).closest('tr')!;
    expect(within(open).getByText('Cancelamento solicitado')).toBeTruthy();
    expect(
      within(open).queryByText('Solicitação de cancelamento concluída'),
    ).toBeNull();
    const resolved = screen.getByText('Resolvida').closest('tr')!;
    expect(within(resolved).getByText('Cancelada')).toBeTruthy();
    expect(
      within(resolved).getByText('Solicitação de cancelamento concluída'),
    ).toBeTruthy();
    expect(within(resolved).queryByText('Cancelamento solicitado')).toBeNull();
    const none = screen.getByText('Sem solicitação').closest('tr')!;
    expect(
      within(none).queryByText(
        /Cancelamento solicitado|Solicitação de cancelamento concluída/,
      ),
    ).toBeNull();
  });
});

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
