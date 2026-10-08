import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PublicEvent, ParticipantPage } from './public';
import { api, send, ApiError } from '../api';
vi.mock('../api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../api')>();
  return { ...original, api: vi.fn(), send: vi.fn() };
});
vi.mock('@mercadopago/sdk-react', () => ({
  initMercadoPago: vi.fn(),
  CardPayment: () => null,
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
      answers: { instituicao: 'Universidade' },
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
  });
});
