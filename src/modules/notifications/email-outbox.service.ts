import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
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

@Injectable()
export class EmailOutboxService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  private readonly logger = new Logger(EmailOutboxService.name);
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EmailGateway) private readonly gateway: EmailGateway,
  ) {}
  onModuleInit() {
    if (
      process.env.BACKGROUND_TIMERS_ENABLED === 'false' ||
      process.env.EMAIL_DELIVERY_ENABLED !== 'true'
    )
      return;
    this.timer = setInterval(() => {
      void this.processBatch().catch(() =>
        this.logger.warn('Falha ao processar a fila de e-mails.'),
      );
    }, 15_000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  async processBatch(registrationId?: string) {
    if (
      process.env.EMAIL_DELIVERY_ENABLED !== 'true' ||
      !(selectedEmailProvider() === 'smtp'
        ? process.env.SMTP_HOST
        : process.env.RESEND_API_KEY) ||
      !process.env.EMAIL_FROM ||
      !process.env.FRONTEND_URL ||
      this.busy
    )
      return;
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
    try {
      for (let i = 0; i < 10; i++) {
        const item = await this.claim(registrationId);
        if (!item) break;
        if (!item.payloadEncrypted) continue;
        try {
          const message = readMessage(item.payloadEncrypted);
          const providerId = await this.gateway.send(
            message,
            `confirmation/${item.id}`,
          );
          await this.prisma.emailOutbox.updateMany({
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
          this.logger.warn(
            `Falha no envio da confirmação ${item.id}; tentativa ${item.attempts}.`,
          );
        }
      }
    } finally {
      this.busy = false;
    }
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
          return { ...item, payloadEncrypted: null };
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
        return { ...item, payloadEncrypted: null };
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
        return { ...item, payloadEncrypted: null };
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
