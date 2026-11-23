import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ManualPayout } from './manual-payout';
import { api, send } from '../api';
import axe from 'axe-core';
vi.mock('../api', () => ({ api: vi.fn(), send: vi.fn() }));
const auth = vi.hoisted(() => ({ user: { id: 'admin', role: 'admin' } }));
vi.mock('../auth', () => ({ useAuth: () => auth }));
const details = {
  id: 'payout',
  keyType: 'EMAIL',
  key: 'org@example.test',
  amountInCents: 1055,
  receiptId: null,
  paidAt: null,
};
const show = (status = 'pending', reservedBy?: string) =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ManualPayout
        payout={{ id: 'payout', status, manualReservedBy: reservedBy }}
      />
    </QueryClientProvider>,
  );
beforeEach(() => {
  vi.resetAllMocks();
  auth.user = { id: 'admin', role: 'admin' };
  vi.mocked(send).mockResolvedValue(details);
});
describe('Registro de repasse manual', () => {
  it('reserva e exige confirmação de envio antes de registrar o comprovante', async () => {
    const user = userEvent.setup();
    const view = show();
    await user.click(
      screen.getByRole('button', { name: 'Reservar e visualizar repasse' }),
    );
    expect(send).toHaveBeenCalledWith(
      '/payments/payouts/payout/manual-reservation',
    );
    await screen.findByText(/org@example.test/);
    expect(
      screen
        .getByRole('button', { name: 'Registrar repasse realizado' })
        .hasAttribute('disabled'),
    ).toBe(true);
    await user.type(
      screen.getByLabelText('ID da transação no comprovante'),
      'BANCO-TESTE-01',
    );
    await user.click(screen.getByRole('checkbox', { name: /Já transferi/ }));
    await user.click(
      screen.getByRole('button', { name: 'Registrar repasse realizado' }),
    );
    expect(send).toHaveBeenLastCalledWith(
      '/payments/payouts/payout/manual-confirmation',
      {
        receiptId: 'BANCO-TESTE-01',
        paidAt: expect.any(String),
        amountInCents: 1055,
      },
    );
    expect(
      (
        await axe.run(view.container, {
          rules: { 'color-contrast': { enabled: false } },
        })
      ).violations,
    ).toEqual([]);
  });
  it('não permite que o organizador marque repasses como pagos', () => {
    auth.user = { id: 'organizer', role: 'organizer' };
    show();
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('exibe a referência informada sem afirmar confirmação bancária automática', async () => {
    vi.mocked(api).mockResolvedValue({
      ...details,
      receiptId: 'BANCO-TESTE-01',
      paidAt: '2026-11-15T12:00:00Z',
    });
    const user = userEvent.setup();
    show('manual_paid');
    await user.click(
      screen.getByRole('button', { name: 'Ver registro do comprovante' }),
    );
    await screen.findByText(/ID da transação: BANCO-TESTE-01/);
    expect(
      screen.getByText(/não é uma confirmação bancária automática/),
    ).toBeTruthy();
    expect(send).not.toHaveBeenCalled();
  });
  it('não inicia outro envio quando há uma reserva de outro administrador', () => {
    show('manual_reserved', 'outro-admin');
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(/reservado por um administrador/)).toBeTruthy();
  });
});
