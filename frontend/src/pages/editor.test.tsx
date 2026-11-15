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
import { ThemeProvider, ThemeToggle } from '../theme';
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

function show(edit = false, withTheme = false) {
  const router = createMemoryRouter(
    [
      { path: '/painel/eventos', element: <p>Lista de eventos</p> },
      {
        path: '/painel/eventos/novo',
        element: withTheme ? (
          <ThemeProvider>
            <ThemeToggle />
            <EventEditor />
          </ThemeProvider>
        ) : (
          <EventEditor />
        ),
      },
      {
        path: '/painel/eventos/:id/editar',
        element: withTheme ? (
          <ThemeProvider>
            <ThemeToggle />
            <EventEditor />
          </ThemeProvider>
        ) : (
          <EventEditor />
        ),
      },
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
      fireEvent.change(group.getByLabelText('Data'), {
        target: { value: day },
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
    await user.type(screen.getByLabelText('Valor (R$)'), '25,00');
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
      await user.clear(screen.getByLabelText('Valor (R$)'));
      await user.type(screen.getByLabelText('Valor (R$)'), value);
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
      await user.type(screen.getByLabelText('Valor (R$)'), price);
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

describe('Navegação segura no editor', () => {
  it('mantém os campos entre etapas e permite cancelar ou confirmar a saída com foco seguro', async () => {
    show();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Nome do evento'));
    await user.paste('Encontro preservado');
    await user.click(screen.getByLabelText('Descrição'));
    await user.paste('Descrição preservada');
    await user.click(screen.getByLabelText('Local'));
    await user.paste('Auditório');
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.click(screen.getByLabelText('Valor (R$)'));
    await user.paste('25,00');
    await user.clear(screen.getByLabelText('Capacidade total do evento'));
    await user.type(screen.getByLabelText('Capacidade total do evento'), '75');
    await user.click(screen.getByRole('button', { name: 'Anterior' }));
    expect(screen.getByLabelText('Nome do evento')).toHaveProperty(
      'value',
      'Encontro preservado',
    );
    expect(screen.getByLabelText('Descrição')).toHaveProperty(
      'value',
      'Descrição preservada',
    );
    expect(screen.getByLabelText('Local')).toHaveProperty('value', 'Auditório');
    const back = screen.getByRole('link', { name: /Voltar aos eventos/ });
    await user.click(back);
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Sair sem salvar?',
    });
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
    const cancel = within(dialog).getByRole('button', {
      name: 'Continuar editando',
    });
    await waitFor(() => expect(document.activeElement).toBe(cancel));
    await user.tab();
    expect(document.activeElement).toBe(
      within(dialog).getByRole('button', { name: 'Sair sem salvar' }),
    );
    await user.tab();
    expect(document.activeElement).toBe(cancel);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(back));
    expect(screen.getByLabelText('Nome do evento')).toHaveProperty(
      'value',
      'Encontro preservado',
    );
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(screen.getByLabelText('Valor (R$)')).toHaveProperty(
      'value',
      '25,00',
    );
    expect(screen.getByLabelText('Capacidade total do evento')).toHaveProperty('value', '75');
    await user.click(back);
    await user.click(
      await screen.findByRole('button', { name: 'Continuar editando' }),
    );
    expect(screen.getByLabelText('Capacidade total do evento')).toHaveProperty('value', '75');
    await user.click(back);
    await user.click(
      await screen.findByRole('button', { name: 'Sair sem salvar' }),
    );
    expect(await screen.findByText('Lista de eventos')).toBeTruthy();
    expect(send).not.toHaveBeenCalled();
  });
});

it('preserves the four-step review, questions and form values when changing theme', async () => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  localStorage.removeItem('ligahub:theme');
  try {
    show(false, true);
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Nome do evento'));
    await user.paste('Jornada');
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.click(screen.getByLabelText('Valor (R$)'));
    await user.paste('30,00');
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.click(
      await screen.findByRole('button', { name: 'Adicionar pergunta' }),
    );
    await user.click(screen.getByLabelText('O que você quer perguntar?'));
    await user.paste('Instituição');
    await user.click(screen.getByRole('button', { name: /^Tema:/ }));
    await user.click(
      await screen.findByRole('menuitemradio', { name: 'Escuro' }),
    );
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(screen.getByLabelText('O que você quer perguntar?')).toHaveProperty(
      'value',
      'Instituição',
    );
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(screen.getByRole('heading', { name: 'Jornada' })).toBeTruthy();
    expect(screen.getByLabelText('Instituição (opcional)')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Salvar evento' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Anterior' }));
    expect(screen.getByLabelText('O que você quer perguntar?')).toHaveProperty(
      'value',
      'Instituição',
    );
    await user.click(screen.getByRole('button', { name: 'Anterior' }));
    expect(screen.getByLabelText('Valor (R$)')).toHaveProperty(
      'value',
      '30,00',
    );
    await user.click(screen.getByRole('button', { name: /^Tema:/ }));
    await user.click(
      await screen.findByRole('menuitemradio', { name: 'Claro' }),
    );
    await user.click(screen.getByRole('button', { name: 'Anterior' }));
    expect(screen.getByLabelText('Nome do evento')).toHaveProperty(
      'value',
      'Jornada',
    );
    expect(send).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
    localStorage.removeItem('ligahub:theme');
    document.documentElement.classList.remove('dark');
    document.documentElement.style.colorScheme = '';
  }
});
