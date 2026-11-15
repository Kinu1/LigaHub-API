import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';
import type { AuthenticatedUser } from '../auth/auth.decorators.js';
import { PaymentAccountsService } from './payment-accounts.service.js';
import type { PaymentsService } from './payments.service.js';
import { PaymentsController } from './payments.controller.js';
import { ValidationPipe } from '@nestjs/common';
import { PaymentHistoryQuery } from './payment-history.query.js';
import type { PrismaService } from '../../prisma.service.js';
import type { PaymentGateway } from './payment.gateway.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

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
  it('volta ao Financeiro sem levar código, state ou credenciais na URL', async () => {
    vi.stubEnv('FRONTEND_URL', 'https://ligahub.example');
    const setup = fixture();
    vi.spyOn(setup.accounts, 'callback').mockResolvedValue({
      id: 'account',
      ownerId: actor.id,
      merchantId: 'merchant',
      publicKey: 'public-key',
      connected: true,
    });
    const response = { redirect: vi.fn() };
    await setup.controller.callback(
      'state-privado',
      'codigo-privado',
      undefined,
      response as unknown as Response,
    );
    expect(response.redirect).toHaveBeenCalledExactlyOnceWith(
      303,
      `https://ligahub.example/painel/financeiro?mercadoPago=connected&ownerId=${actor.id}`,
    );
  });
  it('trata falha do provedor sem expor seu conteúdo nem alterar a conexão anterior', async () => {
    vi.stubEnv('FRONTEND_URL', 'https://ligahub.example');
    const setup = fixture();
    vi.spyOn(setup.accounts, 'callback').mockRejectedValue(
      new Error('segredo-privado'),
    );
    const response = { redirect: vi.fn() };
    await setup.controller.callback(
      'state',
      'code',
      undefined,
      response as unknown as Response,
    );
    expect(response.redirect).toHaveBeenCalledExactlyOnceWith(
      303,
      'https://ligahub.example/painel/financeiro?mercadoPago=error',
    );
  });
  it('trata recusa antes de trocar o código OAuth', async () => {
    vi.stubEnv('FRONTEND_URL', 'https://ligahub.example');
    const setup = fixture();
    const callback = vi.spyOn(setup.accounts, 'callback');
    const response = { redirect: vi.fn() };
    await setup.controller.callback(
      'state',
      '',
      'access_denied',
      response as unknown as Response,
    );
    expect(callback).not.toHaveBeenCalled();
    expect(response.redirect).toHaveBeenCalledExactlyOnceWith(
      303,
      'https://ligahub.example/painel/financeiro?mercadoPago=canceled',
    );
  });
  it('recusa site de retorno inválido antes de consumir o estado', async () => {
    vi.stubEnv('FRONTEND_URL', 'https://user:secret@evil.example');
    const setup = fixture();
    const callback = vi.spyOn(setup.accounts, 'callback');
    await expect(
      setup.controller.callback('state', 'code', undefined, {} as Response),
    ).rejects.toThrow('Configure o endereço');
    expect(callback).not.toHaveBeenCalled();
  });
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
  it('deve recusar o parâmetro de página repetido no DTO da rota', async () => {
    const setup = fixture();
    const pipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    await expect(
      pipe.transform(
        { page: ['1', '2'] },
        { type: 'query', metatype: PaymentHistoryQuery },
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(setup.payments.history).not.toHaveBeenCalled();
  });
  it('delega página e filtros já validados sem alterar o formato legado', async () => {
    const setup = fixture();
    const query = Object.assign(new PaymentHistoryQuery(), {
      page: 2,
      method: 'card',
    });
    await setup.controller.history(actor, query);
    expect(setup.payments.history).toHaveBeenCalledExactlyOnceWith(
      actor,
      2,
      false,
      query,
    );
  });
});
