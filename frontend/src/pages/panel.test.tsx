import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EventDetails, EventsPage, FinancePage } from './panel';
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

it('separa situação financeira, última tentativa e inscrição cancelada', async () => {
  vi.mocked(api).mockImplementation(async (path) =>
    path.includes('/registrations?')
      ? {
          items: [
            {
              id: 'r',
              name: 'Ana',
              email: 'ana@example.com',
              answers: {},
              status: 'canceled',
              priceInCents: 2500,
              paymentStatus: 'rejected',
              financialStatus: 'approved',
              latestPaymentStatus: 'rejected',
              financialWarnings: ['multiple_approvals', 'dispute_history'],
              reservationExpiresAt: '2026-11-15T10:00:00Z',
              cancellationRequestedAt: null,
            },
          ],
          total: 1,
        }
      : {
          id: 'event',
          publicId: 'public',
          title: 'Encontro',
          status: 'closed',
          form: [],
          capacity: 10,
          priceInCents: 2500,
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
  const row = (await screen.findByText('Ana')).closest('tr')!;
  expect(within(row).getByText('Aprovado')).toBeTruthy();
  expect(within(row).getByText(/Última tentativa/)).toBeTruthy();
  expect(within(row).getByText('Recusado')).toBeTruthy();
  expect(within(row).getByText('Cancelada')).toBeTruthy();
  expect(within(row).getByText('Mais de um pagamento aprovado')).toBeTruthy();
  expect(within(row).getByText('Histórico de contestação')).toBeTruthy();
});

describe('Navegação das abas do evento', () => {
  it('associa cada aba ao seu painel e preserva busca e estado ao navegar pelo teclado', async () => {
    vi.mocked(api).mockImplementation(async (path) => {
      if (path.includes('/registrations?'))
        return { items: [], total: 100, page: 1, limit: 50 };
      if (path.includes('/history?'))
        return { items: [], total: 0, page: 1, limit: 50 };
      return {
        id: 'event',
        publicId: 'public',
        title: 'Encontro',
        status: 'closed',
        form: [],
        priceInCents: 2500,
        capacity: 10,
      };
    });
    const user = userEvent.setup();
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <MemoryRouter initialEntries={['/events/event?status=cancellation']}>
          <Routes>
            <Route path="/events/:id" element={<EventDetails />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const registrations = await screen.findByRole('tab', {
      name: 'Inscrições',
    });
    const history = screen.getByRole('tab', { name: 'Histórico' });
    const registrationPanelId = registrations.getAttribute('aria-controls');
    expect(screen.getByRole('tabpanel', { name: 'Inscrições' }).id).toBe(
      registrationPanelId,
    );
    await user.type(
      screen.getByRole('textbox', { name: 'Buscar inscrição' }),
      'Ana',
    );
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        '/events/event/registrations?page=1&search=Ana&status=cancellation',
      ),
    );
    registrations.focus();
    await user.keyboard('{End}');
    await waitFor(() =>
      expect(history.getAttribute('aria-selected')).toBe('true'),
    );
    expect(document.activeElement).toBe(history);
    const historyPanel = screen.getByRole('tabpanel', { name: 'Histórico' });
    expect(historyPanel.id).toBe(history.getAttribute('aria-controls'));
    expect(historyPanel.id).not.toBe(registrationPanelId);
    expect(
      screen.queryByRole('textbox', { name: 'Buscar inscrição' }),
    ).toBeNull();
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith('/events/event/history?page=1'),
    );
    await user.keyboard('{Home}');
    await waitFor(() =>
      expect(registrations.getAttribute('aria-selected')).toBe('true'),
    );
    expect(document.activeElement).toBe(registrations);
    expect(
      (
        screen.getByRole('textbox', {
          name: 'Buscar inscrição',
        }) as HTMLInputElement
      ).value,
    ).toBe('Ana');
    expect(
      (
        screen.getByRole('combobox', {
          name: 'Estado da inscrição',
        }) as HTMLSelectElement
      ).value,
    ).toBe('cancellation');
    const results = await axe.run(
      screen.getByRole('tabpanel', { name: 'Inscrições' }),
    );
    expect(results.violations).toEqual([]);
  });

  it('retorna à primeira página ao trocar de aba e mantém os filtros das inscrições', async () => {
    vi.mocked(api).mockImplementation(async (path) => {
      if (path.includes('/registrations?'))
        return {
          items: [
            {
              id: 'r',
              name: 'Ana',
              email: 'ana@example.test',
              status: 'confirmed',
              answers: {},
            },
          ],
          total: 100,
          page: 1,
          limit: 50,
        };
      if (path.includes('/history?'))
        return { items: [], total: 0, page: 1, limit: 50 };
      return {
        id: 'event',
        publicId: 'public',
        title: 'Encontro',
        status: 'closed',
        form: [],
        priceInCents: 2500,
        capacity: 10,
      };
    });
    const user = userEvent.setup();
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
    await screen.findByText('Ana');
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Estado da inscrição' }),
      'confirmed',
    );
    await user.click(
      await screen.findByRole('button', { name: 'Próxima página' }),
    );
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        '/events/event/registrations?page=2&search=&status=confirmed',
      ),
    );
    await user.click(screen.getByRole('tab', { name: 'Histórico' }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith('/events/event/history?page=1'),
    );
    await user.click(screen.getByRole('tab', { name: 'Inscrições' }));
    expect(
      (
        screen.getByRole('combobox', {
          name: 'Estado da inscrição',
        }) as HTMLSelectElement
      ).value,
    ).toBe('confirmed');
    expect(await screen.findByText(/Página 1 de 5/)).toBeTruthy();
  });
});

