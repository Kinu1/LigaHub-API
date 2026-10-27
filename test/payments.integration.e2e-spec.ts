import type { AccessEmailProcessor } from '../src/modules/notifications/access-email.processor.js';
import { createHmac, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../src/prisma.service.js';
import { PaymentsService } from '../src/modules/payments/payments.service.js';
import type { PaymentAccountsService } from '../src/modules/payments/payment-accounts.service.js';
import type { PaymentGateway } from '../src/modules/payments/payment.gateway.js';
import {
  decryptCredential,
  encryptCredential,
} from '../src/modules/payments/payment-security.js';
import { EmailOutboxService } from '../src/modules/notifications/email-outbox.service.js';
import type { EmailGateway } from '../src/modules/notifications/email.gateway.js';
import { RegistrationsService } from '../src/modules/registrations/registrations.service.js';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import {
  digest,
  type ProviderPayment,
} from '../src/modules/payments/payment-security.js';

const pixInput = {
  method: 'pix' as const,
  installments: 1,
  cpf: '12345678909',
};
const requestHash = digest(
  JSON.stringify({
    method: 'pix',
    cardToken: null,
    paymentMethodId: null,
    issuerId: null,
    installments: 1,
    cpf: pixInput.cpf,
  }),
);

describe('Pagamentos: consistência com PostgreSQL e provedor simulado', () => {
  let prisma: PrismaService;
  let service: PaymentsService;
  let ownerId: string;
  let eventId: string;
  let registrationId: string;
  let accountId: string;
  let attemptId: string;
  let key: string;
  const gateway = {
    createPayment: vi.fn(),
    getPayment: vi.fn(),
    searchPayment: vi.fn(),
  };
  const accounts = { accessToken: vi.fn().mockResolvedValue('token-simulado') };
  const actor = () => ({
    id: ownerId,
    name: 'Dono teste',
    email: 'owner@test.com',
    role: 'organizer' as const,
  });
  it('filtra antes de paginar e contar, com limites de data e isolamento do organizador', async () => {
    const start = '2026-10-27T03:00:00Z',
      end = '2026-10-28T03:00:00Z';
    await prisma.academicEvent.update({
      where: { id: eventId },
      data: { title: 'Jornada financeira' },
    });
    await prisma.paymentAttempt.update({
      where: { id: attemptId },
      data: {
        status: 'approved',
        method: 'card',
        installments: 3,
        createdAt: new Date(start),
      },
    });
    await prisma.paymentAttempt.createMany({
      data: Array.from({ length: 52 }, (_, index) => ({
        registrationId,
        accountId,
        idempotencyKey: randomUUID(),
        requestHash: 'filtro-ficticio',
        method: 'card',
        installments: 3,
        amountInCents: 1000,
        status: 'approved',
        createdAt: new Date(
          index === 50
            ? end
            : index === 51
              ? '2026-10-27T02:59:59.999Z'
              : '2026-10-27T12:00:00Z',
        ),
      })),
    });
    const filters = {
      eventId,
      eventSearch: 'JORNADA',
      status: 'approved',
      method: 'card',
      from: start,
      to: end,
    };
    const first = await service.history(actor(), 1, true, filters);
    const second = await service.history(actor(), 2, true, filters);
    expect(first).toMatchObject({ total: 51, page: 1, limit: 50 });
    expect(second).toMatchObject({
      total: 51,
      page: 2,
      items: [
        { id: attemptId, event: { id: eventId, title: 'Jornada financeira' } },
      ],
    });
    if (Array.isArray(first) || Array.isArray(second))
      throw new Error('Esperava paginação.');
    expect(first.items).toHaveLength(50);
    expect(
      new Set([...first.items, ...second.items].map((item) => item.id)).size,
    ).toBe(51);
    expect(first.items.map((item) => item.id)).toEqual(
      first.items
        .map((item) => item.id)
        .sort()
        .reverse(),
    );
    expect(first.items[0]).not.toHaveProperty('payerEncrypted');
    expect(first.items[0]).not.toHaveProperty('account');
    expect(
      await service.history({ ...actor(), id: randomUUID() }, 1, true, filters),
    ).toMatchObject({ items: [], total: 0 });
    expect(
      await service.history({ ...actor(), role: 'admin' }, 1, true, filters),
    ).toMatchObject({ total: 51 });
    expect(
      await service.history(actor(), 1, true, { ...filters, method: 'pix' }),
    ).toMatchObject({ total: 0 });
    expect(
      await service.history(actor(), 1, true, {
        ...filters,
        status: 'refunded',
      }),
    ).toMatchObject({ total: 0 });
    expect(
      await service.history(actor(), 1, true, {
        ...filters,
        eventId: randomUUID(),
      }),
    ).toMatchObject({ total: 0 });
    const legacy = await service.history(actor(), 2, false, filters);
    expect(Array.isArray(legacy)).toBe(true);
    expect(legacy).toHaveLength(1);
  });
  async function reviewFixture() {
    const verified = payment({
      id: '123456',
      date_last_updated: new Date(Date.now() - 1000).toISOString(),
    });
    await prisma.registration.update({
      where: { id: registrationId },
      data: { status: 'payment_review', reviewReason: 'capacity_full' },
    });
    await prisma.paymentAttempt.update({
      where: { id: attemptId },
      data: {
        status: 'approved',
        providerPaymentId: '123456',
        providerUpdatedAt: new Date(verified.date_last_updated),
      },
    });
    gateway.getPayment.mockResolvedValue(verified);
    return verified;
  }
  it('organizador dono confirma e legado mantém motivo ausente na auditoria', async () => {
    const verified = await reviewFixture();
    const existing = await prisma.user.findFirst({
      where: { role: 'organizer' },
    });
    const organizer =
      existing ??
      (await prisma.user.create({
        data: {
          id: randomUUID(),
          name: 'Organizador',
          email: `${randomUUID()}@test.com`,
          role: 'organizer',
          passwordHash: 'fake',
        },
      }));
    try {
      await prisma.academicEvent.update({
        where: { id: eventId },
        data: { ownerId: organizer.id },
      });
      await prisma.registration.update({
        where: { id: registrationId },
        data: { reviewReason: null },
      });
      // Uma nova aprovação não inventa motivo legado nem confirma a revisão automaticamente.
      await service.applyPayment(attemptId, {
        ...verified,
        date_last_updated: new Date().toISOString(),
      });
      expect(
        await prisma.registration.findUniqueOrThrow({
          where: { id: registrationId },
        }),
      ).toMatchObject({ status: 'payment_review', reviewReason: null });
      gateway.getPayment.mockResolvedValue({
        ...verified,
        date_last_updated: new Date(Date.now() + 100).toISOString(),
      });
      await service.confirmPaymentReview(registrationId, {
        ...actor(),
        id: organizer.id,
      });
      expect(
        await prisma.auditLog.findFirst({
          where: {
            entityId: registrationId,
            action: 'registration.payment_review_confirmed',
          },
        }),
      ).toMatchObject({
        actorId: organizer.id,
        metadata: { reason: 'reason_not_recorded' },
      });
    } finally {
      await prisma.academicEvent.update({
        where: { id: eventId },
        data: { ownerId },
      });
      await prisma.auditLog.deleteMany({
        where: { actorId: organizer.id, entityId: registrationId },
      });
      if (!existing) await prisma.user.delete({ where: { id: organizer.id } });
    }
  });
  it.each(['refunded', 'charged_back'])(
    'não ressuscita pagamento terminal persistido %s',
    async (status) => {
      await reviewFixture();
      await prisma.paymentAttempt.update({
        where: { id: attemptId },
        data: { status },
      });
      await expect(
        service.confirmPaymentReview(registrationId, actor()),
      ).rejects.toThrow('único');
      expect(gateway.getPayment).not.toHaveBeenCalled();
      expect(
        await prisma.emailOutbox.count({ where: { registrationId } }),
      ).toBe(0);
    },
  );
  it('reavalia com autorização, resposta segura e uma única auditoria/outbox', async () => {
    await reviewFixture();
    const result = await service.confirmPaymentReview(registrationId, actor());
    expect(result).toEqual({
      id: registrationId,
      status: 'confirmed',
      reviewReason: null,
    });
    expect(await service.confirmPaymentReview(registrationId, actor())).toEqual(
      result,
    );
    expect(gateway.getPayment).toHaveBeenCalledTimes(1);
    expect(gateway.createPayment).not.toHaveBeenCalled();
    expect(await prisma.emailOutbox.count({ where: { registrationId } })).toBe(
      1,
    );
    const audits = await prisma.auditLog.findMany({
      where: {
        entityId: registrationId,
        action: 'registration.payment_review_confirmed',
      },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorId: ownerId,
      metadata: { paymentId: attemptId, reason: 'capacity_full' },
    });
  });
  it('organizador alheio e ator inexistente não consultam o gateway', async () => {
    await reviewFixture();
    const existing = await prisma.user.findFirst({
      where: { role: 'organizer' },
    });
    const stranger =
      existing ??
      (await prisma.user.create({
        data: {
          id: randomUUID(),
          name: 'Outro',
          email: `${randomUUID()}@test.com`,
          role: 'organizer',
          passwordHash: 'fake',
        },
      }));
    try {
      await expect(
        service.confirmPaymentReview(registrationId, {
          ...actor(),
          id: stranger.id,
        }),
      ).rejects.toThrow('não pode');
      await expect(
        service.confirmPaymentReview(registrationId, {
          ...actor(),
          id: randomUUID(),
        }),
      ).rejects.toThrow('não pode');
      expect(gateway.getPayment).not.toHaveBeenCalled();
      expect(accounts.accessToken).not.toHaveBeenCalled();
    } finally {
      if (!existing) await prisma.user.delete({ where: { id: stranger.id } });
    }
  });
  it.each(['reserved', 'expired', 'canceled', 'other'])(
    'recusa revisão de %s antes de consultar o provedor',
    async (status) => {
      await reviewFixture();
      const before = await prisma.registration.update({
        where: { id: registrationId },
        data: { status, reviewReason: null },
      });
      await expect(
        service.confirmPaymentReview(registrationId, actor()),
      ).rejects.toMatchObject({ status: 409 });
      expect(gateway.getPayment).not.toHaveBeenCalled();
      expect(
        await prisma.registration.findUniqueOrThrow({
          where: { id: registrationId },
        }),
      ).toEqual(before);
      expect(
        await prisma.emailOutbox.count({ where: { registrationId } }),
      ).toBe(0);
    },
  );
  it.each([
    ['participant_cancellation_requested', 'solicitou'],
    ['registration_suspended', 'suspensa'],
    ['owner_inactive', 'inativo'],
    ['event_unpublished', 'publicado'],
    ['event_started', 'começou'],
    ['capacity_full', 'vagas'],
  ])(
    'bloqueia com motivo específico e auditoria manual: %s',
    async (reason, message) => {
      await reviewFixture();
      if (reason === 'participant_cancellation_requested')
        await prisma.registration.update({
          where: { id: registrationId },
          data: { cancellationRequestedAt: new Date() },
        });
      if (reason === 'registration_suspended')
        await prisma.registration.update({
          where: { id: registrationId },
          data: { suspendedAt: new Date() },
        });
      if (reason === 'owner_inactive') {
        // Um administrador ativo pode reavaliar o evento de um responsável inativo.
        await prisma.user.update({
          where: { id: ownerId },
          data: { active: false },
        });
      }
      if (reason === 'event_unpublished')
        await prisma.academicEvent.update({
          where: { id: eventId },
          data: { status: 'draft' },
        });
      if (reason === 'event_started')
        await prisma.academicEvent.update({
          where: { id: eventId },
          data: { startsAt: new Date(0) },
        });
      if (reason === 'capacity_full')
        await prisma.registration.create({
          data: {
            eventId,
            name: 'Reserva vigente',
            email: 'reserved@test.com',
            answers: {},
            formSnapshot: [],
            priceInCents: 1000,
            reservationExpiresAt: new Date(Date.now() + 60000),
            manageTokenHash: 'fake',
          },
        });
      const admin =
        reason === 'owner_inactive'
          ? await prisma.user.create({
              data: {
                id: randomUUID(),
                name: 'Admin',
                email: `${randomUUID()}@test.com`,
                role: 'admin',
                passwordHash: 'fake',
              },
            })
          : null;
      try {
        await expect(
          service.confirmPaymentReview(
            registrationId,
            admin ? { ...actor(), id: admin.id, role: 'admin' } : actor(),
          ),
        ).rejects.toThrow(message);
        const stored = await prisma.registration.findUniqueOrThrow({
          where: { id: registrationId },
        });
        expect(stored.status).not.toBe('confirmed');
        expect(stored.reviewReason).toBe(reason);
        expect(
          await prisma.emailOutbox.count({ where: { registrationId } }),
        ).toBe(0);
        expect(
          await prisma.auditLog.findFirst({
            where: {
              entityId: registrationId,
              action: 'registration.payment_review_blocked',
            },
          }),
        ).toMatchObject({
          actorId: admin?.id ?? ownerId,
          metadata: { reason, paymentId: attemptId },
        });
      } finally {
        if (admin) {
          await prisma.auditLog.deleteMany({ where: { actorId: admin.id } });
          await prisma.user.delete({ where: { id: admin.id } });
        }
      }
    },
  );
  it.each(['refunded', 'charged_back', 'in_mediation', 'pending'])(
    'não confirma quando o provedor retorna %s',
    async (status) => {
      const verified = await reviewFixture();
      gateway.getPayment.mockResolvedValue({
        ...verified,
        status,
        date_last_updated: new Date().toISOString(),
      });
      await expect(
        service.confirmPaymentReview(registrationId, actor()),
      ).rejects.toThrow('provedor');
      const stored = await prisma.registration.findUniqueOrThrow({
        where: { id: registrationId },
      });
      expect(stored.status).toBe(
        ['refunded', 'charged_back'].includes(status)
          ? 'canceled'
          : 'payment_review',
      );
      expect(
        await prisma.emailOutbox.count({ where: { registrationId } }),
      ).toBe(0);
      if (['refunded', 'charged_back', 'in_mediation'].includes(status))
        expect(
          (
            await prisma.paymentAttempt.findUniqueOrThrow({
              where: { id: attemptId },
            })
          ).status,
        ).toBe(status);
    },
  );
  it('falha do provedor não confirma; resposta antiga não supera timestamp persistido', async () => {
    const verified = await reviewFixture();
    gateway.getPayment.mockRejectedValueOnce(
      new Error('timeout e segredo interno'),
    );
    await expect(
      service.confirmPaymentReview(registrationId, actor()),
    ).rejects.toThrow('Não foi possível consultar');
    gateway.getPayment.mockResolvedValue({
      ...verified,
      date_last_updated: new Date(0).toISOString(),
    });
    await expect(
      service.confirmPaymentReview(registrationId, actor()),
    ).rejects.toThrow('provedor');
    expect(await prisma.emailOutbox.count({ where: { registrationId } })).toBe(
      0,
    );
  });
  it('rejeita divergência de identidade e mediação ambígua sem criar cobrança', async () => {
    const verified = await reviewFixture();
    gateway.getPayment.mockResolvedValue({ ...verified, collector_id: '999' });
    await expect(
      service.confirmPaymentReview(registrationId, actor()),
    ).rejects.toThrow('não corresponde');
    await prisma.paymentAttempt.create({
      data: {
        registrationId,
        accountId,
        idempotencyKey: randomUUID(),
        requestHash,
        method: 'pix',
        installments: 1,
        amountInCents: 1000,
        status: 'in_mediation',
      },
    });
    gateway.getPayment.mockClear();
    await expect(
      service.confirmPaymentReview(registrationId, actor()),
    ).rejects.toThrow('único');
    expect(gateway.getPayment).not.toHaveBeenCalled();
    expect(gateway.createPayment).not.toHaveBeenCalled();
  });
  it.each(['registration', 'payment'])(
    'impede confirmação se %s mudou durante a consulta',
    async (kind) => {
      const verified = await reviewFixture();
      gateway.getPayment.mockImplementationOnce(async () => {
        if (kind === 'registration')
          await prisma.registration.update({
            where: { id: registrationId },
            data: { suspendedAt: new Date() },
          });
        else
          await prisma.paymentAttempt.update({
            where: { id: attemptId },
            data: { status: 'refunded', providerUpdatedAt: new Date() },
          });
        return verified;
      });
      await expect(
        service.confirmPaymentReview(registrationId, actor()),
      ).rejects.toThrow('mudou');
      expect(
        await prisma.emailOutbox.count({ where: { registrationId } }),
      ).toBe(0);
    },
  );
  it('duas reavaliações concorrentes respeitam a última vaga', async () => {
    const verified = await reviewFixture();
    const second = await prisma.registration.create({
      data: {
        eventId,
        name: 'Segundo',
        email: 'second@test.com',
        answers: {},
        formSnapshot: [],
        priceInCents: 1000,
        status: 'payment_review',
        reviewReason: 'capacity_full',
        reservationExpiresAt: new Date(0),
        manageTokenHash: 'fake',
      },
    });
    const secondAttempt = await prisma.paymentAttempt.create({
      data: {
        registrationId: second.id,
        accountId,
        idempotencyKey: randomUUID(),
        requestHash,
        method: 'pix',
        installments: 1,
        amountInCents: 1000,
        status: 'approved',
        providerPaymentId: '654321',
        providerUpdatedAt: new Date(verified.date_last_updated),
      },
    });
    gateway.getPayment.mockImplementation(async (_token, id) =>
      id === '654321'
        ? { ...verified, id, external_reference: secondAttempt.id }
        : verified,
    );
    const results = await Promise.allSettled([
      service.confirmPaymentReview(registrationId, actor()),
      service.confirmPaymentReview(second.id, actor()),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      await prisma.registration.count({
        where: { eventId, status: 'confirmed' },
      }),
    ).toBe(1);
    expect(
      await prisma.emailOutbox.count({ where: { registration: { eventId } } }),
    ).toBe(1);
  });
  it('endpoint recusa participante e UUID inválido e devolve no-store ao autorizado', async () => {
    await reviewFixture();
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PaymentsService)
      .useValue(service)
      .compile();
    const app = module.createNestApplication();
    try {
      await app.init();
      const server = app.getHttpServer() as Parameters<typeof request>[0];
      await request(server)
        .post(`/registrations/${registrationId}/payment-review/confirmation`)
        .set('x-registration-token', 'token-participante')
        .expect(401);
      const { JwtService } = await import('@nestjs/jwt');
      const token = app.get(JwtService).sign(
        { sub: ownerId, version: 0 },
        {
          secret: process.env.JWT_SECRET,
          issuer: 'ligahub-api',
          audience: 'ligahub',
          algorithm: 'HS256',
          expiresIn: '15m',
        },
      );
      await request(server)
        .post('/registrations/not-uuid/payment-review/confirmation')
        .auth(token, { type: 'bearer' })
        .expect(400);
      const result = await request(server)
        .post(`/registrations/${registrationId}/payment-review/confirmation`)
        .auth(token, { type: 'bearer' })
        .expect(201);
      expect(result.headers['cache-control']).toBe('no-store');
      expect(Object.keys(result.body).sort()).toEqual([
        'id',
        'reviewReason',
        'status',
      ]);
    } finally {
      await app.close();
    }
  });
  it('deve conservar a requisição criptografada de Orders após timeout e repetir exatamente os mesmos dados', async () => {
    vi.stubEnv(
      'MERCADO_PAGO_NOTIFICATION_URL',
      'https://ligahub.test/payments/webhook',
    );
    await prisma.paymentAttempt.delete({ where: { id: attemptId } });
    gateway.searchPayment.mockResolvedValue(null);
    gateway.createPayment.mockRejectedValueOnce(new Error('Tempo esgotado.'));
    const newKey = randomUUID();
    const input = { ...pixInput, payerName: 'Mariana Souza Oliveira' };
    await expect(
      service.create(registrationId, 'token-participante', newKey, input),
    ).rejects.toThrow('Tempo esgotado');
    const saved = await prisma.paymentAttempt.findUniqueOrThrow({
      where: { idempotencyKey: newKey },
    });
    expect(saved.providerApi).toBe('orders');
    expect(saved.submissionStarted).toBe(true);
    expect(saved.providerRequestEncrypted).not.toContain(pixInput.cpf);
    const original = JSON.parse(
      decryptCredential(saved.providerRequestEncrypted!),
    );
    expect(original.expiration_time).toMatch(/^PT\d+S$/);
    expect(original.payer.first_name).toBe(input.payerName);
    expect(saved.payerEncrypted).not.toContain(input.payerName);
    expect(saved.payerEncrypted).not.toContain(input.cpf);
    await prisma.registration.update({
      where: { id: registrationId },
      data: {
        name: 'Nome alterado',
        reservationExpiresAt: new Date(Date.now() + 7200000),
      },
    });
    gateway.createPayment.mockResolvedValueOnce({
      id: 'ORDTST123',
      external_reference: saved.id,
      collector_id: '456',
      currency_id: 'BRL',
      transaction_amount: 10,
      status: 'pending',
      status_detail: 'waiting_payment',
      date_last_updated: new Date().toISOString(),
      payment_method_id: 'pix',
      payment_type_id: 'bank_transfer',
      installments: 1,
    });
    const result = await service.create(
      registrationId,
      'token-participante',
      newKey,
      input,
    );
    expect(result.status).toBe('pending');
    expect(gateway.createPayment.mock.calls[0]![2]).toEqual(original);
    expect(gateway.createPayment.mock.calls[1]![2]).toEqual(original);
    expect(gateway.createPayment.mock.calls[1]![3]).toBe('orders');
    expect(gateway.searchPayment).toHaveBeenCalledWith(
      'token-simulado',
      saved.id,
      { api: 'orders', createdAt: saved.createdAt },
    );
    expect(
      (
        await prisma.paymentAttempt.findUniqueOrThrow({
          where: { id: saved.id },
        })
      ).providerRequestEncrypted,
    ).toBeNull();
    expect(result).not.toHaveProperty('providerRequestEncrypted');
    expect(result).not.toHaveProperty('payerEncrypted');
    expect(result).not.toHaveProperty('payer');
    const owner = {
      id: ownerId,
      name: 'Dono teste',
      email: 'owner@ligahub.test',
      role: 'organizer' as const,
    };
    const history = await service.history(owner, 1, false);
    if (!Array.isArray(history))
      throw new Error('Histórico sem paginação inválido.');
    expect(history[0]).toMatchObject({
      payer: { name: input.payerName, cpf: input.cpf },
    });
    expect(history[0]).not.toHaveProperty('payerEncrypted');
    expect(
      await service.history({ ...owner, id: randomUUID() }, 1, false),
    ).toEqual([]);
    const publicPayments = await service.participantPayments(
      registrationId,
      'token-participante',
    );
    expect(JSON.stringify(publicPayments)).not.toContain(input.cpf);
    expect(publicPayments[0]).not.toHaveProperty('payer');
    await expect(
      service.create(registrationId, 'token-participante', newKey, {
        ...input,
        payerName: 'Outro pagador',
      }),
    ).rejects.toThrow('outros dados');
  });
  it('mantém o pagador de uma requisição antiga quando descarta o token e informa ausência em registros sem dados', async () => {
    const actor = {
      id: ownerId,
      name: 'Dono teste',
      email: 'owner@ligahub.test',
      role: 'organizer' as const,
    };
    expect(await service.history(actor)).toMatchObject([{ payer: null }]);
    await prisma.paymentAttempt.update({
      where: { id: attemptId },
      data: {
        providerRequestEncrypted: encryptCredential(
          JSON.stringify({
            payer: {
              first_name: 'Bruno',
              last_name: 'Souza Lima',
              identification: { type: 'CPF', number: pixInput.cpf },
            },
            token: 'token-cartao-simulado',
          }),
        ),
      },
    });
    await service.applyPayment(attemptId, payment({ status: 'rejected' }));
    const saved = await prisma.paymentAttempt.findUniqueOrThrow({
      where: { id: attemptId },
    });
    expect(saved.providerRequestEncrypted).toBeNull();
    expect(decryptCredential(saved.payerEncrypted!)).not.toContain(
      'token-cartao-simulado',
    );
    expect(await service.history(actor)).toMatchObject([
      { payer: { name: 'Bruno Souza Lima', cpf: pixInput.cpf } },
    ]);
  });
  it.each(['original', 'lowercase'])(
    'deve consultar Orders com assinatura %s, ignorar o tópico legado e confirmar uma única vez',
    async (format) => {
      const secret = 'segredo-teste-orders';
      vi.stubEnv('MERCADO_PAGO_WEBHOOK_SECRET', secret);
      const id = 'ORDTST123';
      await prisma.paymentAttempt.update({
        where: { id: attemptId },
        data: { providerApi: 'orders', providerPaymentId: id },
      });
      const ts = String(Date.now());
      const requestId = randomUUID();
      const signedId = format === 'original' ? id : id.toLowerCase();
      const signature = `ts=${ts},v1=${createHmac('sha256', secret).update(`id:${signedId};request-id:${requestId};ts:${ts};`).digest('hex')}`;
      gateway.getPayment.mockResolvedValue({
        id,
        external_reference: attemptId,
        collector_id: '456',
        currency_id: 'BRL',
        transaction_amount: 10,
        status: 'approved',
        status_detail: 'accredited',
        date_last_updated: new Date().toISOString(),
        payment_method_id: 'pix',
        payment_type_id: 'bank_transfer',
        installments: 1,
      });
      await service.webhook(signature, requestId, id, id, 'payment');
      expect(gateway.getPayment).not.toHaveBeenCalled();
      await service.webhook(signature, requestId, id, id, 'order');
      await service.webhook(signature, requestId, id, id, 'order');
      expect(gateway.getPayment).toHaveBeenCalledWith(
        'token-simulado',
        id,
        'orders',
      );
      expect(
        (
          await prisma.registration.findUniqueOrThrow({
            where: { id: registrationId },
          })
        ).status,
      ).toBe('confirmed');
      expect(
        await prisma.emailOutbox.count({ where: { registrationId } }),
      ).toBe(1);
    },
  );
  it.each([undefined, 'https://', 'http://localhost/webhook'])(
    'deve rejeitar configuração inválida de webhook sem criar tentativa: %s',
    async (notificationUrl) => {
      await prisma.paymentAttempt.delete({ where: { id: attemptId } });
      const previous = process.env.MERCADO_PAGO_NOTIFICATION_URL;
      if (notificationUrl === undefined)
        delete process.env.MERCADO_PAGO_NOTIFICATION_URL;
      else process.env.MERCADO_PAGO_NOTIFICATION_URL = notificationUrl;
      try {
        await expect(
          service.create(
            registrationId,
            'token-participante',
            randomUUID(),
            pixInput,
          ),
        ).rejects.toThrow('Configure uma URL HTTPS');
        expect(
          await prisma.paymentAttempt.count({ where: { registrationId } }),
        ).toBe(0);
        expect(
          await prisma.auditLog.count({ where: { entityId: registrationId } }),
        ).toBe(0);
        expect(gateway.createPayment).not.toHaveBeenCalled();
      } finally {
        if (previous === undefined)
          delete process.env.MERCADO_PAGO_NOTIFICATION_URL;
        else process.env.MERCADO_PAGO_NOTIFICATION_URL = previous;
      }
    },
  );
  beforeEach(async () => {
    vi.clearAllMocks();
    prisma = new PrismaService();
    ownerId = randomUUID();
    eventId = randomUUID();
    key = randomUUID();
    await prisma.user.create({
      data: {
        id: ownerId,
        email: `payments-${ownerId}@ligahub.test`,
        name: 'Dono teste',
        role: 'admin',
        passwordHash: 'hash-ficticio',
      },
    });
    await prisma.academicEvent.create({
      data: {
        id: eventId,
        ownerId,
        title: 'Evento teste pagamentos',
        priceInCents: 1000,
        capacity: 1,
        status: 'published',
        startsAt: new Date(Date.now() + 86_400_000),
      },
    });
    const account = await prisma.paymentAccount.create({
      data: {
        ownerId,
        merchantId: '456',
        publicKey: 'TEST-key',
        accessTokenEncrypted: 'token-nao-real',
      },
    });
    accountId = account.id;
    const registration = await prisma.registration.create({
      data: {
        eventId,
        name: 'Participante teste',
        email: 'participant@test.com',
        answers: {},
        formSnapshot: [],
        priceInCents: 1000,
        reservationExpiresAt: new Date(Date.now() + 60 * 60_000),
        manageTokenHash: digest('token-participante'),
      },
    });
    registrationId = registration.id;
    const attempt = await prisma.paymentAttempt.create({
      data: {
        registrationId,
        accountId,
        idempotencyKey: key,
        requestHash,
        method: 'pix',
        installments: 1,
        amountInCents: 1000,
      },
    });
    attemptId = attempt.id;
    service = new PaymentsService(
      prisma,
      gateway as unknown as PaymentGateway,
      accounts as unknown as PaymentAccountsService,
    );
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    if (!prisma) return;
    const registrations = await prisma.registration.findMany({
      where: { eventId },
      select: { id: true },
    });
    const attempts = await prisma.paymentAttempt.findMany({
      where: { registration: { eventId } },
      select: { id: true },
    });
    await prisma.auditLog.deleteMany({
      where: {
        entityId: {
          in: [
            ownerId,
            eventId,
            accountId,
            ...registrations.map((item) => item.id),
            ...attempts.map((item) => item.id),
          ],
        },
      },
    });
    await prisma.paymentAttempt.deleteMany({
      where: { registration: { eventId } },
    });
    await prisma.registration.deleteMany({ where: { eventId } });
    await prisma.paymentAccount.deleteMany({ where: { ownerId } });
    await prisma.academicEvent.deleteMany({ where: { id: eventId } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
    await prisma.$disconnect();
  });
  function payment(overrides: Partial<ProviderPayment> = {}): ProviderPayment {
    return {
      id: randomUUID(),
      external_reference: attemptId,
      collector_id: 456,
      currency_id: 'BRL',
      transaction_amount: 10,
      status: 'approved',
      payment_method_id: 'pix',
      payment_type_id: 'bank_transfer',
      installments: 1,
      date_last_updated: new Date().toISOString(),
      ...overrides,
    };
  }
  function ownReconciliation() {
    const scoped = new Proxy(prisma, {
      get(target, property) {
        if (property === 'paymentAttempt')
          return new Proxy(target.paymentAttempt, {
            get(model, method) {
              if (method === 'findMany')
                return (args: Parameters<typeof model.findMany>[0]) =>
                  model.findMany({
                    ...args,
                    where: { AND: [args?.where ?? {}, { id: attemptId }] },
                  });
              const value = Reflect.get(model, method);
              return typeof value === 'function' ? value.bind(model) : value;
            },
          });
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    return new PaymentsService(
      scoped,
      gateway as unknown as PaymentGateway,
      accounts as unknown as PaymentAccountsService,
    );
  }
  it('deve encerrar uma tentativa nunca enviada após expiração e permitir renovar sem criar cobrança', async () => {
    const token = 'a'.repeat(43);
    await prisma.registration.update({
      where: { id: registrationId },
      data: {
        reservationExpiresAt: new Date(Date.now() - 1000),
        manageTokenHash: digest(token),
      },
    });
    await prisma.paymentAttempt.update({
      where: { id: attemptId },
      data: {
        submissionStarted: false,
        providerApi: 'orders',
        providerRequestEncrypted: encryptCredential(
          JSON.stringify({ token: 'token-ficticio' }),
        ),
      },
    });
    await Promise.all([
      ownReconciliation().reconcile(),
      service.create(registrationId, token, key, pixInput),
    ]);
    const saved = await prisma.paymentAttempt.findUniqueOrThrow({
      where: { id: attemptId },
    });
    expect(saved).toMatchObject({
      status: 'cancelled',
      statusDetail: 'not_submitted_before_expiration',
      providerRequestEncrypted: null,
    });
    expect(gateway.createPayment).not.toHaveBeenCalled();
    expect(gateway.searchPayment).not.toHaveBeenCalled();
    expect(
      await prisma.auditLog.count({
        where: { entityId: attemptId, action: 'payment.updated' },
      }),
    ).toBe(1);
    const renewed = await new RegistrationsService(prisma).renew(
      registrationId,
      token,
    );
    expect(renewed.status).toBe('reserved');
    expect(renewed.reservationExpiresAt.getTime()).toBeGreaterThan(Date.now());
  });
  it.each([null, true])(
    'não deve presumir ausência de cobrança para envio incerto ou legado: %s',
    async (submissionStarted) => {
      await prisma.registration.update({
        where: { id: registrationId },
        data: {
          reservationExpiresAt: new Date(Date.now() - 1000),
        },
      });
      await prisma.paymentAttempt.update({
        where: { id: attemptId },
        data: { submissionStarted },
      });
      gateway.searchPayment.mockResolvedValue(null);
      await ownReconciliation().reconcile();
      expect(
        await prisma.paymentAttempt.findUniqueOrThrow({
          where: { id: attemptId },
        }),
      ).toMatchObject({ status: 'created', submissionStarted });
      expect(gateway.searchPayment).toHaveBeenCalled();
      expect(gateway.createPayment).not.toHaveBeenCalled();
      expect(
        await prisma.auditLog.count({
          where: { entityId: attemptId, action: 'payment.updated' },
        }),
      ).toBe(0);
    },
  );
  it('deve confirmar uma vez e retornar a cobrança salva ao repetir a chave', async () => {
    const approvedPayment = payment();
    await service.applyPayment(attemptId, approvedPayment);
    const result = await service.create(
      registrationId,
      'token-participante',
      key,
      pixInput,
    );
    expect(result.status).toBe('approved');
    expect(gateway.createPayment).not.toHaveBeenCalled();
    expect(
      await prisma.paymentAttempt.count({ where: { registrationId } }),
    ).toBe(1);
    expect(
      (
        await prisma.registration.findUniqueOrThrow({
          where: { id: registrationId },
        })
      ).status,
    ).toBe('confirmed');
    await service.applyPayment(attemptId, {
      ...approvedPayment,
      date_last_updated: new Date(Date.now() + 1000).toISOString(),
    });
    expect(await prisma.emailOutbox.count({ where: { registrationId } })).toBe(
      1,
    );
  });
  it('deve liberar a vaga após reembolso integral e impedir nova cobrança da inscrição cancelada', async () => {
    const participantToken = 'a'.repeat(43);
    await prisma.registration.update({
      where: { id: registrationId },
      data: { manageTokenHash: digest(participantToken) },
    });
    const approved = payment();
    await service.applyPayment(attemptId, approved);
    const refunded = {
      ...approved,
      status: 'refunded',
      date_last_updated: new Date(Date.now() + 1000).toISOString(),
    };
    await Promise.all([
      service.applyPayment(attemptId, refunded),
      service.applyPayment(attemptId, refunded),
    ]);
    const registrations = new RegistrationsService(prisma);
    expect(
      await registrations.participantDetails(registrationId, participantToken),
    ).toMatchObject({ status: 'canceled', payments: [{ status: 'refunded' }] });
    await expect(
      service.create(registrationId, participantToken, randomUUID(), pixInput),
    ).rejects.toThrow('A inscrição não está disponível para pagamento.');
    expect(gateway.createPayment).not.toHaveBeenCalled();
    const auditBefore = await prisma.auditLog.count({
      where: { entityId: attemptId },
    });
    await service.applyPayment(attemptId, refunded);
    await service.applyPayment(attemptId, {
      ...approved,
      date_last_updated: new Date(Date.now() + 2000).toISOString(),
    });
    expect(
      await prisma.auditLog.count({ where: { entityId: attemptId } }),
    ).toBe(auditBefore);
    const cancellations = await prisma.auditLog.findMany({
      where: { entityId: registrationId, action: 'registration.canceled' },
    });
    expect(cancellations).toHaveLength(1);
    expect(cancellations[0]?.metadata).toEqual({
      paymentId: attemptId,
      status: 'canceled',
      reason: 'payment_refunded',
    });
    expect(
      await prisma.paymentAttempt.findUniqueOrThrow({
        where: { id: attemptId },
      }),
    ).toMatchObject({ status: 'refunded' });
    const event = await prisma.academicEvent.findUniqueOrThrow({
      where: { id: eventId },
    });
    const replacement = await registrations.reserve(event.publicId, {
      name: 'Novo participante',
      email: 'substituto@ligahub.test',
      answers: {},
    });
    expect(replacement.status).toBe('reserved');
    const { worker, send } = mailWorker();
    await worker.processBatch(registrationId);
    expect(send).not.toHaveBeenCalled();
    expect(
      await prisma.emailOutbox.findUniqueOrThrow({ where: { registrationId } }),
    ).toMatchObject({ status: 'skipped' });
  });
  it('deve preservar a inscrição e a ocupação quando outro pagamento continua aprovado após o reembolso', async () => {
    const participantToken = 'b'.repeat(43);
    await prisma.registration.update({
      where: { id: registrationId },
      data: { manageTokenHash: digest(participantToken) },
    });
    const approved = payment();
    await service.applyPayment(attemptId, approved);
    await prisma.paymentAttempt.create({
      data: {
        registrationId,
        accountId,
        idempotencyKey: randomUUID(),
        requestHash,
        method: 'pix',
        installments: 1,
        amountInCents: 1000,
        status: 'approved',
      },
    });
    await service.applyPayment(attemptId, {
      ...approved,
      status: 'refunded',
      date_last_updated: new Date(Date.now() + 1000).toISOString(),
    });
    const registrations = new RegistrationsService(prisma);
    expect(
      await prisma.auditLog.count({
        where: {
          entityId: registrationId,
          action: 'registration.canceled',
        },
      }),
    ).toBe(0);
    expect(
      await registrations.participantDetails(registrationId, participantToken),
    ).toMatchObject({ status: 'confirmed' });
    const event = await prisma.academicEvent.findUniqueOrThrow({
      where: { id: eventId },
    });
    await expect(
      registrations.reserve(event.publicId, {
        name: 'Outro participante',
        email: 'outro@ligahub.test',
        answers: {},
      }),
    ).rejects.toThrow('Todas as vagas deste evento estão ocupadas.');
  });
  function mailWorker(send = vi.fn().mockResolvedValue('email-provedor')) {
    vi.stubEnv('EMAIL_DELIVERY_ENABLED', 'true');
    vi.stubEnv('RESEND_API_KEY', 'chave-simulada');
    vi.stubEnv('EMAIL_FROM', 'LigaHub <confirmacoes@example.com>');
    vi.stubEnv('FRONTEND_URL', 'https://liga.example.com');
    return {
      send,
      worker: new EmailOutboxService(
        prisma,
        { send } as EmailGateway,
        { processBatch: async () => {} } as unknown as AccessEmailProcessor,
      ),
    };
  }
  it.each([
    { provider: 'resend', smtpHost: 'localhost', resendKey: undefined },
    { provider: 'smtp', smtpHost: undefined, resendKey: 'chave-simulada' },
  ])(
    'não deve consumir tentativas sem configurar o provedor selecionado: $provider',
    async ({ provider, smtpHost, resendKey }) => {
      await service.applyPayment(attemptId, payment());
      const { worker, send } = mailWorker();
      vi.stubEnv('EMAIL_PROVIDER', provider);
      vi.stubEnv('SMTP_HOST', smtpHost);
      vi.stubEnv('RESEND_API_KEY', resendKey);
      await worker.processBatch(registrationId);
      expect(send).not.toHaveBeenCalled();
      expect(
        await prisma.emailOutbox.findUniqueOrThrow({
          where: { registrationId },
        }),
      ).toMatchObject({ status: 'pending', attempts: 0, firstAttemptAt: null });
    },
  );
  it.each([
    { provider: 'resend', smtpHost: 'localhost', resendKey: 'chave-simulada' },
    { provider: 'smtp', smtpHost: 'localhost', resendKey: undefined },
  ])(
    'deve processar a fila com o provedor selecionado configurado: $provider',
    async ({ provider, smtpHost, resendKey }) => {
      await service.applyPayment(attemptId, payment());
      const { worker, send } = mailWorker();
      vi.stubEnv('EMAIL_PROVIDER', provider);
      vi.stubEnv('SMTP_HOST', smtpHost);
      vi.stubEnv('RESEND_API_KEY', resendKey);
      await worker.processBatch(registrationId);
      expect(send).toHaveBeenCalledOnce();
      expect(
        await prisma.emailOutbox.findUniqueOrThrow({
          where: { registrationId },
        }),
      ).toMatchObject({ status: 'sent', attempts: 1 });
    },
  );
  it('deve desfazer a confirmação se não conseguir registrar a tarefa de e-mail', async () => {
    vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', 'invalida');
    await expect(service.applyPayment(attemptId, payment())).rejects.toThrow(
      '32 bytes',
    );
    expect(
      (
        await prisma.registration.findUniqueOrThrow({
          where: { id: registrationId },
        })
      ).status,
    ).toBe('reserved');
    expect(
      (
        await prisma.paymentAttempt.findUniqueOrThrow({
          where: { id: attemptId },
        })
      ).status,
    ).toBe('created');
    expect(await prisma.emailOutbox.count({ where: { registrationId } })).toBe(
      0,
    );
  });
  it('deve enviar uma vez mesmo com dois workers concorrentes e apagar o conteúdo enviado', async () => {
    await service.applyPayment(attemptId, payment());
    const { send, worker } = mailWorker();
    const second = new EmailOutboxService(
      prisma,
      { send } as EmailGateway,
      { processBatch: async () => {} } as unknown as AccessEmailProcessor,
    );
    await Promise.all([
      worker.processBatch(registrationId),
      second.processBatch(registrationId),
    ]);
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][0].text).toContain('está confirmada');
    expect(send.mock.calls[0][0].text).toContain('#token=');
    const outbox = await prisma.emailOutbox.findUniqueOrThrow({
      where: { registrationId },
    });
    expect(outbox.status).toBe('sent');
    expect(outbox.payloadEncrypted).toBeNull();
  });
  it('deve manter a vaga e repetir com a mesma chave e conteúdo depois de uma falha', async () => {
    await service.applyPayment(attemptId, payment());
    const { send, worker } = mailWorker(
      vi
        .fn()
        .mockRejectedValueOnce(new Error('Resposta perdida'))
        .mockResolvedValue('email-provedor'),
    );
    await worker.processBatch(registrationId);
    const outbox = await prisma.emailOutbox.findUniqueOrThrow({
      where: { registrationId },
    });
    expect(outbox.status).toBe('pending');
    expect(outbox.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    expect(
      (
        await prisma.registration.findUniqueOrThrow({
          where: { id: registrationId },
        })
      ).status,
    ).toBe('confirmed');
    await prisma.emailOutbox.update({
      where: { registrationId },
      data: { nextAttemptAt: new Date(0) },
    });
    vi.stubEnv('EMAIL_FROM', 'Outro <outro@example.com>');
    vi.stubEnv('FRONTEND_URL', 'https://outro.example.com');
    await worker.processBatch(registrationId);
    expect(send.mock.calls[0]).toEqual(send.mock.calls[1]);
    expect(
      (
        await prisma.emailOutbox.findUniqueOrThrow({
          where: { registrationId },
        })
      ).status,
    ).toBe('sent');
  });
  it('deve recuperar uma tarefa interrompida depois da expiração da concessão', async () => {
    await service.applyPayment(attemptId, payment());
    await prisma.emailOutbox.update({
      where: { registrationId },
      data: {
        status: 'processing',
        leaseId: randomUUID(),
        leaseExpiresAt: new Date(0),
      },
    });
    const { worker, send } = mailWorker();
    await worker.processBatch(registrationId);
    expect(send).toHaveBeenCalledOnce();
  });
  it('não deve repetir um envio depois da janela segura de idempotência', async () => {
    await service.applyPayment(attemptId, payment());
    await prisma.emailOutbox.update({
      where: { registrationId },
      data: {
        attempts: 1,
        firstAttemptAt: new Date(Date.now() - 24 * 3_600_000),
      },
    });
    const { worker, send } = mailWorker();
    await worker.processBatch(registrationId);
    expect(send).not.toHaveBeenCalled();
    expect(
      (
        await prisma.emailOutbox.findUniqueOrThrow({
          where: { registrationId },
        })
      ).status,
    ).toBe('failed');
  });
  it('não deve enviar confirmação de inscrição cancelada antes do primeiro envio', async () => {
    await service.applyPayment(attemptId, payment());
    await prisma.registration.update({
      where: { id: registrationId },
      data: { status: 'canceled' },
    });
    const { worker, send } = mailWorker();
    await worker.processBatch(registrationId);
    expect(send).not.toHaveBeenCalled();
    expect(
      (
        await prisma.emailOutbox.findUniqueOrThrow({
          where: { registrationId },
        })
      ).status,
    ).toBe('skipped');
  });
  it.each(['canceled', 'suspended'])(
    'não deve repetir a confirmação após falha se a inscrição estiver %s',
    async (state) => {
      await service.applyPayment(attemptId, payment());
      const { worker, send } = mailWorker(
        vi
          .fn()
          .mockRejectedValueOnce(new Error('Resposta perdida'))
          .mockResolvedValue('email-provedor'),
      );
      await worker.processBatch(registrationId);
      await prisma.registration.update({
        where: { id: registrationId },
        data:
          state === 'canceled'
            ? { status: 'canceled' }
            : { suspendedAt: new Date() },
      });
      await prisma.emailOutbox.update({
        where: { registrationId },
        data: { nextAttemptAt: new Date(0) },
      });
      await worker.processBatch(registrationId);
      expect(send).toHaveBeenCalledOnce();
      const outbox = await prisma.emailOutbox.findUniqueOrThrow({
        where: { registrationId },
      });
      expect(outbox.status).toBe('skipped');
      expect(outbox.payloadEncrypted).toBeNull();
    },
  );
  it('deve consultar o status com o token do e-mail sem conceder acesso de alteração', async () => {
    await service.applyPayment(attemptId, payment());
    const outbox = await prisma.emailOutbox.findUniqueOrThrow({
      where: { registrationId },
    });
    const { token } = JSON.parse(
      decryptCredential(outbox.payloadEncrypted!),
    ) as { token: string };
    const registrations = new RegistrationsService(prisma);
    const result = await registrations.participantStatus(registrationId, token);
    expect(result.status).toBe('confirmed');
    expect(result).not.toHaveProperty('email');
    expect(result).not.toHaveProperty('answers');
    await expect(
      registrations.participantDetails(registrationId, token),
    ).rejects.toThrow('inválido');
    await expect(
      registrations.participantStatus(registrationId, 'A'.repeat(43)),
    ).rejects.toThrow('inválido ou expirou');
    await prisma.registration.update({
      where: { id: registrationId },
      data: { statusTokenExpiresAt: new Date(0) },
    });
    await expect(
      registrations.participantStatus(registrationId, token),
    ).rejects.toThrow('inválido ou expirou');
  });
  it('deve expor a consulta HTTP sem senha e sem cache, rejeitando o token em cancelamentos', async () => {
    await service.applyPayment(attemptId, payment());
    const outbox = await prisma.emailOutbox.findUniqueOrThrow({
      where: { registrationId },
    });
    const { token } = JSON.parse(
      decryptCredential(outbox.payloadEncrypted!),
    ) as { token: string };
    vi.stubEnv('EMAIL_DELIVERY_ENABLED', 'false');
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const app = module.createNestApplication();
    try {
      await app.init();
      const server = app.getHttpServer() as Parameters<typeof request>[0];
      await request(server).get('/payments?page=1').expect(401);
      const result = await request(server)
        .get(`/public/registrations/${registrationId}/status`)
        .set('x-registration-status-token', token)
        .expect(200);
      expect(result.headers['cache-control']).toBe('no-store');
      expect(result.body.status).toBe('confirmed');
      expect(result.body).not.toHaveProperty('statusTokenHash');
      await request(server)
        .get(`/public/registrations/${registrationId}/status`)
        .expect(401);
      await request(server)
        .post(`/public/registrations/${registrationId}/cancellation`)
        .set('x-registration-token', token)
        .expect(401);
    } finally {
      await app.close();
    }
  });
  it('deve preservar a última vaga quando dois pagamentos tardios chegam juntos', async () => {
    await prisma.registration.update({
      where: { id: registrationId },
      data: {
        status: 'expired',
        reservationExpiresAt: new Date(Date.now() - 60_000),
      },
    });
    const second = await prisma.registration.create({
      data: {
        eventId,
        name: 'Outro participante',
        email: 'second@test.com',
        answers: {},
        formSnapshot: [],
        priceInCents: 1000,
        status: 'expired',
        reservationExpiresAt: new Date(Date.now() - 60_000),
        manageTokenHash: digest('outro-token'),
      },
    });
    const secondAttempt = await prisma.paymentAttempt.create({
      data: {
        registrationId: second.id,
        accountId,
        idempotencyKey: randomUUID(),
        requestHash,
        method: 'pix',
        installments: 1,
        amountInCents: 1000,
      },
    });
    await Promise.all([
      service.applyPayment(attemptId, payment()),
      service.applyPayment(
        secondAttempt.id,
        payment({ external_reference: secondAttempt.id }),
      ),
    ]);
    const states = await prisma.registration.findMany({
      where: { eventId },
      select: { status: true },
    });
    expect(states.map((item) => item.status).sort()).toEqual([
      'confirmed',
      'payment_review',
    ]);
  });
  it('deve manter a conta original da tentativa após troca da conta ativa', async () => {
    await prisma.paymentAccount.update({
      where: { id: accountId },
      data: { active: false },
    });
    await prisma.paymentAccount.create({
      data: {
        ownerId,
        merchantId: '999',
        publicKey: 'TEST-new',
        accessTokenEncrypted: 'outro-token-nao-real',
      },
    });
    gateway.getPayment.mockResolvedValue(payment({ status: 'pending' }));
    await prisma.paymentAttempt.update({
      where: { id: attemptId },
      data: { providerPaymentId: '111' },
    });
    gateway.getPayment.mockResolvedValue(
      payment({ id: '111', status: 'pending' }),
    );
    await service.create(registrationId, 'token-participante', key, pixInput);
    expect(accounts.accessToken).toHaveBeenCalledWith(accountId);
    expect(
      (
        await prisma.paymentAttempt.findUniqueOrThrow({
          where: { id: attemptId },
        })
      ).accountId,
    ).toBe(accountId);
  });
  it('deve consultar o provedor antes de confirmar uma notificação assinada', async () => {
    const originalSecret = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
    process.env.MERCADO_PAGO_WEBHOOK_SECRET =
      'segredo-simulado-apenas-para-webhook';
    try {
      const providerId = randomUUID();
      await prisma.paymentAttempt.update({
        where: { id: attemptId },
        data: { providerPaymentId: providerId },
      });
      gateway.getPayment.mockResolvedValue(
        payment({ id: providerId, collector_id: '999' }),
      );
      const ts = String(Date.now());
      const requestId = randomUUID();
      const signature = createHmac(
        'sha256',
        process.env.MERCADO_PAGO_WEBHOOK_SECRET,
      )
        .update(
          'id:' + providerId + ';request-id:' + requestId + ';ts:' + ts + ';',
        )
        .digest('hex');
      await expect(
        service.webhook(
          'ts=' + ts + ',v1=' + signature,
          requestId,
          providerId,
          providerId,
          'payment',
        ),
      ).rejects.toThrow('não corresponde');
      expect(gateway.getPayment).toHaveBeenCalledWith(
        'token-simulado',
        providerId,
        'payments',
      );
      expect(
        (
          await prisma.registration.findUniqueOrThrow({
            where: { id: registrationId },
          })
        ).status,
      ).toBe('reserved');
    } finally {
      if (originalSecret === undefined)
        delete process.env.MERCADO_PAGO_WEBHOOK_SECRET;
      else process.env.MERCADO_PAGO_WEBHOOK_SECRET = originalSecret;
    }
  });

  it('deve impedir confirmação quando o recebedor ou o valor divergem', async () => {
    await expect(
      service.applyPayment(attemptId, payment({ collector_id: '999' })),
    ).rejects.toThrow('não corresponde');
    await expect(
      service.applyPayment(attemptId, payment({ transaction_amount: 9 })),
    ).rejects.toThrow('não corresponde');
    expect(
      (
        await prisma.registration.findUniqueOrThrow({
          where: { id: registrationId },
        })
      ).status,
    ).toBe('reserved');
  });
});
