import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
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

describe('Resolução de revisão de pagamento', () => {
  it.each(['capacity_full', null])(
    'explica motivo %s e confirma com modal acessível sem replay',
    async (reason) => {
      Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
        configurable: true,
        value: function () {
          this.setAttribute('open', '');
        },
      });
      Object.defineProperty(HTMLDialogElement.prototype, 'close', {
        configurable: true,
        value: function () {
          this.removeAttribute('open');
        },
      });
      let finish: (() => void) | undefined;
      const pending = new Promise<void>((resolve) => {
        finish = resolve;
      });
      let fail = true;
      vi.mocked(api).mockImplementation(async (path) => {
        if (path.endsWith('/payment-review/confirmation')) {
          if (fail)
            throw new Error(
              'Todas as vagas estão ocupadas. Libere uma vaga e reavalie.',
            );
          await pending;
          return { id: 'review', status: 'confirmed', reviewReason: null };
        }
        if (path.includes('/registrations?'))
          return {
            items: [
              {
                id: 'review',
                answers: {},
                reservationExpiresAt: '2026-10-27T18:00:00Z',
                name: 'Em revisão',
                email: 'review@test.com',
                status: 'payment_review',
                reviewReason: reason,
                cancellationRequestedAt: null,
              },
            ],
            total: 1,
          };
        return {
          id: 'event',
          publicId: 'public',
          title: 'Evento',
          status: 'closed',
          form: [],
          priceInCents: 1000,
          capacity: 1,
        };
      });
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      const invalidate = vi.spyOn(client, 'invalidateQueries');
      render(
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={['/events/event']}>
            <Routes>
              <Route path="/events/:id" element={<EventDetails />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      );
      const user = userEvent.setup();
      expect(
        await screen.findByText(
          reason
            ? /ocupadas por confirmações/
            : 'Motivo não registrado; consulte o pagamento antes de resolver',
        ),
      ).toBeTruthy();
      await user.click(
        screen.getByRole('button', { name: 'Reavaliar confirmação' }),
      );
      const dialog = screen.getByRole('dialog', {
        name: 'Reavaliar confirmação?',
      });
      expect(within(dialog).getByText(/Não estorna/)).toBeTruthy();
      expect(document.activeElement).toBe(
        within(dialog).getByRole('button', { name: 'Voltar' }),
      );
      expect(
        (
          await axe.run(dialog, {
            rules: { 'color-contrast': { enabled: false } },
          })
        ).violations,
      ).toEqual([]);
      await user.click(
        within(dialog).getByRole('button', { name: 'Confirmar' }),
      );
      expect(await within(dialog).findByRole('alert')).toHaveProperty(
        'textContent',
        'Todas as vagas estão ocupadas. Libere uma vaga e reavalie.',
      );
      fail = false;
      await user.click(
        within(dialog).getByRole('button', { name: 'Confirmar' }),
      );
      expect(
        within(dialog).getByRole('button', { name: 'Aguarde…' }),
      ).toHaveProperty('disabled', true);
      expect(api).toHaveBeenCalledWith(
        '/registrations/review/payment-review/confirmation',
        { method: 'POST' },
        false,
      );
      finish!();
      await waitFor(() => expect(invalidate).toHaveBeenCalled());
      vi.restoreAllMocks();
    },
  );
});

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
