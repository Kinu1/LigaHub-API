import { createHmac, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../src/prisma.service.js';
import { PaymentsService } from '../src/modules/payments/payments.service.js';
import type { PaymentAccountsService } from '../src/modules/payments/payment-accounts.service.js';
import type { PaymentGateway } from '../src/modules/payments/payment.gateway.js';
import { decryptCredential } from '../src/modules/payments/payment-security.js';
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
  function mailWorker(send = vi.fn().mockResolvedValue('email-provedor')) {
    vi.stubEnv('EMAIL_DELIVERY_ENABLED', 'true');
    vi.stubEnv('RESEND_API_KEY', 'chave-simulada');
    vi.stubEnv('EMAIL_FROM', 'LigaHub <confirmacoes@example.com>');
    vi.stubEnv('FRONTEND_URL', 'https://liga.example.com');
    return {
      send,
      worker: new EmailOutboxService(prisma, { send } as EmailGateway),
    };
  }
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
    const second = new EmailOutboxService(prisma, { send } as EmailGateway);
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
