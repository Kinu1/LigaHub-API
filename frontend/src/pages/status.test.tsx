import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusPage } from './public';
import { api, ApiError } from '../api';
import { forgetAccessFragment } from '../access-fragment';

vi.mock('../api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../api')>();
  return { ...original, api: vi.fn() };
});

const suspendedNotice =
  'Sua inscrição está suspensa. Entre em contato com a organização do evento.';
const cancellationNotice =
  'O cancelamento da sua inscrição foi solicitado. Entre em contato com a organização para acompanhar a solicitação.';

function show() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(
    [{ path: '/inscricoes/:id', element: <StatusPage /> }],
    { initialEntries: ['/inscricoes/consulta'] },
  );
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  history.replaceState(null, '', '/inscricoes/consulta');
  forgetAccessFragment('token');
  history.replaceState(
    null,
    '',
    '/inscricoes/consulta#token=token-de-consulta',
  );
});

afterEach(() => {
  forgetAccessFragment('token');
  history.replaceState(null, '', '/');
});

describe('Consulta da inscrição pelo link do e-mail', () => {
  it.each([false, true])(
    'mostra cancelamento concluído sem aviso de solicitação pendente: %s',
    async (cancellationRequested) => {
      vi.mocked(api).mockResolvedValue({
        name: 'Ana Silva',
        status: 'canceled',
        suspended: false,
        cancellationRequested,
        event: {
          title: 'Jornada acadêmica',
          location: 'Auditório',
          startsAt: '2030-10-08T15:00:00Z',
        },
      });
      show();
      expect(await screen.findByText('Cancelada')).toBeTruthy();
      expect(
        screen.getByText(/Sua inscrição foi cancelada e não garante vaga/),
      ).toBeTruthy();
      expect(screen.queryByText(cancellationNotice)).toBeNull();
      expect(screen.queryByText(/pagamento foi reembolsado/)).toBeNull();
    },
  );
  it.each([
    { suspended: false, cancellationRequested: false },
    { suspended: true, cancellationRequested: false },
    { suspended: false, cancellationRequested: true },
    { suspended: true, cancellationRequested: true },
  ])(
    'mostra os avisos conforme suspensão=$suspended e cancelamento=$cancellationRequested',
    async ({ suspended, cancellationRequested }) => {
      vi.mocked(api).mockResolvedValue({
        name: 'Ana Silva',
        status: 'confirmed',
        suspended,
        cancellationRequested,
        event: {
          title: 'Jornada acadêmica',
          location: 'Auditório',
          startsAt: '2030-10-08T15:00:00Z',
        },
      });
      show();

      expect(await screen.findByText('Confirmada')).toBeTruthy();
      expect(screen.getByText('Olá, Ana Silva.')).toBeTruthy();
      expect(Boolean(screen.queryByText(suspendedNotice))).toBe(suspended);
      expect(Boolean(screen.queryByText(cancellationNotice))).toBe(
        cancellationRequested,
      );
      expect(screen.queryAllByRole('alert')).toHaveLength(
        Number(suspended) + Number(cancellationRequested),
      );
      expect(api).toHaveBeenCalledWith(
        '/public/registrations/consulta/status',
        {
          headers: { 'x-registration-status-token': 'token-de-consulta' },
        },
      );
      expect(location.hash).toBe('');
    },
  );

  it('oferece recuperação quando o link é inválido ou expirou', async () => {
    vi.mocked(api).mockRejectedValue(
      new ApiError(401, 'O link de consulta é inválido ou expirou.'),
    );
    show();
    expect(
      await screen.findByText('O link de consulta é inválido ou expirou.'),
    ).toBeTruthy();
    expect(
      screen
        .getByRole('link', { name: 'Solicitar novo link' })
        .getAttribute('href'),
    ).toBe('/recuperar');
    expect(screen.queryByText('Confirmada')).toBeNull();
  });

  it('não consulta a API sem token e oferece recuperação do acesso', () => {
    history.replaceState(null, '', '/inscricoes/consulta');
    show();
    expect(screen.getByRole('link', { name: 'Solicitar link' })).toBeTruthy();
    expect(api).not.toHaveBeenCalled();
  });
});
