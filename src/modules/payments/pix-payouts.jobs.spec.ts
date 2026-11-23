import { afterEach, describe, expect, it, vi } from 'vitest';
import { JobsRunner } from '../jobs/jobs.runner.js';
import type { PrismaService } from '../../prisma.service.js';
import type { EmailOutboxService } from '../notifications/email-outbox.service.js';
import type { PaymentsService } from './payments.service.js';
import type { PixPayoutsService } from './pix-payouts.service.js';

afterEach(() => vi.unstubAllEnvs());
describe('Agendamento dos repasses na rotina de pagamentos', () => {
  it.each([true, false])(
    'respeita habilitação explícita: %s',
    async (enabled) => {
      vi.stubEnv('MERCADO_PAGO_PAYOUTS_ENABLED', String(enabled));
      vi.stubEnv('MERCADO_PAGO_PAYOUT_MODE', 'automatic');
      vi.stubEnv('PAYMENT_RECONCILIATION_ENABLED', 'true');
      vi.stubEnv(
        'CREDENTIALS_ENCRYPTION_KEY',
        Buffer.alloc(32, 1).toString('base64'),
      );
      const prisma = {
        $queryRaw: vi.fn().mockResolvedValue([{ name: 'payments' }]),
        backgroundJob: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      };
      const reconcile = vi.fn().mockResolvedValue({
        status: 'completed',
        processed: 1,
        succeeded: 1,
        failed: 0,
        skipped: 0,
      });
      const process = vi.fn().mockResolvedValue({
        status: 'completed',
        processed: 2,
        succeeded: 2,
        failed: 0,
        skipped: 0,
      });
      const runner = new JobsRunner(
        prisma as unknown as PrismaService,
        {} as EmailOutboxService,
        { reconcile } as unknown as PaymentsService,
        { process } as unknown as PixPayoutsService,
      );
      const outcome = await runner.run('payments', {
        source: 'scheduler',
        deadline: 123,
      });
      expect(outcome.processed).toBe(enabled ? 3 : 1);
      if (enabled) expect(process).toHaveBeenCalledWith(123);
      else expect(process).not.toHaveBeenCalled();
    },
  );
});
