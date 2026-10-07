import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma.service.js';
import type { PaymentAccountsService } from './payment-accounts.service.js';
import type { PaymentGateway } from './payment.gateway.js';
import { digest, type ProviderPayment } from './payment-security.js';
import { PaymentsService } from './payments.service.js';

const input = { method: 'pix' as const, installments: 1, cpf: '12345678909' };
const fingerprint = digest(JSON.stringify({ method: 'pix', cardToken: null, paymentMethodId: null, issuerId: null, installments: 1, cpf: input.cpf }));

function fixture(capacity = 1, occupied = 0) {
  const attempt = { id: randomUUID(), registrationId: randomUUID(), accountId: randomUUID(), idempotencyKey: randomUUID(), requestHash: fingerprint, method: 'pix', installments: 1, amountInCents: 1025, status: 'created', statusDetail: null, providerPaymentId: null, providerUpdatedAt: null, checkout: null, createdAt: new Date(), updatedAt: new Date(), account: { merchantId: '456' }, registration: { eventId: randomUUID() } };
  const registration = { id: attempt.registrationId, manageTokenHash: digest('acesso-participante'), eventId: attempt.registration.eventId, status: 'reserved', suspendedAt: null, cancellationRequestedAt: null as Date | null, reservationExpiresAt: new Date(Date.now() + 60_000), event: { id: attempt.registration.eventId, status: 'published', startsAt: null, capacity, owner: { active: true } } };
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    paymentAttempt: { count: vi.fn().mockResolvedValue(0), findUnique: vi.fn().mockResolvedValue(attempt), findUniqueOrThrow: vi.fn().mockResolvedValue(attempt), update: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ ...attempt, ...data })) },
    registration: { findUniqueOrThrow: vi.fn().mockResolvedValue(registration), count: vi.fn().mockResolvedValue(occupied), update: vi.fn().mockResolvedValue(registration) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    registration: { findUnique: vi.fn().mockResolvedValue(registration) },
    paymentAttempt: { findUnique: vi.fn().mockResolvedValue(attempt) },
    $transaction: vi.fn().mockImplementation((callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
  };
  const accounts = { accessToken: vi.fn().mockResolvedValue('token') };
  const gateway = { createPayment: vi.fn(), searchPayment: vi.fn(), getPayment: vi.fn() };
  const service = new PaymentsService(prisma as unknown as PrismaService, gateway as unknown as PaymentGateway, accounts as unknown as PaymentAccountsService);
  const payment: ProviderPayment = { id: 123, external_reference: attempt.id, collector_id: 456, currency_id: 'BRL', transaction_amount: 10.25, status: 'approved', date_last_updated: new Date().toISOString(), payment_method_id: 'pix', payment_type_id: 'bank_transfer', installments: 1 };
  return { service, attempt, tx, prisma, registration, gateway, payment };
}

describe('PaymentsService', () => {
  it('deve recusar a mesma chave de idempotência com dados diferentes', async () => {
    const setup = fixture();
    await expect(setup.service.create(setup.registration.id, 'acesso-participante', setup.attempt.idempotencyKey, { ...input, cpf: '99999999999' })).rejects.toThrow('outros dados');
    expect(setup.gateway.createPayment).not.toHaveBeenCalled();
  });
  it('deve impedir que uma chave seja utilizada em outra inscrição', async () => {
    const setup = fixture();
    setup.attempt.registrationId = randomUUID();
    await expect(setup.service.create(setup.registration.id, 'acesso-participante', setup.attempt.idempotencyKey, input)).rejects.toThrow('outros dados');
  });
  it('deve retornar a tentativa concluída sem criar outra cobrança', async () => {
    const setup = fixture();
    setup.attempt.status = 'approved';
    const result = await setup.service.create(setup.registration.id, 'acesso-participante', setup.attempt.idempotencyKey, input);
    expect(result.status).toBe('approved');
    expect(setup.gateway.createPayment).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty('requestHash');
    expect(result).not.toHaveProperty('cpf');
    expect(result).not.toHaveProperty('cardToken');
  });
  it('deve negar a leitura da inscrição com token incorreto', async () => {
    const setup = fixture();
    await expect(setup.service.create(setup.registration.id, 'outro-token', setup.attempt.idempotencyKey, input)).rejects.toThrow('acesso à inscrição é inválido');
    expect(setup.prisma.$transaction).not.toHaveBeenCalled();
  });
  it('deve confirmar um pagamento aprovado sob o bloqueio do evento', async () => {
    const setup = fixture();
    await setup.service.applyPayment(setup.attempt.id, setup.payment);
    expect(setup.tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(setup.tx.registration.update).toHaveBeenCalledWith({ where: { id: setup.registration.id }, data: { status: 'confirmed' } });
  });
  it('deve encaminhar um pagamento tardio para revisão quando não houver vaga', async () => {
    const setup = fixture(1, 1);
    setup.registration.status = 'expired';
    await setup.service.applyPayment(setup.attempt.id, setup.payment);
    expect(setup.tx.registration.update).toHaveBeenCalledWith({ where: { id: setup.registration.id }, data: { status: 'payment_review' } });
  });
  it('deve encaminhar para revisão um pagamento de inscrição suspensa', async () => {
    const setup = fixture();
    setup.tx.registration.findUniqueOrThrow.mockResolvedValue({ ...setup.registration, suspendedAt: new Date() });
    await setup.service.applyPayment(setup.attempt.id, setup.payment);
    expect(setup.tx.registration.update).toHaveBeenCalledWith({ where: { id: setup.registration.id }, data: { status: 'payment_review' } });
  });
  it('não deve atualizar uma inscrição com pagamento de outro recebedor', async () => {
    const setup = fixture();
    await expect(setup.service.applyPayment(setup.attempt.id, { ...setup.payment, collector_id: 999 })).rejects.toThrow('não corresponde');
    expect(setup.tx.registration.update).not.toHaveBeenCalled();
  });
  it('não deve confirmar pagamento com valor divergente', async () => {
    const setup = fixture();
    await expect(setup.service.applyPayment(setup.attempt.id, { ...setup.payment, transaction_amount: 9 })).rejects.toThrow('não corresponde');
    expect(setup.tx.registration.update).not.toHaveBeenCalled();
  });
  it('não deve reaplicar uma atualização de pagamento já processada', async () => {
    const setup = fixture();
    setup.tx.paymentAttempt.findUniqueOrThrow.mockResolvedValue({ ...setup.attempt, providerUpdatedAt: new Date(setup.payment.date_last_updated) });
    await setup.service.applyPayment(setup.attempt.id, setup.payment);
    expect(setup.tx.paymentAttempt.update).not.toHaveBeenCalled();
    expect(setup.tx.registration.update).not.toHaveBeenCalled();
  });
  it('deve encaminhar para revisão a aprovação quando o responsável estiver suspenso', async () => {
    const setup = fixture();
    setup.registration.event.owner.active = false;
    await setup.service.applyPayment(setup.attempt.id, setup.payment);
    expect(setup.tx.registration.update).toHaveBeenCalledWith({ where: { id: setup.registration.id }, data: { status: 'payment_review' } });
  });
  it('não deve cancelar a inscrição ao devolver uma tentativa quando outra continua aprovada', async () => {
    const setup = fixture();
    setup.registration.status = 'confirmed';
    setup.tx.paymentAttempt.count.mockResolvedValue(1);
    await setup.service.applyPayment(setup.attempt.id, { ...setup.payment, status: 'refunded' });
    expect(setup.tx.registration.update).not.toHaveBeenCalled();
  });
  it('deve cancelar a inscrição após devolução sem outra tentativa aprovada', async () => {
    const setup = fixture();
    setup.registration.status = 'confirmed';
    await setup.service.applyPayment(setup.attempt.id, { ...setup.payment, status: 'refunded' });
    expect(setup.tx.registration.update).toHaveBeenCalledWith({ where: { id: setup.registration.id }, data: { status: 'canceled' } });
  });
  it('deve recusar parcelas diferentes das autorizadas na tentativa', async () => {
    const setup = fixture();
    await expect(setup.service.applyPayment(setup.attempt.id, { ...setup.payment, installments: 2 })).rejects.toThrow('parcelas não correspondem');
    expect(setup.tx.registration.update).not.toHaveBeenCalled();
  });
  it('deve impedir uma nova cobrança quando o participante pediu cancelamento', async () => {
    const setup = fixture();
    setup.registration.cancellationRequestedAt = new Date();
    setup.tx.paymentAttempt.findUnique.mockResolvedValue(null);
    await expect(setup.service.create(setup.registration.id, 'acesso-participante', setup.attempt.idempotencyKey, input)).rejects.toThrow('A inscrição não está disponível para pagamento.');
    expect(setup.gateway.createPayment).not.toHaveBeenCalled();
  });
  it('deve encaminhar uma aprovação para revisão quando houver pedido de cancelamento', async () => {
    const setup = fixture();
    setup.registration.cancellationRequestedAt = new Date();
    await setup.service.applyPayment(setup.attempt.id, setup.payment);
    expect(setup.tx.registration.update).toHaveBeenCalledWith({ where: { id: setup.registration.id }, data: { status: 'payment_review' } });
  });
  it('deve preservar a confirmação existente apesar do pedido de cancelamento', async () => {
    const setup = fixture();
    setup.registration.status = 'confirmed';
    setup.registration.cancellationRequestedAt = new Date();
    await setup.service.applyPayment(setup.attempt.id, setup.payment);
    expect(setup.tx.registration.update).not.toHaveBeenCalled();
  });
});
