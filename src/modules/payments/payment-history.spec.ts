import { afterEach, describe, expect, it, vi } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PaymentsService } from './payments.service.js';
import { CreatePaymentDto } from './payment.dto.js';
import type { PrismaService } from '../../prisma.service.js';
import type { PaymentAccountsService } from './payment-accounts.service.js';
import type { PaymentGateway } from './payment.gateway.js';

afterEach(() => vi.restoreAllMocks());
describe('Histórico privado de pagamentos', () => {
  it('mantém acesso administrativo e aplica o mesmo escopo do organizador aos registros e à contagem', async () => {
    const prisma = {
      paymentAttempt: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
    };
    const service = new PaymentsService(
      prisma as unknown as PrismaService,
      {} as PaymentGateway,
      {} as PaymentAccountsService,
    );
    const actor = {
      id: 'organizer',
      name: 'Organizador',
      email: 'owner@example.test',
      role: 'organizer' as const,
    };
    expect(await service.history(actor, 2, true)).toEqual({
      items: [],
      total: 0,
      page: 2,
      limit: 50,
    });
    const where = { AND: [{ registration: { event: { ownerId: actor.id } } }] };
    expect(prisma.paymentAttempt.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where, skip: 50, take: 50 }),
    );
    expect(prisma.paymentAttempt.count).toHaveBeenLastCalledWith({ where });
    await service.history({ ...actor, role: 'admin' }, 1, true);
    expect(prisma.paymentAttempt.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { AND: [{}] } }),
    );
    expect(prisma.paymentAttempt.count).toHaveBeenLastCalledWith({
      where: { AND: [{}] },
    });
  });

  it('valida e normaliza o nome no servidor e conserva compatibilidade com clientes anteriores', async () => {
    const input = { method: 'pix', cpf: '12345678909', installments: 1 };
    for (const payerName of ['', ' ', 'A', 'A'.repeat(121), 123]) {
      const errors = await validate(
        plainToInstance(CreatePaymentDto, { ...input, payerName }),
      );
      expect(errors.some((error) => error.property === 'payerName')).toBe(true);
    }
    const dto = plainToInstance(CreatePaymentDto, {
      ...input,
      payerName: '  Mariana Souza Oliveira  ',
    });
    expect(dto.payerName).toBe('Mariana Souza Oliveira');
    expect(await validate(dto)).toEqual([]);
    expect(await validate(plainToInstance(CreatePaymentDto, input))).toEqual(
      [],
    );
  });
});
