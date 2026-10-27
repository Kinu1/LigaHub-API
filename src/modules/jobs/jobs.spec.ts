import type { AccessEmailProcessor } from '../notifications/access-email.processor.js';
import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { JobsGuard } from './jobs.guard.js';
import { JobsRunner } from './jobs.runner.js';
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
describe('Flags e timers', () => {
  const queryRaw = vi.fn();
  const prisma = { $queryRaw: queryRaw } as unknown as PrismaService;
  const emails = { processBatch: vi.fn() } as unknown as EmailOutboxService;
  const payments = { reconcile: vi.fn() } as unknown as PaymentsService;
  it.each(['emails', 'payments'] as const)(
    'não reivindica %s desabilitado',
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
  it('desliga ambos os timers e mantém métodos manuais', async () => {
    vi.stubEnv('BACKGROUND_TIMERS_ENABLED', 'false');
    vi.stubEnv('EMAIL_DELIVERY_ENABLED', 'true');
    vi.stubEnv('PAYMENT_RECONCILIATION_ENABLED', 'true');
    const interval = vi.spyOn(globalThis, 'setInterval');
    const mail = new EmailOutboxService(
      prisma,
      {} as EmailGateway,
      {} as AccessEmailProcessor,
    );
    const pay = new PaymentsService(
      prisma,
      {} as PaymentGateway,
      {} as PaymentAccountsService,
    );
    mail.onModuleInit();
    pay.onModuleInit();
    expect(interval).not.toHaveBeenCalled();
    vi.stubEnv('EMAIL_PROVIDER', 'smtp');
    vi.stubEnv('SMTP_HOST', 'localhost');
    vi.stubEnv('EMAIL_FROM', 'teste@example.com');
    vi.stubEnv('FRONTEND_URL', 'http://localhost:5173');
    vi.stubEnv(
      'CREDENTIALS_ENCRYPTION_KEY',
      Buffer.alloc(32, 1).toString('base64'),
    );
    const transaction = vi.fn().mockResolvedValue(null);
    const processAccess = vi.fn().mockResolvedValue(undefined);
    const manualMail = new EmailOutboxService(
      { $transaction: transaction } as unknown as PrismaService,
      {} as EmailGateway,
      { processBatch: processAccess } as unknown as AccessEmailProcessor,
    );
    await manualMail.processBatch();
    expect(transaction).toHaveBeenCalledOnce();
    expect(processAccess).toHaveBeenCalledExactlyOnceWith(undefined);
    const findMany = vi.fn().mockResolvedValue([]);
    const manual = new PaymentsService(
      { paymentAttempt: { findMany } } as unknown as PrismaService,
      {} as PaymentGateway,
      {} as PaymentAccountsService,
    );
    await manual.reconcile();
    expect(findMany).toHaveBeenCalledOnce();
  });
});
