import type { AccessEmailProcessor } from '../notifications/access-email.processor.js';
import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { JobsGuard } from './jobs.guard.js';
import { JobsRunner } from './jobs.runner.js';
import { JobsSchedule } from './jobs.schedule.js';
import { EmailOutboxService } from '../notifications/email-outbox.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import type { PrismaService } from '../../prisma.service.js';
import type { EmailGateway } from '../notifications/email.gateway.js';
import type { PaymentGateway } from '../payments/payment.gateway.js';
import type { PaymentAccountsService } from '../payments/payment-accounts.service.js';

const secret = 'a'.repeat(64);
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function context(header?: string) {
  const setHeader = vi.fn();
  return {
    setHeader,
    value: {
      switchToHttp: () => ({
        getRequest: () => ({ headers: { authorization: header } }),
        getResponse: () => ({ setHeader }),
      }),
    } as unknown as ExecutionContext,
  };
}

describe('Autorização das rotinas', () => {
  it.each([undefined, 'false', 'TRUE'])(
    'exige habilitação explícita: %s',
    (flag) => {
      vi.stubEnv('BACKGROUND_JOBS_ENABLED', flag);
      const ctx = context();
      expect(() => new JobsGuard().canActivate(ctx.value)).toThrow(
        expect.objectContaining({ status: 404 }),
      );
      expect(ctx.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    },
  );
  it.each([undefined, '', 'curto', 'a'.repeat(257), ' '.repeat(64)])(
    'recusa configuração inválida',
    (value) => {
      vi.stubEnv('BACKGROUND_JOBS_ENABLED', 'true');
      vi.stubEnv('CRON_SECRET', value);
      expect(() => new JobsGuard().canActivate(context().value)).toThrow(
        expect.objectContaining({ status: 503 }),
      );
    },
  );
  it.each([
    undefined,
    '',
    'Basic abc',
    `Bearer ${'b'.repeat(64)}`,
    `Bearer ${secret} extra`,
  ])('recusa credencial inválida', (header) => {
    vi.stubEnv('BACKGROUND_JOBS_ENABLED', 'true');
    vi.stubEnv('CRON_SECRET', secret);
    expect(() => new JobsGuard().canActivate(context(header).value)).toThrow(
      expect.objectContaining({ status: 401 }),
    );
  });
  it('aceita Bearer válido', () => {
    vi.stubEnv('BACKGROUND_JOBS_ENABLED', 'true');
    vi.stubEnv('CRON_SECRET', secret);
    expect(new JobsGuard().canActivate(context(`Bearer ${secret}`).value)).toBe(
      true,
    );
  });
});

describe('Flags e coordenador JobsSchedule', () => {
  const queryRaw = vi.fn();
  const prisma = { $queryRaw: queryRaw } as unknown as PrismaService;
  const emails = { processBatch: vi.fn() } as unknown as EmailOutboxService;
  const payments = { reconcile: vi.fn() } as unknown as PaymentsService;

  it.each(['emails', 'payments'] as const)(
    'não reivindica %s desabilitado via HTTP',
    async (name) => {
      vi.stubEnv('BACKGROUND_JOBS_ENABLED', 'true');
      vi.stubEnv('EMAIL_DELIVERY_ENABLED', 'false');
      vi.stubEnv('PAYMENT_RECONCILIATION_ENABLED', 'false');
      await expect(
        new JobsRunner(prisma, emails, payments).run(name),
      ).rejects.toMatchObject({ status: 503 });
      expect(queryRaw).not.toHaveBeenCalled();
    },
  );

  it('usa o provedor selecionado antes de reivindicar', async () => {
    vi.stubEnv('BACKGROUND_JOBS_ENABLED', 'true');
    vi.stubEnv('EMAIL_DELIVERY_ENABLED', 'true');
    vi.stubEnv('EMAIL_PROVIDER', 'resend');
    vi.stubEnv('SMTP_HOST', 'localhost');
    vi.stubEnv('RESEND_API_KEY', '');
    vi.stubEnv(
      'CREDENTIALS_ENCRYPTION_KEY',
      Buffer.alloc(32, 1).toString('base64'),
    );
    await expect(
      new JobsRunner(prisma, emails, payments).run('emails'),
    ).rejects.toMatchObject({ status: 503 });
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('JobsSchedule respeita BACKGROUND_TIMERS_ENABLED=false e limpa no onDestroy', () => {
    vi.stubEnv('BACKGROUND_TIMERS_ENABLED', 'false');
    vi.stubEnv('EMAIL_DELIVERY_ENABLED', 'true');
    vi.stubEnv('PAYMENT_RECONCILIATION_ENABLED', 'true');
    const intervalSpy = vi.spyOn(globalThis, 'setInterval');
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

    const runner = new JobsRunner(prisma, emails, payments);
    const schedule = new JobsSchedule(runner);
    schedule.onModuleInit();
    expect(intervalSpy).not.toHaveBeenCalled();

    schedule.onModuleDestroy();
    expect(clearIntervalSpy).not.toHaveBeenCalled();
  });

  it('JobsSchedule inicia timers independentemente de BACKGROUND_JOBS_ENABLED', () => {
    vi.stubEnv('BACKGROUND_JOBS_ENABLED', 'false'); // HTTP desabilitado
    vi.stubEnv('BACKGROUND_TIMERS_ENABLED', 'true');
    vi.stubEnv('EMAIL_DELIVERY_ENABLED', 'true');
    vi.stubEnv('PAYMENT_RECONCILIATION_ENABLED', 'true');

    const intervalSpy = vi
      .spyOn(globalThis, 'setInterval')
      .mockReturnValue({ unref: vi.fn() } as unknown as ReturnType<
        typeof setInterval
      >);
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

    const runner = new JobsRunner(prisma, emails, payments);
    const schedule = new JobsSchedule(runner);
    schedule.onModuleInit();

    // Cria os dois timers (15s para emails e 60s para pagamentos)
    expect(intervalSpy).toHaveBeenCalledTimes(2);
    expect(intervalSpy).toHaveBeenNthCalledWith(
      1,
      expect.any(Function),
      15_000,
    );
    expect(intervalSpy).toHaveBeenNthCalledWith(
      2,
      expect.any(Function),
      60_000,
    );

    schedule.onModuleDestroy();
    expect(clearIntervalSpy).toHaveBeenCalledTimes(2);
  });

  it('métodos manuais permanecem utilizáveis', async () => {
    vi.stubEnv('BACKGROUND_TIMERS_ENABLED', 'false');
    vi.stubEnv('EMAIL_DELIVERY_ENABLED', 'true');
    vi.stubEnv('PAYMENT_RECONCILIATION_ENABLED', 'false');
    vi.stubEnv('EMAIL_PROVIDER', 'smtp');
    vi.stubEnv('SMTP_HOST', 'localhost');
    vi.stubEnv('EMAIL_FROM', 'teste@example.com');
    vi.stubEnv('FRONTEND_URL', 'http://localhost:5173');
    vi.stubEnv(
      'CREDENTIALS_ENCRYPTION_KEY',
      Buffer.alloc(32, 1).toString('base64'),
    );
    const transaction = vi.fn().mockResolvedValue(null);
    const processAccess = vi
      .fn()
      .mockResolvedValue({ processed: 0, succeeded: 0, failed: 0, skipped: 0 });
    const manualMail = new EmailOutboxService(
      { $transaction: transaction } as unknown as PrismaService,
      {} as EmailGateway,
      { processBatch: processAccess } as unknown as AccessEmailProcessor,
    );
    const mailRes = await manualMail.processBatch();
    expect(transaction).toHaveBeenCalledOnce();
    expect(mailRes.status).toBe('completed');

    const findMany = vi.fn().mockResolvedValue([]);
    const manualPay = new PaymentsService(
      { paymentAttempt: { findMany } } as unknown as PrismaService,
      {} as PaymentGateway,
      {} as PaymentAccountsService,
    );
    const payRes = await manualPay.reconcile();
    expect(findMany).toHaveBeenCalledOnce();
    expect(payRes.status).toBe('completed');
  });
});

describe('Integração de resultados reais no JobsRunner', () => {
  it('não transforma ausência de resultado em sucesso', async () => {
    vi.stubEnv('BACKGROUND_JOBS_ENABLED', 'true');
    vi.stubEnv('PAYMENT_RECONCILIATION_ENABLED', 'true');
    vi.stubEnv(
      'CREDENTIALS_ENCRYPTION_KEY',
      Buffer.alloc(32, 1).toString('base64'),
    );
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([{ name: 'payments' }]),
      backgroundJob: { updateMany },
    } as unknown as PrismaService;
    const runner = new JobsRunner(
      prisma,
      {} as EmailOutboxService,
      {
        reconcile: vi.fn().mockResolvedValue(undefined),
      } as unknown as PaymentsService,
    );
    await expect(runner.run('payments')).rejects.toMatchObject({
      status: 503,
      response: expect.objectContaining({ errorCode: 'INVALID_RESULT' }),
    });
    expect(updateMany.mock.calls[0][0].data.lastSucceededAt).toBeUndefined();
  });
  it('avança lastSucceededAt apenas quando conclui sem falhas', async () => {
    vi.stubEnv('BACKGROUND_JOBS_ENABLED', 'true');
    vi.stubEnv('PAYMENT_RECONCILIATION_ENABLED', 'true');
    vi.stubEnv(
      'CREDENTIALS_ENCRYPTION_KEY',
      Buffer.alloc(32, 1).toString('base64'),
    );

    const queryRaw = vi.fn().mockResolvedValue([{ name: 'payments' }]);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      $queryRaw: queryRaw,
      backgroundJob: { updateMany },
    } as unknown as PrismaService;

    const emails = {} as EmailOutboxService;
    const payments = {
      reconcile: vi.fn().mockResolvedValue({
        status: 'completed',
        processed: 5,
        succeeded: 5,
        failed: 0,
        skipped: 0,
      }),
    } as unknown as PaymentsService;

    const runner = new JobsRunner(prisma, emails, payments);
    const res = await runner.run('payments');
    expect(res.status).toBe('completed');
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'completed',
          errorCode: null,
          lastSucceededAt: expect.any(Date),
          processedCount: 5,
          succeededCount: 5,
          failedCount: 0,
        }),
      }),
    );
  });

  it('falha parcial não avança lastSucceededAt e registra lastFailedAt e contadores', async () => {
    vi.stubEnv('BACKGROUND_JOBS_ENABLED', 'true');
    vi.stubEnv('PAYMENT_RECONCILIATION_ENABLED', 'true');
    vi.stubEnv(
      'CREDENTIALS_ENCRYPTION_KEY',
      Buffer.alloc(32, 1).toString('base64'),
    );

    const queryRaw = vi.fn().mockResolvedValue([{ name: 'payments' }]);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      $queryRaw: queryRaw,
      backgroundJob: { updateMany },
    } as unknown as PrismaService;

    const emails = {} as EmailOutboxService;
    const payments = {
      reconcile: vi.fn().mockResolvedValue({
        status: 'partial',
        processed: 5,
        succeeded: 3,
        failed: 2,
        skipped: 0,
        errorCode: 'PARTIAL_FAILURE',
      }),
    } as unknown as PaymentsService;

    const runner = new JobsRunner(prisma, emails, payments);
    await expect(runner.run('payments')).rejects.toMatchObject({
      status: 503,
      response: expect.objectContaining({
        routine: 'payments',
        status: 'partial',
        processed: 5,
        succeeded: 3,
        failed: 2,
      }),
    });

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'partial',
          errorCode: 'PARTIAL_FAILURE',
          lastFailedAt: expect.any(Date),
          failureCount: { increment: 1 },
          processedCount: 5,
          succeededCount: 3,
          failedCount: 2,
        }),
      }),
    );
    // lastSucceededAt NÃO deve estar no update de falha
    const callArgs = updateMany.mock.calls[0][0].data;
    expect(callArgs.lastSucceededAt).toBeUndefined();
  });

  it('ocupado (busy) / skipped não altera lastSucceededAt nem conta como sucesso', async () => {
    vi.stubEnv('BACKGROUND_JOBS_ENABLED', 'true');
    vi.stubEnv('PAYMENT_RECONCILIATION_ENABLED', 'true');
    vi.stubEnv(
      'CREDENTIALS_ENCRYPTION_KEY',
      Buffer.alloc(32, 1).toString('base64'),
    );

    const queryRaw = vi.fn().mockResolvedValue([{ name: 'payments' }]);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      $queryRaw: queryRaw,
      backgroundJob: { updateMany },
    } as unknown as PrismaService;

    const emails = {} as EmailOutboxService;
    const payments = {
      reconcile: vi.fn().mockResolvedValue({
        status: 'skipped',
        processed: 0,
        succeeded: 0,
        failed: 0,
        skipped: 0,
        errorCode: 'BUSY',
      }),
    } as unknown as PaymentsService;

    const runner = new JobsRunner(prisma, emails, payments);
    await expect(runner.run('payments')).rejects.toMatchObject({
      status: 409,
    });

    const callArgs = updateMany.mock.calls[0][0].data;
    expect(callArgs.status).toBe('skipped');
    expect(callArgs.lastSucceededAt).toBeUndefined();
    expect(callArgs.lastFailedAt).toBeUndefined();
  });
});
