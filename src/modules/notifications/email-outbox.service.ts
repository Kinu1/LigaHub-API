import {
  AccessEmailProcessor,
  type AccessBatchResult,
} from './access-email.processor.js';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma.service.js';
import { encryptCredential } from '../payments/payment-security.js';
import { renderConfirmation } from './confirmation-email.js';
import {
  readPayload,
  readMessage,
  validateConfirmation,
} from './outbox-payload.js';
import { EmailGateway, selectedEmailProvider } from './email.gateway.js';

export type OutboxBatchResult = {
  status: 'completed' | 'partial' | 'failed' | 'skipped';
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  errorCode?: string | null;
  access?: AccessBatchResult;
  confirmation?: {
    processed: number;
    succeeded: number;
    failed: number;
    skipped: number;
  };
};

@Injectable()
export class EmailOutboxService {
  private busy = false;
  private readonly logger = new Logger(EmailOutboxService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EmailGateway) private readonly gateway: EmailGateway,
    @Inject(AccessEmailProcessor)
    private readonly accessEmails: AccessEmailProcessor,
  ) {}

  async processBatch(registrationId?: string): Promise<OutboxBatchResult> {
    if (this.busy) {
      return {
        status: 'skipped',
        processed: 0,
        succeeded: 0,
        failed: 0,
        skipped: 0,
        errorCode: 'BUSY',
      };
    }
    if (process.env.EMAIL_DELIVERY_ENABLED !== 'true') {
      return {
        status: 'skipped',
        processed: 0,
        succeeded: 0,
        failed: 0,
        skipped: 0,
        errorCode: 'DISABLED',
      };
    }
    if (
      !(selectedEmailProvider() === 'smtp'
        ? process.env.SMTP_HOST
        : process.env.RESEND_API_KEY) ||
      !process.env.EMAIL_FROM ||
      !process.env.FRONTEND_URL
    ) {
      return {
        status: 'failed',
        processed: 0,
        succeeded: 0,
        failed: 0,
        skipped: 0,
        errorCode: 'CONFIG_UNAVAILABLE',
      };
    }

    // Falha global de chave/configuracao nao deve classificar toda a fila como invalida.
    encryptCredential('outbox-preflight');
    renderConfirmation({
      registrationId: 'preflight',
      to: 'preflight@example.com',
      name: '',
      eventTitle: '',
      location: '',
      token: 'preflight',
    });

    this.busy = true;
    let confProcessed = 0;
    let confSucceeded = 0;
    let confFailed = 0;
    let confSkipped = 0;
    let accessResult: AccessBatchResult | undefined;

    try {
      accessResult = await this.accessEmails.processBatch(registrationId);
      for (let i = 0; i < 10; i++) {
        const item = await this.claim(registrationId);
        if (!item) break;
        confProcessed++;
        if (item.status === 'skipped') {
          confSkipped++;
          continue;
        }
        if (item.status === 'failed') {
          confFailed++;
          continue;
        }
        if (!item.payloadEncrypted) continue;
        try {
          const message = readMessage(item.payloadEncrypted);
          const providerId = await this.gateway.send(
            message,
            `confirmation/${item.id}`,
          );
          const updated = await this.prisma.emailOutbox.updateMany({
            where: { id: item.id, leaseId: item.leaseId, status: 'processing' },
            data: {
              status: 'sent',
              providerId,
              sentAt: new Date(),
              payloadEncrypted: null,
              leaseId: null,
              leaseExpiresAt: null,
            },
          });
          // Aguardar write count condicionado ao lease antes de contabilizar aceite persistido.
          if (updated.count === 1) {
            confSucceeded++;
          } else {
            confFailed++;
            this.logger.warn(
              `Concessão perdida na confirmação ${item.id}; atualização não confirmada.`,
            );
          }
        } catch {
          await this.prisma.emailOutbox.updateMany({
            where: { id: item.id, leaseId: item.leaseId, status: 'processing' },
            data: {
              status: item.attempts >= 8 ? 'failed' : 'pending',
              nextAttemptAt: new Date(
                Date.now() +
                  Math.min(60_000 * 2 ** (item.attempts - 1), 3_600_000),
              ),
              leaseId: null,
              leaseExpiresAt: null,
            },
          });
          confFailed++;
          this.logger.warn(
            `Falha no envio da confirmação ${item.id}; tentativa ${item.attempts}.`,
          );
        }
      }
    } finally {
      this.busy = false;
    }

    const totalProcessed = confProcessed + (accessResult?.processed ?? 0);
    const totalSucceeded = confSucceeded + (accessResult?.succeeded ?? 0);
    const totalFailed = confFailed + (accessResult?.failed ?? 0);
    const totalSkipped = confSkipped + (accessResult?.skipped ?? 0);

    let status: 'completed' | 'partial' | 'failed' = 'completed';
    let errorCode: string | null = null;
    if (totalFailed > 0 && totalSucceeded > 0) {
      status = 'partial';
      errorCode = 'PARTIAL_FAILURE';
    } else if (totalFailed > 0 && totalSucceeded === 0) {
      status = 'failed';
      errorCode = 'JOB_FAILED';
    }

    return {
      status,
      processed: totalProcessed,
      succeeded: totalSucceeded,
      failed: totalFailed,
      skipped: totalSkipped,
      errorCode,
      access: accessResult,
      confirmation: {
        processed: confProcessed,
        succeeded: confSucceeded,
        failed: confFailed,
        skipped: confSkipped,
      },
    };
  }

  private async claim(registrationId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM email_outbox WHERE ((status = 'pending' AND "nextAttemptAt" <= NOW()) OR (status = 'processing' AND "leaseExpiresAt" < NOW())) AND (${registrationId ?? null}::uuid IS NULL OR "registrationId" = ${registrationId ?? null}::uuid) ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1`;
      if (!rows[0]) return null;
      const item = await tx.emailOutbox.findUniqueOrThrow({
        where: { id: rows[0].id },
      });
      {
        const registration = await tx.registration.findUniqueOrThrow({
          where: { id: item.registrationId },
        });
        if (
          registration.status !== 'confirmed' ||
          registration.suspendedAt ||
          !registration.statusTokenExpiresAt ||
          registration.statusTokenExpiresAt <= new Date()
        ) {
          await tx.emailOutbox.update({
            where: { id: item.id },
            data: {
              status: 'skipped',
              payloadEncrypted: null,
              leaseId: null,
              leaseExpiresAt: null,
            },
          });
          return { ...item, status: 'skipped', payloadEncrypted: null };
        }
      }
      // Resend mantém as chaves por 24h. Nunca repetir automaticamente fora dessa janela.
      if (
        item.attempts >= 8 ||
        (item.firstAttemptAt &&
          Date.now() - item.firstAttemptAt.getTime() >= 23 * 3_600_000) ||
        !item.payloadEncrypted
      ) {
        await tx.emailOutbox.update({
          where: { id: item.id },
          data: { status: 'failed', leaseId: null, leaseExpiresAt: null },
        });
        return { ...item, status: 'failed', payloadEncrypted: null };
      }
      let payloadEncrypted: string;
      try {
        const payload = readPayload(item.payloadEncrypted);
        if (payload.message) {
          readMessage(item.payloadEncrypted);
          payloadEncrypted = item.payloadEncrypted;
        } else {
          validateConfirmation(payload, item.registrationId);
          payloadEncrypted = encryptCredential(
            JSON.stringify({
              message: renderConfirmation(
                payload as Parameters<typeof renderConfirmation>[0],
              ),
            }),
          );
        }
      } catch {
        await tx.emailOutbox.update({
          where: { id: item.id },
          data: { status: 'failed', leaseId: null, leaseExpiresAt: null },
        });
        this.logger.warn(`Payload invalido na confirmacao ${item.id}.`);
        return { ...item, status: 'failed', payloadEncrypted: null };
      }
      return tx.emailOutbox.update({
        where: { id: item.id },
        data: {
          status: 'processing',
          leaseId: randomUUID(),
          leaseExpiresAt: new Date(Date.now() + 90_000),
          firstAttemptAt: item.firstAttemptAt ?? new Date(),
          attempts: { increment: 1 },
          payloadEncrypted,
        },
      });
    });
  }
}
