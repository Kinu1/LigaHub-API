import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  render,
  screen,
  waitFor,
  within,
  fireEvent,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EventEditor } from './editor';
import { api, send } from '../api';

vi.mock('../auth', () => ({
  useAuth: () => ({ user: { id: 'organizer', role: 'organizer' } }),
}));
vi.mock('../api', async (original) => ({
  ...(await original<typeof import('../api')>()),
  api: vi.fn(),
  send: vi.fn(),
}));

function show(edit = false) {
  const router = createMemoryRouter(
    [
      { path: '/painel/eventos/novo', element: <EventEditor /> },
      { path: '/painel/eventos/:id/editar', element: <EventEditor /> },
      { path: '/painel/eventos/:id', element: <p>Evento salvo</p> },
    ],
    {
      initialEntries: [
        edit ? '/painel/eventos/legacy/editar' : '/painel/eventos/novo',
      ],
    },
  );
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(send).mockResolvedValue({ id: 'saved' });
});

describe('Preço mínimo no editor de eventos', () => {
  it('salva a abertura das inscrições no horário de Brasília e rejeita abertura no encerramento', async () => {
    show();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Nome do evento'), 'Jornada');
    function fill(title: string, day: string, time: string) {
      const group = within(screen.getByRole('group', { name: title }));
      const [year, month, date] = day.split('-').map(Number);
      fireEvent.change(group.getByLabelText('Ano'), {
        target: { value: String(year) },
      });
      fireEvent.change(group.getByLabelText('Mês'), {
        target: { value: String(month) },
      });
      fireEvent.change(group.getByLabelText('Dia'), {
        target: { value: String(date) },
      });
      fireEvent.change(group.getByLabelText('Horário'), {
        target: { value: time },
      });
    }
    fill('Início do evento', '2030-02-01', '18:00');
    fill('Encerramento das inscrições', '2030-01-31', '18:00');
    fill('Início das inscrições', '2030-01-31', '18:00');
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(
      await screen.findByText(
        'A abertura deve ser antes do encerramento das inscrições e do início do evento.',
      ),
    ).toBeTruthy();
    fill('Início das inscrições', '2030-01-01', '09:00');
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.type(screen.getByLabelText('Preço da inscrição (R$)'), '25,00');
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.click(screen.getByRole('button', { name: 'Salvar evento' }));
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(
        '/events',
        expect.objectContaining({
          registrationStartsAt: '2030-01-01T12:00:00.000Z',
        }),
        'POST',
      ),
    );
  });
  it('impede avançar com preço abaixo de cinquenta centavos', async () => {
    const user = userEvent.setup();
    show();
    await user.type(screen.getByLabelText('Nome do evento'), 'Jornada');
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    for (const value of ['0,01', '0,49', '0.49']) {
      await user.clear(screen.getByLabelText('Preço da inscrição (R$)'));
      await user.type(screen.getByLabelText('Preço da inscrição (R$)'), value);
      await user.click(screen.getByRole('button', { name: 'Continuar' }));
      expect(
        await screen.findByText('O preço mínimo da inscrição é R$ 0,50.'),
      ).toBeTruthy();
      expect(send).not.toHaveBeenCalled();
    }
  });

  it.each(['0,50', '0.50'])(
    'salva o limite de %s como cinquenta centavos',
    async (price) => {
      const user = userEvent.setup();
      show();
      await user.type(screen.getByLabelText('Nome do evento'), 'Jornada');
      await user.click(screen.getByRole('button', { name: 'Continuar' }));
      await user.type(screen.getByLabelText('Preço da inscrição (R$)'), price);
      await user.click(screen.getByRole('button', { name: 'Continuar' }));
      await user.click(screen.getByRole('button', { name: 'Continuar' }));
      await user.click(screen.getByRole('button', { name: 'Salvar evento' }));
      await waitFor(() =>
        expect(send).toHaveBeenCalledWith(
          '/events',
          expect.objectContaining({ priceInCents: 50 }),
          'POST',
        ),
      );
    },
  );

  it('permite editar um título antigo sem reenviar nem alterar o preço de um centavo', async () => {
    vi.mocked(api).mockResolvedValue({
      id: 'legacy',
      title: 'Evento antigo',
      description: '',
      location: '',
      startsAt: null,
      endsAt: null,
      registrationDeadline: null,
      priceInCents: 1,
      capacity: 10,
      reservationMinutes: 15,
      ownerId: 'organizer',
      form: [],
    });
    const user = userEvent.setup();
    show(true);
    await screen.findByDisplayValue('Evento antigo');
    await user.clear(screen.getByLabelText('Nome do evento'));
    await user.type(
      screen.getByLabelText('Nome do evento'),
      'Título atualizado',
    );
    for (let step = 0; step < 3; step++)
      await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.click(screen.getByRole('button', { name: 'Salvar evento' }));
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(
        '/events/legacy',
        expect.objectContaining({ title: 'Título atualizado' }),
        'PATCH',
      ),
    );
    expect(vi.mocked(send).mock.calls[0][1]).not.toHaveProperty('priceInCents');
  });
});
