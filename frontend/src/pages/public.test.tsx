import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider, ThemeToggle } from '../theme';
import { PublicEvent, ParticipantPage } from './public';
import { api, send, ApiError } from '../api';
vi.mock('../api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../api')>();
  return { ...original, api: vi.fn(), send: vi.fn() };
});
vi.mock('@mercadopago/sdk-react', () => ({
  initMercadoPago: vi.fn(),
  CardPayment: ({
    onSubmit,
  }: {
    onSubmit: (data: {
      token: string;
      payment_method_id: string;
      installments: number;
      payer: { identification: { number: string } };
    }) => Promise<void>;
  }) => (
    <button
      onClick={() =>
        onSubmit({
          token: 'token-simulado',
          payment_method_id: 'visa',
          installments: 3,
          payer: { identification: { number: '123.456.789-09' } },
        })
      }
    >
      Revisar cartão simulado
    </button>
  ),
}));
const event = {
  publicId: '7610c4b6-ec08-4fce-9335-b2357ca2eaba',
  title: 'Jornada acadêmica',
  description: 'Encontro',
  location: 'Auditório',
  startsAt: '2030-10-08T15:00:00Z',
  priceInCents: 2500,
  availableSpots: 2,
  acceptingRegistrations: true,
  form: [
    { id: 'instituicao', label: 'Instituição', type: 'text', required: true },
  ],
};
function show(
  component: React.ReactNode,
  path = '/eventos/:publicId',
  entry = `/eventos/${event.publicId}`,
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createMemoryRouter(
    [
      { path, element: component },
      { path: '/recuperar', element: <p>Recuperação de acesso</p> },
      { path: '/inscricao/:id', element: <p>Inscrição criada</p> },
    ],
    { initialEntries: [entry] },
  );
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}
beforeEach(() => vi.resetAllMocks());
describe('Inscrição e pagamento', () => {
  it('exibe as imagens enviadas pelo organizador no link público do evento', async () => {
    vi.mocked(api).mockResolvedValue({
      ...event,
      logoImage: 'data:image/webp;base64,logo',
      bannerImage: 'data:image/webp;base64,banner',
    });
    show(<PublicEvent />);
    expect(
      await screen.findByAltText(`Logo do evento ${event.title}`),
    ).toBeTruthy();
    expect(screen.getByAltText(`Banner do evento ${event.title}`)).toBeTruthy();
  });
  it.each([null, '2026-10-26T12:00:00Z'])(
    'explica o cancelamento após reembolso sem oferecer nova solicitação: %s',
    async (cancellationRequestedAt) => {
      vi.mocked(api).mockResolvedValue({
        id: 'r',
        name: 'Ana',
        email: 'ana@exemplo.com',
        status: 'canceled',
        answers: {},
        priceInCents: 2500,
        reservationExpiresAt: '2030-10-08T15:00:00Z',
        cancellationRequestedAt,
        event: {
          title: 'Jornada',
          publicId: event.publicId,
          status: 'published',
        },
        payments: [
          {
            id: 'p',
            method: 'pix',
            installments: 1,
            status: 'refunded',
            amountInCents: 2500,
            checkout: { qrCode: 'pix-antigo' },
          },
        ],
      });
      show(<ParticipantPage />, '/acompanhar/:id', '/acompanhar/r');
      expect(await screen.findByText('Cancelada')).toBeTruthy();
      expect(
        screen.getByText(/Esta inscrição foi cancelada e não garante vaga/),
      ).toBeTruthy();
      expect(
        screen.getByText(/Este pagamento foi reembolsado pelo Mercado Pago/),
      ).toBeTruthy();
      expect(
        screen.queryByRole('button', { name: 'Solicitar cancelamento' }),
      ).toBeNull();
      expect(
        screen.queryByText(/Solicitação de cancelamento registrada/),
      ).toBeNull();
      expect(
        screen.queryByRole('button', { name: 'Revisar pagamento Pix' }),
      ).toBeNull();
      expect(screen.queryByText('pix-antigo')).toBeNull();
    },
  );
  it('mantém a confirmação quando outro pagamento continua aprovado após um reembolso', async () => {
    vi.mocked(api).mockResolvedValue({
      id: 'r',
      name: 'Ana',
      email: 'ana@exemplo.com',
      status: 'confirmed',
      answers: {},
      priceInCents: 2500,
      reservationExpiresAt: '2030-10-08T15:00:00Z',
      cancellationRequestedAt: null,
      event: {
        title: 'Jornada',
        publicId: event.publicId,
        status: 'published',
      },
      payments: [
        {
          id: 'p1',
          method: 'pix',
          installments: 1,
          status: 'refunded',
          amountInCents: 2500,
        },
        {
          id: 'p2',
          method: 'pix',
          installments: 1,
          status: 'approved',
          amountInCents: 2500,
        },
      ],
    });
    show(<ParticipantPage />, '/acompanhar/:id', '/acompanhar/r');
    expect(await screen.findByText('Confirmada')).toBeTruthy();
    expect(screen.getByText(/Sua vaga está garantida/)).toBeTruthy();
    expect(
      screen.getByText(/Este pagamento foi reembolsado pelo Mercado Pago/),
    ).toBeTruthy();
    expect(screen.queryByText(/Esta inscrição foi cancelada/)).toBeNull();
  });
  it('informa a abertura agendada sem exibir o formulário de inscrição', async () => {
    vi.mocked(api).mockResolvedValue({
      ...event,
      status: 'published',
      acceptingRegistrations: false,
      registrationStartsAt: '2099-01-01T12:00:00Z',
    });
    show(<PublicEvent />);
    expect(await screen.findByText(/As inscrições abrem em/)).toBeTruthy();
    expect(screen.queryByLabelText('Nome completo')).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });
  it('valida perguntas obrigatórias e mantém dados ao voltar da revisão', async () => {
    vi.mocked(api).mockResolvedValue(event);
    show(<PublicEvent />);
    const user = userEvent.setup();
    await screen.findByLabelText('Nome completo');
    await user.type(screen.getByLabelText('Nome completo'), 'Ana Silva');
    await user.type(screen.getByLabelText(/E-mail/), 'ana@exemplo.com');
    await user.click(screen.getByRole('button', { name: /Revisar minha/ }));
    expect(await screen.findByText('Preencha esta resposta.')).toBeTruthy();
    expect(send).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText(/Instituição/), 'Universidade');
    await user.click(screen.getByRole('button', { name: /Revisar minha/ }));
    await screen.findByText('Confira antes de continuar');
    await user.click(screen.getByRole('button', { name: 'Corrigir dados' }));
    expect(
      (screen.getByLabelText('Nome completo') as HTMLInputElement).value,
    ).toBe('Ana Silva');
    expect(
      (screen.getByLabelText(/Instituição/) as HTMLInputElement).value,
    ).toBe('Universidade');
  });
  it('preserva preenchimento após conflito de vagas e navega somente depois da reserva', async () => {
    vi.mocked(api).mockResolvedValue(event);
    vi.mocked(send)
      .mockRejectedValueOnce(new ApiError(409, 'Não há vagas.'))
      .mockResolvedValueOnce({ id: 'nova' });
    const router = show(<PublicEvent />);
    const user = userEvent.setup();
    await screen.findByLabelText('Nome completo');
    await user.type(screen.getByLabelText('Nome completo'), 'Ana Silva');
    await user.type(screen.getByLabelText(/E-mail/), 'ana@exemplo.com');
    await user.type(screen.getByLabelText(/Instituição/), 'Universidade');
    await user.click(screen.getByRole('button', { name: /Revisar minha/ }));
    await user.click(
      await screen.findByRole('button', { name: /Reservar e escolher/ }),
    );
    await screen.findByText('Não há vagas.');
    expect(router.state.location.pathname).toContain('/eventos/');
    await user.click(
      screen.getByRole('button', { name: /Reservar e escolher/ }),
    );
    await screen.findByText('Inscrição criada');
    expect(router.state.blockers.size).toBe(0);
    expect(vi.mocked(send).mock.calls[0][1]).toEqual({
      name: 'Ana Silva',
      email: 'ana@exemplo.com',
      answers: { instituicao: 'Universidade' }, registrationTypeId: 'geral',
    });
  });
  it('não apresenta pagamento pendente como inscrição confirmada', async () => {
    vi.mocked(api).mockResolvedValue({
      id: 'r',
      name: 'Ana',
      email: 'ana@exemplo.com',
      status: 'reserved',
      answers: {},
      priceInCents: 2500,
      reservationExpiresAt: '2030-10-08T15:00:00Z',
      event: {
        title: 'Jornada',
        publicId: event.publicId,
        status: 'published',
      },
      payments: [
        { id: 'p', method: 'pix', status: 'pending', amountInCents: 2500 },
      ],
    });
    show(<ParticipantPage />, '/acompanhar/:id', '/acompanhar/r');
    await screen.findByText('Pendente');
    expect(screen.queryByText(/vaga está garantida/)).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Revisar pagamento Pix' }),
    ).toBeNull();
  });
  it('repete exatamente a mesma tentativa e chave depois de falha de rede', async () => {
    const registration = {
      id: 'r',
      name: 'Ana',
      email: 'ana@exemplo.com',
      status: 'reserved',
      answers: {},
      priceInCents: 2500,
      reservationExpiresAt: '2030-10-08T15:00:00Z',
      event: {
        title: 'Jornada',
        publicId: event.publicId,
        status: 'published',
      },
      payments: [],
    };
    vi.mocked(api).mockImplementation(async (path) =>
      path.endsWith('/checkout')
        ? { publicKey: 'TEST', amountInCents: 2500, maxInstallments: 12 }
        : registration,
    );
    vi.mocked(send)
      .mockRejectedValueOnce(new TypeError('Falha de rede'))
      .mockResolvedValueOnce({ status: 'pending' });
    show(<ParticipantPage />, '/acompanhar/:id', '/acompanhar/r');
    const user = userEvent.setup();
    const name = await screen.findByLabelText('Nome completo do pagador');
    await user.clear(name);
    await user.type(name, 'Mariana Souza Oliveira');
    await user.type(
      await screen.findByLabelText(/CPF do pagador/),
      '12345678901',
    );
    await user.click(
      screen.getByRole('button', { name: 'Revisar pagamento Pix' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Confirmar pagamento' }),
    );
    await user.click(
      await screen.findByRole('button', { name: 'Repetir mesma tentativa' }),
    );
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(vi.mocked(send).mock.calls[0]).toEqual(
      vi.mocked(send).mock.calls[1],
    );
    expect(vi.mocked(send).mock.calls[0][1]).toMatchObject({
      payerName: 'Mariana Souza Oliveira',
      cpf: '12345678901',
    });
  });
  it('valida o nome no checkout e envia o pagador revisado também no cartão', async () => {
    const registration = {
      id: 'r',
      name: 'Ana Silva',
      email: 'ana@exemplo.com',
      status: 'reserved',
      answers: {},
      priceInCents: 2500,
      reservationExpiresAt: '2030-10-08T15:00:00Z',
      event: {
        title: 'Jornada',
        publicId: event.publicId,
        status: 'published',
      },
      payments: [],
    };
    vi.mocked(api).mockImplementation(async (path) =>
      path.endsWith('/checkout')
        ? { publicKey: 'TEST', amountInCents: 2500, maxInstallments: 12 }
        : registration,
    );
    vi.mocked(send).mockResolvedValue({ status: 'pending' });
    show(<ParticipantPage />, '/acompanhar/:id', '/acompanhar/r');
    const user = userEvent.setup();
    const name = await screen.findByLabelText('Nome completo do pagador');
    await user.clear(name);
    await user.click(
      screen.getByRole('button', { name: 'Revisar pagamento Pix' }),
    );
    await screen.findByText('Informe o nome completo do pagador.');
    expect(send).not.toHaveBeenCalled();
    await user.type(name, 'Bruno Souza Lima');
    await user.click(screen.getByRole('button', { name: /^Cartão$/ }));
    await user.click(
      await screen.findByRole('button', { name: 'Revisar cartão simulado' }),
    );
    await screen.findByText('Pagador: Bruno Souza Lima · CPF 123.456.789-09');
    expect(send).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole('button', { name: 'Confirmar pagamento' }),
    );
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(vi.mocked(send).mock.calls[0][1]).toMatchObject({
      method: 'card',
      payerName: 'Bruno Souza Lima',
      cpf: '12345678909',
      installments: 3,
    });
  });
});

