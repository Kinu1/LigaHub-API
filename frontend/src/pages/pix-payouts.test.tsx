import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import axe from 'axe-core';
import { PixPayoutSection } from './pix-payouts';
import { api, send } from '../api';

vi.mock('../api', () => ({ api: vi.fn(), send: vi.fn() }));
const auth = vi.hoisted(() => ({ user: { id: 'owner', role: 'organizer' } }));
vi.mock('../auth', () => ({ useAuth: () => auth }));
function show() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <PixPayoutSection />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  auth.user = { id: 'owner', role: 'organizer' };
  vi.mocked(api).mockImplementation(async (path) =>
    path.startsWith('/payments/payouts')
      ? { items: [], total: 0 }
      : {
          platformPix: true,
          automaticPayoutsEnabled: false,
          destination: null,
        },
  );
  vi.mocked(send).mockResolvedValue({ saved: true });
});
afterEach(() => vi.restoreAllMocks());
describe('Recebimento e repasse Pix', () => {
  it('cadastra chave sem aprovar por conta própria e explica o valor integral e a ativação pendente', async () => {
    const user = userEvent.setup();
    const view = show();
    await screen.findByText(/As tarifas ficam por conta da plataforma/);
    expect(screen.getByText(/ainda não estão ativados/)).toBeTruthy();
    await user.selectOptions(
      screen.getByLabelText('Tipo de chave Pix'),
      'EMAIL',
    );
    await user.type(
      screen.getByLabelText('Chave Pix'),
      'organizador@example.test',
    );
    await user.click(screen.getByRole('button', { name: 'Salvar chave Pix' }));
    expect(send).toHaveBeenCalledWith(
      '/payments/pix-destination',
      { keyType: 'EMAIL', key: 'organizador@example.test' },
      'PUT',
    );
    await screen.findByText('Chave salva. Aguarde a aprovação da plataforma.');
    expect(screen.queryByRole('button', { name: /Aprovar/ })).toBeNull();
    expect(
      (
        await axe.run(view.container, {
          rules: { 'color-contrast': { enabled: false } },
        })
      ).violations,
    ).toEqual([]);
  });
  it('permite ao administrador conferir e aprovar a versão da chave selecionada', async () => {
    auth.user = { id: 'admin', role: 'admin' };
    vi.mocked(api).mockImplementation(async (path) =>
      path === '/users'
        ? [
            {
              id: 'owner',
              role: 'organizer',
              active: true,
              name: 'Organizador',
            },
          ]
        : path.startsWith('/payments/payouts')
          ? { items: [], total: 0 }
          : {
              platformPix: true,
              automaticPayoutsEnabled: true,
              destination: path.includes('ownerId=owner')
                ? {
                    id: 'version-one',
                    ownerId: 'owner',
                    keyType: 'EMAIL',
                    key: 'organizador@example.test',
                    approved: false,
                  }
                : null,
            },
    );
    const user = userEvent.setup();
    show();
    await user.selectOptions(
      await screen.findByLabelText('Organizador do recebimento'),
      'owner',
    );
    await user.click(
      await screen.findByRole('button', {
        name: 'Aprovar chave Pix conferida',
      }),
    );
    expect(send).toHaveBeenCalledWith('/payments/pix-destination/approval', {
      ownerId: 'owner',
      destinationId: 'version-one',
    });
  });
  it('distingue crédito bancário de processamento e de resultado incerto', async () => {
    vi.mocked(api).mockImplementation(async (path) =>
      path.startsWith('/payments/payouts')
        ? {
            items: ['processing', 'paid', 'unknown'].map((status, index) => ({
              id: String(index),
              registrationId: String(index),
              amountInCents: 1055,
              createdAt: '2026-11-15T12:00:00Z',
              status,
            })),
            total: 3,
          }
        : {
            platformPix: true,
            automaticPayoutsEnabled: true,
            destination: null,
          },
    );
    show();
    await screen.findByText('Creditado ao organizador');
    expect(screen.getByText('Aguardando confirmação do banco')).toBeTruthy();
    expect(
      screen.getByText('Resultado incerto — revisão necessária'),
    ).toBeTruthy();
  });
});
