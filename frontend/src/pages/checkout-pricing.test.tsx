import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import axe from 'axe-core';
import { Checkout } from './checkout';
import { api, send, ApiError } from '../api';
import type { PaymentPricing, Registration } from '../types';
vi.mock('../api', async (original) => ({
  ...(await original<typeof import('../api')>()),
  api: vi.fn(),
  send: vi.fn(),
}));
const registration = {
  id: 'registration-test',
  name: 'Pessoa Teste',
  email: 'teste@example.test',
  cpf: '12345678909',
  priceInCents: 1000,
} as Registration;
let pricing: PaymentPricing & { pricingToken: string };
function show() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <Checkout
        registration={registration}
        refresh={vi.fn().mockResolvedValue(undefined)}
      />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  pricing = {
    registrationAmountInCents: 1000,
    platformFeeInCents: 100,
    processingFeeInCents: 11,
    totalInCents: 1111,
    pricingToken: 'a'.repeat(64),
  };
  vi.mocked(api).mockImplementation(async () => ({
    publicKey: 'TEST',
    amountInCents: 1000,
    maxInstallments: 1,
    allowedMethods: ['pix'],
    pixPricing: { ...pricing },
  }));
  vi.mocked(send).mockResolvedValue({ status: 'pending' });
});
describe('Clareza das taxas no Pix', () => {
  it('exibe as três parcelas e o total antes de revisar, exige confirmação e envia a cotação ao servidor', async () => {
    const user = userEvent.setup();
    const view = show();
    await screen.findByText('Taxa de serviço LigaHub');
    expect(
      screen.getByText('Tarifa de processamento Mercado Pago'),
    ).toBeTruthy();
    expect(screen.getByText(/11,11/)).toBeTruthy();
    expect(screen.getByText(/pagas pelo participante/)).toBeTruthy();
    expect(send).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole('button', { name: 'Revisar pagamento Pix' }),
    );
    expect(
      screen.getByRole('heading', { name: 'Revise o pagamento' }),
    ).toBeTruthy();
    expect(send).not.toHaveBeenCalled();
    expect(
      (
        await axe.run(view.container, {
          rules: { 'color-contrast': { enabled: false } },
        })
      ).violations,
    ).toEqual([]);
    await user.click(
      screen.getByRole('button', { name: 'Confirmar pagamento' }),
    );
    expect(send).toHaveBeenCalledWith(
      '/public/registrations/registration-test/payments',
      expect.objectContaining({
        method: 'pix',
        pixPricingToken: 'a'.repeat(64),
      }),
      'POST',
      expect.any(Object),
    );
    expect(vi.mocked(send).mock.calls[0][1]).not.toHaveProperty(
      'amountInCents',
    );
  });
  it('mostra tarifa de processamento zero quando a conta é isenta', async () => {
    pricing = { ...pricing, processingFeeInCents: 0, totalInCents: 1100 };
    show();
    await screen.findByText(/11,00/);
    expect(screen.getByText(/^R\$\s0,00$/)).toBeTruthy();
  });
  it('exige nova revisão depois de uma alteração de tarifa e não repete cobrança automaticamente', async () => {
    const user = userEvent.setup();
    show();
    await user.click(
      await screen.findByRole('button', { name: 'Revisar pagamento Pix' }),
    );
    vi.mocked(send).mockImplementation(async () => {
      pricing = {
        ...pricing,
        processingFeeInCents: 22,
        totalInCents: 1122,
        pricingToken: 'b'.repeat(64),
      };
      throw new ApiError(409, 'Os valores do Pix precisam ser revisados.');
    });
    await user.click(
      screen.getByRole('button', { name: 'Confirmar pagamento' }),
    );
    await screen.findByText(/11,22/);
    expect(send).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('button', { name: 'Revisar pagamento Pix' }),
    ).toBeTruthy();
  });
});
