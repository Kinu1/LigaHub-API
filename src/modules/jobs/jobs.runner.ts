import {
  ConflictException,
  Inject,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma.service.js';
import { EmailOutboxService } from '../notifications/email-outbox.service.js';
import { selectedEmailProvider } from '../notifications/email.gateway.js';
import { renderConfirmation } from '../notifications/confirmation-email.js';
import { encryptCredential } from '../payments/payment-security.js';
import { PaymentsService } from '../payments/payments.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PixPayoutsService } from '../payments/pix-payouts.service.js';
import { payoutMode } from '../payments/pix-payout.policy.js';

import { CommunicationsProcessor } from '../communications/communications.processor.js';

export type JobName = 'emails' | 'payments';
export type JobSource = 'http' | 'timer' | 'scheduler';

export type JobRunOptions = {
  source?: JobSource;
  deadline?: number;
};

export type JobOutcome = {
  routine: JobName;
  status: 'completed' | 'partial' | 'failed' | 'skipped';
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  errorCode?: string | null;
};

@Injectable()
export class JobsRunner {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EmailOutboxService) private readonly emails: EmailOutboxService,
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Optional()
    @Inject(PixPayoutsService)
    private readonly payouts?: PixPayoutsService,
    @Optional()
    @Inject(CommunicationsProcessor)
    private readonly communications?: CommunicationsProcessor,
  ) {}

  private preflight(name: JobName, source: JobSource = 'http') {
    try {
      if (source === 'http' || source === 'scheduler') {
        if (source === 'http' && process.env.BACKGROUND_JOBS_ENABLED !== 'true')
          throw new Error();
        if (
          process.env[
            name === 'emails'
              ? 'EMAIL_DELIVERY_ENABLED'
              : 'PAYMENT_RECONCILIATION_ENABLED'
          ] !== 'true'
        )
          throw new Error();
      } else {
        // source === 'timer'
        if (name === 'emails') {
          if (process.env.EMAIL_DELIVERY_ENABLED !== 'true') throw new Error();
        } else {
          if (process.env.PAYMENT_RECONCILIATION_ENABLED === 'false')
            throw new Error();
        }
      }
      encryptCredential('jobs-preflight');
      if (name === 'emails') {
        if (
          !(selectedEmailProvider() === 'smtp'
            ? process.env.SMTP_HOST
            : process.env.RESEND_API_KEY) ||
          !process.env.EMAIL_FROM ||
          !process.env.FRONTEND_URL
        )
          throw new Error();
        renderConfirmation({
          registrationId: 'preflight',
          to: 'preflight@example.com',
          name: '',
          eventTitle: '',
          location: '',
          token: 'preflight',
        });
      }
    } catch {
      throw new ServiceUnavailableException(
        'Rotina ou configuração indisponível.',
      );
    }
  }

  async run(name: JobName, options?: JobRunOptions): Promise<JobOutcome> {
    const source = options?.source ?? 'http';
    this.preflight(name, source);
    const leaseId = randomUUID();
    let claimed: { name: string }[];
    try {
      claimed = await this.prisma.$queryRaw<{ name: string }[]>`
        INSERT INTO background_jobs (name, "leaseId", "leaseExpiresAt", "startedAt", "runCount", "failureCount")
        VALUES (${name}, ${leaseId}::uuid, NOW() + INTERVAL '5 minutes', NOW(), 1, 0)
        ON CONFLICT (name) DO UPDATE SET "leaseId" = EXCLUDED."leaseId",
          "leaseExpiresAt" = EXCLUDED."leaseExpiresAt", "startedAt" = NOW(),
          "finishedAt" = NULL, "errorCode" = NULL, "runCount" = background_jobs."runCount" + 1
        WHERE background_jobs."leaseExpiresAt" IS NULL OR background_jobs."leaseExpiresAt" <= NOW()
        RETURNING name`;
    } catch {
      throw new ServiceUnavailableException(
        'Controle de rotinas indisponível.',
      );
    }
    if (!claimed.length) throw new ConflictException('Rotina já em execução.');

    let outcome: {
      status: 'completed' | 'partial' | 'failed' | 'skipped';
      processed: number;
      succeeded: number;
      failed: number;
      skipped: number;
      errorCode?: string | null;
    };

    try {
      // Dá tempo aos repasses já enfileirados mesmo com um histórico grande
      // de pagamentos para reconciliar. Novas confirmações entram no ciclo seguinte.
      const transfers =
        name === 'payments' &&
        this.payouts &&
        payoutMode() === 'automatic' &&
        process.env.MERCADO_PAGO_PAYOUTS_ENABLED === 'true'
          ? await this.payouts.process(
              Math.min(options?.deadline ?? Infinity, Date.now() + 60_000),
            )
          : undefined;
      // All email queues share a deadline shorter than the five-minute job lease.
      const emailDeadline = Math.min(
        options?.deadline ?? Infinity,
        Date.now() + 240_000,
      );
      const raw =
        name === 'emails'
          ? await this.emails.processBatch(undefined, emailDeadline)
          : await this.payments.reconcile(options?.deadline);
      if (
        name === 'emails' &&
        this.communications &&
        raw &&
        ['completed', 'partial', 'failed'].includes(raw.status)
      ) {
        const comms = await this.communications.processBatch(emailDeadline);
        raw.processed += comms.processed;
        raw.succeeded += comms.succeeded;
        raw.failed += comms.failed;
        raw.skipped += comms.skipped;
        if (raw.failed) {
          raw.status = raw.succeeded ? 'partial' : 'failed';
          raw.errorCode ??= comms.errorCode;
        }
      }
      if (transfers) {
        raw.processed += transfers.processed;
        raw.succeeded += transfers.succeeded;
        raw.failed += transfers.failed;
        raw.skipped += transfers.skipped;
        if (transfers.failed > 0) {
          raw.status = raw.succeeded > 0 ? 'partial' : 'failed';
          raw.errorCode = 'PAYOUT_SYNC_FAILED';
        }
      }
      if (raw && typeof raw === 'object' && 'status' in raw) {
        outcome = {
          status: raw.status,
          processed: raw.processed ?? 0,
          succeeded: raw.succeeded ?? 0,
          failed: raw.failed ?? 0,
          skipped: raw.skipped ?? 0,
          errorCode: raw.errorCode ?? null,
        };
      } else {
        outcome = {
          status: 'failed',
          processed: 0,
          succeeded: 0,
          failed: 1,
          skipped: 0,
          errorCode: 'INVALID_RESULT',
        };
      }
    } catch {
      outcome = {
        status: 'failed',
        processed: 0,
        succeeded: 0,
        failed: 1,
        skipped: 0,
        errorCode: 'JOB_FAILED',
      };
    }

    const now = new Date();
    try {
      const data: Prisma.BackgroundJobUpdateManyMutationInput = {
        leaseId: null,
        leaseExpiresAt: null,
        finishedAt: now,
        status: outcome.status,
        processedCount: outcome.processed,
        succeededCount: outcome.succeeded,
        failedCount: outcome.failed,
        skippedCount: outcome.skipped,
        ...(outcome.status === 'completed'
          ? {
              lastSucceededAt: now,
              errorCode: null,
            }
          : outcome.status === 'partial' || outcome.status === 'failed'
            ? {
                lastFailedAt: now,
                errorCode:
                  outcome.errorCode ??
                  (outcome.status === 'partial'
                    ? 'PARTIAL_FAILURE'
                    : 'JOB_FAILED'),
                failureCount: { increment: 1 },
              }
            : {
                errorCode: outcome.errorCode ?? null,
              }),
      };

      const result = await this.prisma.backgroundJob.updateMany({
        where: { name, leaseId },
        data,
      });
      if (result.count !== 1) throw new Error();
    } catch {
      throw new ServiceUnavailableException(
        'Não foi possível finalizar o controle da rotina.',
      );
    }

    if (outcome.status === 'skipped') {
      if (outcome.errorCode === 'BUSY')
        throw new ConflictException('Rotina já em execução.');
      throw new ServiceUnavailableException(
        'Rotina ou configuração indisponível.',
      );
    }

    if (outcome.status === 'failed' || outcome.status === 'partial') {
      throw new ServiceUnavailableException({
        routine: name,
        status: outcome.status,
        processed: outcome.processed,
        succeeded: outcome.succeeded,
        failed: outcome.failed,
        skipped: outcome.skipped,
        errorCode:
          outcome.errorCode ??
          (outcome.status === 'partial' ? 'PARTIAL_FAILURE' : 'JOB_FAILED'),
      });
    }

    return {
      routine: name,
      status: 'completed',
      processed: outcome.processed,
      succeeded: outcome.succeeded,
      failed: outcome.failed,
      skipped: outcome.skipped,
    };
  }
}
