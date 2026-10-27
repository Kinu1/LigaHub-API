import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { INestApplication } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { PrismaService } from '../src/prisma.service.js';
import { JobsController } from '../src/modules/jobs/jobs.controller.js';
import { JobsGuard } from '../src/modules/jobs/jobs.guard.js';
import { JobsRunner } from '../src/modules/jobs/jobs.runner.js';
import { JwtAuthGuard, RolesGuard } from '../src/modules/auth/auth.guards.js';
import { EmailOutboxService } from '../src/modules/notifications/email-outbox.service.js';
import { PaymentsService } from '../src/modules/payments/payments.service.js';

describe('Rotinas HTTP e concessões PostgreSQL locais', () => {
  let prisma: PrismaService;
  let app: INestApplication;
  let runner: JobsRunner;
  const owned: string[] = [];
  const secret = randomBytes(32).toString('hex');
  const emails = { processBatch: vi.fn().mockResolvedValue(undefined) };
  const payments = { reconcile: vi.fn().mockResolvedValue(undefined) };
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? '');
    if (url.hostname !== '127.0.0.1' || url.port !== '5433')
      throw new Error('Banco de testes deve usar 127.0.0.1:5433.');
    prisma = new PrismaService();
    // Inserção exclusiva: nunca assume posse de registros preexistentes, mesmo expirados.
    await prisma.$transaction(async (tx) => {
      if (
        await tx.backgroundJob.count({
          where: { name: { in: ['emails', 'payments'] } },
        })
      )
        throw new Error('Banco contém controles usados; teste abortado.');
      await tx.backgroundJob.createMany({
        data: [{ name: 'emails' }, { name: 'payments' }],
      });
    });
    owned.push('emails', 'payments');
    vi.stubEnv('BACKGROUND_JOBS_ENABLED', 'true');
    vi.stubEnv('CRON_SECRET', secret);
    vi.stubEnv('BACKGROUND_TIMERS_ENABLED', 'false');
    vi.stubEnv('EMAIL_DELIVERY_ENABLED', 'true');
    vi.stubEnv('PAYMENT_RECONCILIATION_ENABLED', 'true');
    vi.stubEnv('EMAIL_PROVIDER', 'smtp');
    vi.stubEnv('SMTP_HOST', 'localhost');
    vi.stubEnv('EMAIL_FROM', 'teste@example.com');
    vi.stubEnv('FRONTEND_URL', 'http://localhost:5173');
    const module = await Test.createTestingModule({
      controllers: [JobsController],
      providers: [
        JobsGuard,
        JobsRunner,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailOutboxService, useValue: emails },
        { provide: PaymentsService, useValue: payments },
        JwtService,
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.listen(0, '127.0.0.1');
    runner = app.get(JobsRunner);
  });
  afterAll(async () => {
    if (prisma && owned.length)
      await prisma.backgroundJob.deleteMany({ where: { name: { in: owned } } });
    await app?.close();
    await prisma?.$disconnect();
    vi.unstubAllEnvs();
  });
  it('executa sem JWT e protege falhas HTTP com no-store', async () => {
    const http = request(app.getHttpServer());
    await http
      .get('/internal/jobs/emails')
      .expect(401)
      .expect('Cache-Control', 'no-store');
    await http
      .get('/internal/jobs/emails')
      .set('Authorization', `Bearer ${secret}`)
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(emails.processBatch).toHaveBeenCalledOnce();
    vi.stubEnv('BACKGROUND_JOBS_ENABLED', 'false');
    await http
      .get('/internal/jobs/payments')
      .expect(404)
      .expect('Cache-Control', 'no-store');
    vi.stubEnv('BACKGROUND_JOBS_ENABLED', 'true');
    vi.stubEnv('CRON_SECRET', '');
    await http
      .get('/internal/jobs/payments')
      .expect(503)
      .expect('Cache-Control', 'no-store');
    vi.stubEnv('CRON_SECRET', secret);
    vi.stubEnv('PAYMENT_RECONCILIATION_ENABLED', 'false');
    const before = await prisma.backgroundJob.findUniqueOrThrow({
      where: { name: 'payments' },
    });
    await http
      .get('/internal/jobs/payments')
      .set('Authorization', `Bearer ${secret}`)
      .expect(503)
      .expect('Cache-Control', 'no-store');
    expect(
      (
        await prisma.backgroundJob.findUniqueOrThrow({
          where: { name: 'payments' },
        })
      ).runCount,
    ).toBe(before.runCount);
    vi.stubEnv('PAYMENT_RECONCILIATION_ENABLED', 'true');
  });
  it('somente uma instância executa; conflito HTTP 409', async () => {
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    emails.processBatch.mockImplementationOnce(() => {
      entered();
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    const first = runner.run('emails');
    await started;
    try {
      const other = new JobsRunner(
        prisma,
        emails as unknown as EmailOutboxService,
        payments as unknown as PaymentsService,
      );
      await expect(other.run('emails')).rejects.toMatchObject({ status: 409 });
      await request(app.getHttpServer())
        .get('/internal/jobs/emails')
        .set('Authorization', `Bearer ${secret}`)
        .expect(409)
        .expect('Cache-Control', 'no-store');
    } finally {
      release();
      await first;
    }
  });
  it('insere controle ausente com TTL de cinco minutos no relógio do banco', async () => {
    await prisma.backgroundJob.deleteMany({ where: { name: 'payments' } });
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    payments.reconcile.mockImplementationOnce(() => {
      entered();
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    const running = runner.run('payments');
    await started;
    try {
      const rows = await prisma.$queryRaw<
        { seconds: number; runCount: number }[]
      >`
        SELECT EXTRACT(EPOCH FROM ("leaseExpiresAt" - "startedAt"))::float8 AS seconds,
        "runCount" FROM background_jobs WHERE name = 'payments'`;
      expect(rows[0]).toEqual({ seconds: 300, runCount: 1 });
    } finally {
      release();
      await running;
    }
  });
  it('recupera concessão expirada e impede finalização antiga', async () => {
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    payments.reconcile.mockImplementationOnce(() => {
      entered();
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    const old = runner.run('payments');
    await started;
    const oldLease = (
      await prisma.backgroundJob.findUniqueOrThrow({
        where: { name: 'payments' },
      })
    ).leaseId;
    await prisma.$executeRaw`UPDATE background_jobs SET "leaseExpiresAt" = NOW() - INTERVAL '1 second' WHERE name = 'payments' AND "leaseId" = ${oldLease}::uuid`;
    await runner.run('payments');
    const current = await prisma.backgroundJob.findUniqueOrThrow({
      where: { name: 'payments' },
    });
    release();
    await expect(old).rejects.toMatchObject({ status: 503 });
    expect(
      await prisma.backgroundJob.findUniqueOrThrow({
        where: { name: 'payments' },
      }),
    ).toEqual(current);
  });
  it('libera erro com diagnóstico seguro e permite execução seguinte', async () => {
    payments.reconcile.mockRejectedValueOnce(
      new Error('erro-bruto-confidencial'),
    );
    await request(app.getHttpServer())
      .get('/internal/jobs/payments')
      .set('Authorization', `Bearer ${secret}`)
      .expect(503)
      .expect('Cache-Control', 'no-store')
      .expect((res) => {
        expect(JSON.stringify(res.body)).not.toContain('erro-bruto');
      });
    const row = await prisma.backgroundJob.findUniqueOrThrow({
      where: { name: 'payments' },
    });
    expect(row).toMatchObject({
      leaseId: null,
      errorCode: 'JOB_FAILED',
      failureCount: 1,
    });
    await runner.run('payments');
  });
  it('lease ativa preexistente não é sobrescrita pelo claim', async () => {
    const leaseId = randomUUID();
    await prisma.backgroundJob.update({
      where: { name: 'emails' },
      data: { leaseId, leaseExpiresAt: new Date(Date.now() + 300_000) },
    });
    await expect(runner.run('emails')).rejects.toMatchObject({ status: 409 });
    expect(
      (
        await prisma.backgroundJob.findUniqueOrThrow({
          where: { name: 'emails' },
        })
      ).leaseId,
    ).toBe(leaseId);
  });
});