describe('Preservação de preenchimento e tema', () => {
  it('restaura o foco e mantém dados e respostas ao cancelar a saída da inscrição', async () => {
    vi.mocked(api).mockResolvedValue(event);
    const router = show(<PublicEvent />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Nome completo'), 'Ana Silva');
    await user.type(screen.getByLabelText('E-mail'), 'ana@exemplo.com');
    await user.type(screen.getByLabelText('Instituição *'), 'FABA');
    const recovery = screen.getByRole('link', { name: /Já se inscreveu/ });
    await user.click(recovery);
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Sair sem concluir?',
    });
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
    const cancel = within(dialog).getByRole('button', { name: 'Continuar' });
    await waitFor(() => expect(document.activeElement).toBe(cancel));
    await user.click(cancel);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(recovery));
    expect(screen.getByLabelText('Nome completo')).toHaveProperty(
      'value',
      'Ana Silva',
    );
    expect(screen.getByLabelText('E-mail')).toHaveProperty(
      'value',
      'ana@exemplo.com',
    );
    expect(screen.getByLabelText('Instituição *')).toHaveProperty(
      'value',
      'FABA',
    );
    await user.click(recovery);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(router.state.location.pathname).toBe(`/eventos/${event.publicId}`);
    await user.click(recovery);
    await user.click(await screen.findByRole('button', { name: 'Sair' }));
    expect(await screen.findByText('Recuperação de acesso')).toBeTruthy();
    expect(router.state.location.search).toBe(`?evento=${event.publicId}`);
    expect(send).not.toHaveBeenCalled();
  });

  it('mantém o formulário do provedor montado e o pagador ao trocar o tema', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    localStorage.removeItem('ligahub:theme');
    const registration = {
      id: 'r',
      name: 'Ana Silva',
      email: 'ana@exemplo.com',
      status: 'reserved',
      answers: {},
      priceInCents: 2500,
      reservationExpiresAt: '2030-10-08T15:00:00Z',
      event: {
        title: 'Jornada',
        publicId: event.publicId,
        status: 'published',
      },
      payments: [],
    };
    vi.mocked(api).mockImplementation(async (path) =>
      path.endsWith('/checkout')
        ? { publicKey: 'TEST', amountInCents: 2500, maxInstallments: 12 }
        : registration,
    );
    try {
      show(
        <ThemeProvider>
          <ThemeToggle />
          <ParticipantPage />
        </ThemeProvider>,
        '/acompanhar/:id',
        '/acompanhar/r',
      );
      const user = userEvent.setup();
      const payer = await screen.findByLabelText('Nome completo do pagador');
      await user.clear(payer);
      await user.type(payer, 'Bruno Souza');
      await user.click(screen.getByRole('button', { name: /^Cartão$/ }));
      const sdk = await screen.findByRole('button', {
        name: 'Revisar cartão simulado',
      });
      expect(sdk.closest('.payment-sdk-light')).not.toBeNull();
      for (const theme of ['Escuro', 'Claro']) {
        await user.click(screen.getByRole('button', { name: /^Tema:/ }));
        await user.click(
          await screen.findByRole('menuitemradio', {
            name: theme,
          }),
        );
        expect(document.documentElement.classList.contains('dark')).toBe(
          theme === 'Escuro',
        );
        expect(
          screen.getByRole('button', { name: 'Revisar cartão simulado' }),
        ).toBe(sdk);
        expect(
          screen.getByLabelText('Nome completo do pagador'),
        ).toHaveProperty('value', 'Bruno Souza');
      }
      expect(send).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      localStorage.removeItem('ligahub:theme');
      document.documentElement.classList.remove('dark');
      document.documentElement.style.colorScheme = '';
    }
  });
});
