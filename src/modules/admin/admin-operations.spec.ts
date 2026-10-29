import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminService } from './admin.service.js';
import { AdminController } from './admin.controller.js';
import type { PrismaService } from '../../prisma.service.js';
import type { OperationsQueryDto } from './operations-query.dto.js';
import type { Response } from 'express';

describe('Diagnóstico administrativo seguro (/admin/operations)', () => {
  let adminService: AdminService;
  let adminController: AdminController;

  const prismaMock = {
    backgroundJob: { findMany: vi.fn() },
    emailOutbox: { groupBy: vi.fn(), findFirst: vi.fn() },
    accessEmailOutbox: { groupBy: vi.fn(), findFirst: vi.fn() },
    paymentAttempt: { findMany: vi.fn(), count: vi.fn() },
  };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('BACKGROUND_JOBS_ENABLED', 'true');
    vi.stubEnv('BACKGROUND_TIMERS_ENABLED', 'true');
    vi.stubEnv('EMAIL_DELIVERY_ENABLED', 'true');
    vi.stubEnv('PAYMENT_RECONCILIATION_ENABLED', 'true');
    vi.stubEnv('CRON_SECRET', 'secret-must-never-be-exposed-123456');
    vi.stubEnv('RESEND_API_KEY', 'resend-secret-key-123456');

    adminService = new AdminService(prismaMock as unknown as PrismaService);
    adminController = new AdminController(adminService);
  });

  it('retorna select mínimo seguro sem expor segredos nem dados de pagador', async () => {
    const now = new Date();
    prismaMock.backgroundJob.findMany.mockResolvedValue([
      {
        name: 'emails',
        startedAt: now,
        finishedAt: now,
        lastSucceededAt: now,
        lastFailedAt: null,
        status: 'completed',
        errorCode: null,
        runCount: 10,
        failureCount: 0,
        processedCount: 8,
        succeededCount: 8,
        failedCount: 0,
        skippedCount: 0,
        leaseId: null,
        leaseExpiresAt: null,
      },
      {
        name: 'payments',
        startedAt: now,
        finishedAt: now,
        lastSucceededAt: null,
        lastFailedAt: now,
        status: 'partial',
        errorCode: 'PARTIAL_FAILURE',
        runCount: 5,
        failureCount: 1,
        processedCount: 6,
        succeededCount: 4,
        failedCount: 2,
        skippedCount: 0,
        leaseId: 'a4df2bf7-0000-0000-0000-000000000000',
        leaseExpiresAt: new Date(Date.now() + 180_000),
      },
    ]);

    prismaMock.emailOutbox.groupBy.mockResolvedValue([
      { status: 'pending', _count: 2 },
      { status: 'sent', _count: 15 },
    ]);
    prismaMock.emailOutbox.findFirst.mockResolvedValue({
      nextAttemptAt: now,
    });

    prismaMock.accessEmailOutbox.groupBy.mockResolvedValue([
      { status: 'pending', _count: 1 },
      { status: 'sent', _count: 9 },
    ]);
    prismaMock.accessEmailOutbox.findFirst.mockResolvedValue(null);

    prismaMock.paymentAttempt.findMany.mockResolvedValue([
      {
        id: 'attempt-uuid-1',
        registrationId: 'reg-uuid-1',
        method: 'pix',
        amountInCents: 5000,
        status: 'pending',
        lastSyncAttemptAt: now,
        lastSyncSucceededAt: null,
        lastSyncErrorCode: 'provider_unavailable',
        createdAt: now,
        updatedAt: now,
        registration: {
          event: { id: 'evt-1', title: 'Simpósio de IA' },
        },
      },
    ]);
    prismaMock.paymentAttempt.count.mockResolvedValue(1);

    const query: OperationsQueryDto = { page: 1, limit: 20 };
    const setHeader = vi.fn();
    const res = { setHeader } as unknown as Response;

    const result = await adminController.operations(query, res);

    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');

    // Flags apenas booleanas
    expect(result.flags).toEqual({
      backgroundJobsEnabled: true,
      backgroundTimersEnabled: true,
      emailDeliveryEnabled: true,
      paymentReconciliationEnabled: true,
    });

    // Nenhum segredo
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('secret-must-never-be-exposed');
    expect(serialized).not.toContain('resend-secret-key');
    expect(serialized).not.toContain('payer');
    expect(serialized).not.toContain('credentials');
    expect(serialized).not.toContain('checkout');

    // Rotinas
    expect(result.routines).toHaveLength(2);
    expect(result.routines[0].name).toBe('emails');
    expect(result.routines[0].status).toBe('completed');
    expect(result.routines[0].activeLease).toBe(false);

    expect(result.routines[1].name).toBe('payments');
    expect(result.routines[1].status).toBe('partial');
    expect(result.routines[1].activeLease).toBe(true);

    // Filas
    expect(result.queues.confirmation.pending).toBe(2);
    expect(result.queues.confirmation.sent).toBe(15);
    expect(result.queues.access.pending).toBe(1);
    expect(result.queues.access.sent).toBe(9);

    // Pagamentos com falha de sync paginados
    expect(result.failedPayments.items).toHaveLength(1);
    expect(result.failedPayments.items[0]).toEqual({
      id: 'attempt-uuid-1',
      registrationId: 'reg-uuid-1',
      event: { id: 'evt-1', title: 'Simpósio de IA' },
      method: 'pix',
      amountInCents: 5000,
      status: 'pending',
      lastSyncAttemptAt: now,
      lastSyncSucceededAt: null,
      lastSyncErrorCode: 'provider_unavailable',
      createdAt: now,
      updatedAt: now,
    });
  });

  it.each([true, false])(
    'não trata execução sem término como sucesso; lease ativo=%s',
    async (active) => {
      const lastSucceededAt = new Date('2026-10-26T12:00:00Z');
      prismaMock.backgroundJob.findMany.mockResolvedValue([
        {
          name: 'emails',
          startedAt: new Date(),
          finishedAt: null,
          lastSucceededAt,
          status: 'completed',
          succeededCount: 8,
          leaseExpiresAt: new Date(Date.now() + (active ? 300000 : -1)),
        },
      ]);
      prismaMock.emailOutbox.groupBy.mockResolvedValue([]);
      prismaMock.emailOutbox.findFirst.mockResolvedValue(null);
      prismaMock.accessEmailOutbox.groupBy.mockResolvedValue([]);
      prismaMock.accessEmailOutbox.findFirst.mockResolvedValue(null);
      prismaMock.paymentAttempt.findMany.mockResolvedValue([]);
      prismaMock.paymentAttempt.count.mockResolvedValue(0);
      const result = await adminService.operations({ page: 1, limit: 20 });
      expect(result.routines[0]).toMatchObject({
        status: active ? 'running' : 'unfinished',
        activeLease: active,
        lastSucceededAt,
        succeededCount: null,
        processedCount: null,
        failedCount: null,
        skippedCount: null,
      });
    },
  );

  it('retorna erro genérico quando o banco está indisponível', async () => {
    prismaMock.backgroundJob.findMany.mockRejectedValue(
      new Error('banco de dados fora do ar'),
    );

    const query: OperationsQueryDto = { page: 1, limit: 20 };
    const res = { setHeader: vi.fn() } as unknown as Response;

    await expect(adminController.operations(query, res)).rejects.toMatchObject({
      status: 503,
      message: 'Diagnóstico operacional indisponível.',
    });
  });
});