describe('Tabela de eventos', () => {
  it('compara os dados e mantém busca, estado e atenção a cancelamentos ao paginar', async () => {
    vi.mocked(api).mockResolvedValue({
      items: [
        {
          id: 'e',
          title: 'Jornada',
          location: 'Rio de Janeiro',
          startsAt: '2026-11-20T18:00:00Z',
          priceInCents: 2500,
          capacity: 100,
          status: 'published',
        },
      ],
      total: 24,
      page: 1,
      limit: 12,
    });
    const user = userEvent.setup();
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <MemoryRouter
          initialEntries={[
            '/painel/eventos?attention=cancellation&status=published',
          ]}
        >
          <EventsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const table = await screen.findByRole('table', { name: 'Eventos' });
    expect(
      within(table).getByRole('columnheader', { name: 'Preço' }),
    ).toBeTruthy();
    expect(
      within(table)
        .getByRole('cell', { name: '100 vagas' })
        .getAttribute('data-label'),
    ).toBe('Capacidade');
    expect(
      within(table)
        .getByRole('link', { name: 'Analisar cancelamentos de Jornada' })
        .getAttribute('href'),
    ).toBe('/painel/eventos/e?status=cancellation');
    expect(screen.getByText(/Esta lista inclui todos os eventos/)).toBeTruthy();
    await user.type(
      screen.getByRole('textbox', { name: 'Buscar evento' }),
      'Jornada',
    );
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        '/events?page=1&limit=12&search=Jornada&status=published',
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Próxima página' }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        '/events?page=2&limit=12&search=Jornada&status=published',
      ),
    );
  });
});

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
  it('preserva filtros ao paginar e volta à primeira página ao aplicar ou limpar', async () => {
    const user = userEvent.setup();
    vi.mocked(api).mockImplementation(async (path) =>
      path.startsWith('/payments?')
        ? {
            items: [
              {
                id: 'pagamento',
                method: 'card',
                status: 'approved',
                amountInCents: 1000,
                installments: 2,
                createdAt: '2026-10-27T12:00:00Z',
                event: { id: 'evento', title: 'Jornada financeira' },
                payer: null,
              },
            ],
            total: 51,
            page: Number(
              new URL(path, 'http://localhost').searchParams.get('page'),
            ),
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
    await screen.findByRole('cell', { name: 'Jornada financeira' });
    await user.click(screen.getByRole('button', { name: 'Próxima página' }));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/payments?page=2'));
    await user.type(screen.getByLabelText('Evento'), 'Jornada');
    await user.selectOptions(
      screen.getByLabelText('Forma de pagamento'),
      'card',
    );
    await user.click(screen.getByRole('button', { name: 'Aplicar filtros' }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        '/payments?page=1&eventSearch=Jornada&method=card',
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Próxima página' }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        '/payments?page=2&eventSearch=Jornada&method=card',
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    await waitFor(() => expect(screen.getByText(/Página 1 de 2/)).toBeTruthy());
    expect((screen.getByLabelText('Evento') as HTMLInputElement).value).toBe(
      '',
    );
  });
  it('mostra nome completo e CPF do pagador e explicita registros antigos sem dados', async () => {
    const payment = {
      id: 'p',
      method: 'pix',
      status: 'approved',
      amountInCents: 2000,
      installments: 1,
      createdAt: '2026-10-12T19:50:00Z',
      event: { id: 'evento', title: 'Jornada financeira' },
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
