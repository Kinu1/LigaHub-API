import {
  ConflictException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma.service.js';
import { EmailOutboxService } from '../notifications/email-outbox.service.js';
import { selectedEmailProvider } from '../notifications/email.gateway.js';
import { renderConfirmation } from '../notifications/confirmation-email.js';
import { encryptCredential } from '../payments/payment-security.js';
import { PaymentsService } from '../payments/payments.service.js';

export type JobName = 'emails' | 'payments';
@Injectable()
export class JobsRunner {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EmailOutboxService) private readonly emails: EmailOutboxService,
    @Inject(PaymentsService) private readonly payments: PaymentsService,
  ) {}

  private preflight(name: JobName) {
    try {
      if (process.env.BACKGROUND_JOBS_ENABLED !== 'true') throw new Error();
      if (
        process.env[
          name === 'emails'
            ? 'EMAIL_DELIVERY_ENABLED'
            : 'PAYMENT_RECONCILIATION_ENABLED'
        ] !== 'true'
      )
        throw new Error();
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

  async run(name: JobName) {
    this.preflight(name);
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
    let failed = false;
    try {
      if (name === 'emails') await this.emails.processBatch();
      else await this.payments.reconcile();
    } catch {
      failed = true;
    }
    try {
      const now = new Date();
      const result = await this.prisma.backgroundJob.updateMany({
        where: { name, leaseId },
        data: {
          leaseId: null,
          leaseExpiresAt: null,
          finishedAt: now,
          ...(failed
            ? {
                lastFailedAt: now,
                errorCode: 'JOB_FAILED',
                failureCount: { increment: 1 },
              }
            : { lastSucceededAt: now, errorCode: null }),
        },
      });
      if (result.count !== 1) throw new Error();
    } catch {
      throw new ServiceUnavailableException(
        'Não foi possível finalizar o controle da rotina.',
      );
    }
    if (failed)
      throw new ServiceUnavailableException('Falha na execução da rotina.');
    return { routine: name, status: 'completed' };
  }
}
