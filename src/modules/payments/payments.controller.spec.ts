import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../auth/auth.decorators.js';
import { PaymentAccountsService } from './payment-accounts.service.js';
import type { PaymentsService } from './payments.service.js';
import { PaymentsController } from './payments.controller.js';
import type { PrismaService } from '../../prisma.service.js';
import type { PaymentGateway } from './payment.gateway.js';

describe('Entradas dos endpoints de pagamento', () => {
  const actor: AuthenticatedUser = {
    id: randomUUID(),
    name: 'Administrador',
    email: 'admin@ligahub.test',
    role: 'admin',
  };
  function fixture() {
    const payments = { webhook: vi.fn(), history: vi.fn() };
    const accounts = new PaymentAccountsService(
      {} as PrismaService,
      {} as PaymentGateway,
    );
    return {
      controller: new PaymentsController(
        payments as unknown as PaymentsService,
        accounts,
      ),
      payments,
      accounts,
    };
  }
  it.each([null, [], 'conteúdo'])(
    'deve recusar um corpo de webhook inválido: %j',
    (body) => {
      const setup = fixture();
      expect(() =>
        setup.controller.webhook('assinatura', 'pedido', '123', body),
      ).toThrow('O conteúdo da notificação é inválido.');
      expect(setup.payments.webhook).not.toHaveBeenCalled();
    },
  );
  it('deve recusar um identificador de webhook estruturado como objeto', () => {
    const setup = fixture();
    expect(() =>
      setup.controller.webhook('assinatura', 'pedido', '123', {
        data: { id: {} },
      }),
    ).toThrow('O identificador da notificação é inválido.');
  });
  it('deve recusar parâmetros OAuth repetidos sem consultar o banco', async () => {
    const setup = fixture();
    await expect(
      setup.accounts.callback(
        ['primeiro', 'segundo'] as unknown as string,
        'codigo',
      ),
    ).rejects.toThrow('A autorização de pagamento é inválida.');
  });
  it('deve recusar o responsável informado com UUID inválido', async () => {
    const setup = fixture();
    await expect(setup.accounts.status(actor, 'invalido')).rejects.toThrow(
      'O responsável informado é inválido.',
    );
  });
  it('deve recusar o parâmetro de página repetido', () => {
    const setup = fixture();
    expect(() =>
      setup.controller.history(actor, ['1', '2'] as unknown as string),
    ).toThrow('A página informada é inválida.');
    expect(setup.payments.history).not.toHaveBeenCalled();
  });
});
