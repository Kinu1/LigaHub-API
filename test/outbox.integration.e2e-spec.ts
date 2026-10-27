import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { Test } from '@nestjs/testing';

import { APP_GUARD } from '@nestjs/core';

import { JwtService } from '@nestjs/jwt';

import { ValidationPipe, type INestApplication } from '@nestjs/common';

import request from 'supertest';

import { PrismaService } from '../src/prisma.service.js';

import { JwtAuthGuard, RolesGuard } from '../src/modules/auth/auth.guards.js';

import { encryptCredential } from '../src/modules/payments/payment-security.js';

import { EmailGateway } from '../src/modules/notifications/email.gateway.js';

import { EmailOutboxService } from '../src/modules/notifications/email-outbox.service.js';

import { OutboxAdminService } from '../src/modules/notifications/outbox-admin.service.js';

import { OutboxAdminController } from '../src/modules/notifications/outbox-admin.controller.js';

// Banco real; somente fixtures próprias são reivindicadas/removidas. Nunca usa gateway externo.

describe('Outbox PostgreSQL e administração', () => {
  let prisma: PrismaService;

  let app: INestApplication;

  let service: OutboxAdminService;

  const ownerId = randomUUID(),
    eventId = randomUUID();

  const registrations: string[] = [];

  const gateway = { send: vi.fn().mockResolvedValue('simulado') };

  const jwt = new JwtService();

  const secret = 'segredo-exclusivo-testes-ligahub-nao-usar-em-producao';

  const message = {
    from: 'LigaHub <test@example.com>',
    to: ['test@example.com'],
    subject: 'Confirmação',
    text: 'conteudo-token-sensivel',
  };

  async function fixture(data: Record<string, unknown> = {}) {
    const registration = await prisma.registration.create({
      data: {
        eventId,
        name: 'Teste',
        email: `${randomUUID()}@example.com`,
        answers: {},
        formSnapshot: [],
        priceInCents: 1000,

        reservationExpiresAt: new Date(Date.now() + 3600000),
        manageTokenHash: 'hash',
        status: 'confirmed',

        statusTokenHash: 'hash',
        statusTokenExpiresAt: new Date(Date.now() + 3600000),
      },
    });

    registrations.push(registration.id);

    return prisma.emailOutbox.create({
      data: {
        registrationId: registration.id,
        status: 'failed',
        attempts: 8,

        firstAttemptAt: new Date(),
        payloadEncrypted: encryptCredential(JSON.stringify({ message })),
        ...data,
      },
    });
  }

  function token() {
    return jwt.sign(
      { sub: ownerId, version: 0 },
      { secret, expiresIn: 900, issuer: 'ligahub-api', audience: 'ligahub' },
    );
  }

  beforeAll(async () => {
    const host = new URL(process.env.DATABASE_URL ?? '').hostname;
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host))
      throw new Error(
        'O teste de outbox exige PostgreSQL local ou do job de CI.',
      );
    vi.stubEnv('JWT_SECRET', secret);

    vi.stubEnv('EMAIL_DELIVERY_ENABLED', 'true');

    vi.stubEnv('RESEND_API_KEY', 'simulado');

    vi.stubEnv('SMTP_HOST', 'simulado');

    vi.stubEnv('EMAIL_FROM', message.from);

    vi.stubEnv('FRONTEND_URL', 'https://example.com');

    vi.stubEnv(
      'CREDENTIALS_ENCRYPTION_KEY',
      'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=',
    );

    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('Chamada externa proibida');
      }),
    );

    prisma = new PrismaService();

    await prisma.user.create({
      data: {
        id: ownerId,
        name: 'Teste',
        email: `${ownerId}@example.com`,
        passwordHash: 'fake',
        role: 'admin',
      },
    });

    await prisma.academicEvent.create({
      data: {
        id: eventId,
        ownerId,
        title: 'Outbox teste',
        priceInCents: 1000,
        capacity: 10,
      },
    });

    const module = await Test.createTestingModule({
      controllers: [OutboxAdminController],
      providers: [
        OutboxAdminService,

        { provide: PrismaService, useValue: prisma },
        { provide: EmailGateway, useValue: gateway },

        { provide: JwtService, useValue: jwt },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    }).compile();

    app = module.createNestApplication();

    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );

    await app.init();
    service = module.get(OutboxAdminService);
  });

  beforeEach(() => gateway.send.mockClear());

  afterAll(async () => {
    if (prisma) {
      const rows = await prisma.emailOutbox.findMany({
        where: { registrationId: { in: registrations } },
        select: { id: true },
      });

      await prisma.auditLog.deleteMany({
        where: {
          entityId: { in: [...rows.map((r) => r.id), ...registrations] },
        },
      });

      await prisma.emailOutbox.deleteMany({
        where: { registrationId: { in: registrations } },
      });

      await prisma.registration.deleteMany({ where: { eventId } });

      await prisma.academicEvent.deleteMany({ where: { id: eventId } });

      await prisma.user.deleteMany({ where: { id: ownerId } });

      await app?.close();
      await prisma.$disconnect();
    }

    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('payload ilegível no primeiro item não bloqueia o segundo no mesmo lote', async () => {
    const first = await fixture({
      status: 'pending',
      attempts: 0,
      firstAttemptAt: null,
      payloadEncrypted: 'ilegivel',
    });

    const second = await fixture({
      status: 'pending',
      attempts: 0,
      firstAttemptAt: null,
    });

    const worker = new EmailOutboxService(prisma, gateway);

    // Limita a seleção às fixtures, mantendo claim/transações/locks reais.

    const access = worker as unknown as {
      claim(id?: string): Promise<unknown>;
    };

    const claim = access.claim.bind(worker);

    let index = 0;

    vi.spyOn(access, 'claim').mockImplementation(() =>
      index++ === 0
        ? claim(first.registrationId)
        : index === 2
          ? claim(second.registrationId)
          : Promise.resolve(null),
    );

    await worker.processBatch();

    expect(
      (await prisma.emailOutbox.findUniqueOrThrow({ where: { id: first.id } }))
        .status,
    ).toBe('failed');

    expect(
      (await prisma.emailOutbox.findUniqueOrThrow({ where: { id: second.id } }))
        .status,
    ).toBe('sent');

    expect(gateway.send).toHaveBeenCalledExactlyOnceWith(
      message,
      `confirmation/${second.id}`,
    );
  });

  it('exige autenticação e admin nas duas rotas; valida paginação e UUID', async () => {
    const row = await fixture();

    for (const method of ['get', 'post'] as const) {
      const url =
        method === 'get'
          ? '/admin/email-outbox?status=failed'
          : `/admin/email-outbox/${row.id}/retry`;

      expect((await request(app.getHttpServer())[method](url)).status).toBe(
        401,
      );

      const account = await prisma.user.findUniqueOrThrow({
        where: { id: ownerId },
      });
      const lookup = vi
        .spyOn(prisma.user, 'findUnique')
        .mockResolvedValueOnce({ ...account, role: 'organizer' });

      expect(
        (
          await request(app.getHttpServer())
            [method](url)
            .auth(token(), { type: 'bearer' })
        ).status,
      ).toBe(403);

      lookup.mockRestore();
    }

    for (const query of [
      'status=failed&limit=101',
      'status=invalid',
      'status=failed&page=0',
      'status=failed&payload=secret',
    ])
      expect(
        (
          await request(app.getHttpServer())
            .get(`/admin/email-outbox?${query}`)
            .auth(token(), { type: 'bearer' })
        ).status,
      ).toBe(400);

    expect(
      (
        await request(app.getHttpServer())
          .post('/admin/email-outbox/invalido/retry')
          .auth(token(), { type: 'bearer' })
      ).status,
    ).toBe(400);

    const listed = await request(app.getHttpServer())
      .get('/admin/email-outbox?status=failed&limit=1&page=1')
      .auth(token(), { type: 'bearer' });

    expect(listed.status).toBe(200);
    expect(listed.body.items).toHaveLength(1);

    expect(JSON.stringify(listed.body)).not.toMatch(
      /payload|conteudo-token|leaseId|providerId/,
    );
  });

  it('preserva corpo/chave e audita uma única retomada concorrente', async () => {
    const row = await fixture();

    const results = await Promise.allSettled([
      service.retry(row.id, ownerId),
      service.retry(row.id, ownerId),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

    expect(gateway.send).toHaveBeenCalledExactlyOnceWith(
      message,
      `confirmation/${row.id}`,
    );

    const audit = await prisma.auditLog.findMany({
      where: {
        entityId: row.registrationId,
        action: 'registration.email_retry_authorized',
      },
    });

    expect(audit).toHaveLength(1);
    expect(audit[0].metadata).toEqual({ outboxId: row.id, attempt: 9 });
  });

  it('bloqueia status/janela/payload/inscrição/token inseguros sem enviar', async () => {
    for (const data of [
      { status: 'pending' },
      { status: 'sent' },
      { status: 'processing' },
      { status: 'skipped' },

      { firstAttemptAt: new Date(Date.now() - 23 * 3600000) },
      { firstAttemptAt: null },
      { firstAttemptAt: new Date(Date.now() + 3600000) },

      { payloadEncrypted: null },
      { payloadEncrypted: 'ilegivel' },
      { payloadEncrypted: encryptCredential('{}') },
    ]) {
      const row = await fixture(data);
      await expect(service.retry(row.id, ownerId)).rejects.toThrow();
    }

    for (const data of [
      { status: 'reserved' },
      { suspendedAt: new Date() },
      { statusTokenExpiresAt: new Date(Date.now() - 1) },
      { statusTokenHash: null },
    ]) {
      const row = await fixture();
      await prisma.registration.update({
        where: { id: row.registrationId },
        data,
      });

      await expect(service.retry(row.id, ownerId)).rejects.toThrow();
    }

    expect(gateway.send).not.toHaveBeenCalled();
  });

  it('não afirma conclusão da fila quando perde a concessão após o aceite do provedor', async () => {
    const row = await fixture();
    const save = vi
      .spyOn(prisma.emailOutbox, 'updateMany')
      .mockResolvedValueOnce({ count: 0 });
    try {
      await expect(service.retry(row.id, ownerId)).rejects.toThrow(
        'atualização da fila não foi confirmada',
      );
      expect(gateway.send).toHaveBeenCalledExactlyOnceWith(
        message,
        `confirmation/${row.id}`,
      );
      expect(
        await prisma.emailOutbox.findUniqueOrThrow({ where: { id: row.id } }),
      ).toMatchObject({
        status: 'processing',
        payloadEncrypted: row.payloadEncrypted,
      });
    } finally {
      save.mockRestore();
    }
  });
  it('não consome tentativa administrativa sem a configuração do provedor selecionado', async () => {
    const row = await fixture();
    const previousKey = process.env.RESEND_API_KEY;
    const previousProvider = process.env.EMAIL_PROVIDER;
    vi.stubEnv('EMAIL_PROVIDER', 'resend');
    vi.stubEnv('RESEND_API_KEY', undefined);
    try {
      await expect(service.retry(row.id, ownerId)).rejects.toThrow(
        'Entrega de e-mails desativada.',
      );
      expect(gateway.send).not.toHaveBeenCalled();
      expect(
        await prisma.emailOutbox.findUniqueOrThrow({ where: { id: row.id } }),
      ).toMatchObject({ status: 'failed', attempts: row.attempts });
    } finally {
      vi.stubEnv('RESEND_API_KEY', previousKey);
      vi.stubEnv('EMAIL_PROVIDER', previousProvider);
    }
  });
  it('falha manual preserva payload e não volta para pending; chave global inválida não altera fila', async () => {
    const row = await fixture();
    gateway.send.mockRejectedValueOnce(new Error('segredo-do-provedor'));

    await expect(service.retry(row.id, ownerId)).rejects.toThrow(/O provedor/);

    const saved = await prisma.emailOutbox.findUniqueOrThrow({
      where: { id: row.id },
    });

    expect(saved.status).toBe('failed');
    expect(saved.payloadEncrypted).toBe(row.payloadEncrypted);

    vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', 'invalida');

    await expect(
      new EmailOutboxService(prisma, gateway).processBatch(),
    ).rejects.toThrow();

    await expect(service.retry(row.id, ownerId)).rejects.toThrow();

    expect(
      (await prisma.emailOutbox.findUniqueOrThrow({ where: { id: row.id } }))
        .attempts,
    ).toBe(9);

    vi.stubEnv(
      'CREDENTIALS_ENCRYPTION_KEY',
      'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=',
    );
  });
});
