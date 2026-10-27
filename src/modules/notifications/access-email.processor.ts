import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { encryptCredential } from '../payments/payment-security.js';
import { emailRenderConfig } from './confirmation-email.js';
import { EmailGateway, selectedEmailProvider } from './email.gateway.js';
import { readMessage } from './outbox-payload.js';

@Injectable()
export class AccessEmailProcessor {
  private readonly logger = new Logger(AccessEmailProcessor.name);
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EmailGateway) private readonly gateway: EmailGateway,
  ) {}
  preflight() {
    emailRenderConfig();
    encryptCredential('access-preflight');
    if (
      selectedEmailProvider() === 'resend'
        ? !process.env.RESEND_API_KEY
        : !process.env.SMTP_HOST
    )
      throw new Error('Configure o provedor de e-mail selecionado.');
  }
  async processBatch(registrationId?: string) {
    if (process.env.EMAIL_DELIVERY_ENABLED !== 'true') return;
    this.preflight();
    for (let i = 0; i < 10; i++) {
      const item = await this.claim(registrationId);
      if (!item) break;
      if (!item.payloadEncrypted) continue;
      try {
        const message = readMessage(item.payloadEncrypted);
        // Revalida depois do claim; nenhuma chamada de rede ocorre na transação.
        const link = await this.prisma.registrationAccessLink.findUnique({
          where: { id: item.linkId },
        });
        if (
          !link ||
          link.usedAt ||
          link.expiresAt <= new Date() ||
          item.expiresAt <= new Date()
        ) {
          await this.finish(item, {
            status: 'skipped',
            payloadEncrypted: null,
          });
          continue;
        }
        const providerId = await this.gateway.send(
          message,
          `access/${item.id}`,
        );
        await this.finish(item, {
          status: 'sent',
          providerId,
          sentAt: new Date(),
          payloadEncrypted: null,
        });
      } catch {
        const terminal = item.attempts >= 5 || item.expiresAt <= new Date();
        await this.finish(item, {
          status: terminal ? 'failed' : 'pending',
          ...(terminal ? { payloadEncrypted: null } : {}),
          nextAttemptAt: new Date(
            Date.now() + 15_000 * 2 ** (item.attempts - 1),
          ),
        });
        this.logger.warn(
          `Falha no envio do acesso ${item.id}; tentativa ${item.attempts}.`,
        );
      }
    }
  }
  private async finish(
    item: { id: string; linkId: string; leaseId: string | null },
    data: Prisma.AccessEmailOutboxUpdateManyMutationInput,
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.accessEmailOutbox.updateMany({
        where: { id: item.id, leaseId: item.leaseId, status: 'processing' },
        data: { ...data, leaseId: null, leaseExpiresAt: null },
      });
      if (
        saved.count === 1 &&
        (data.status === 'failed' || data.status === 'skipped')
      ) {
        await tx.registrationAccessLink.update({
          where: { id: item.linkId },
          data: { expiresAt: new Date() },
        });
      }
      return saved;
    });
    if (result.count !== 1)
      this.logger.warn(
        `Concessão perdida no acesso ${item.id}; atualização não confirmada.`,
      );
  }
  private async claim(registrationId?: string) {
    if (process.env.EMAIL_DELIVERY_ENABLED !== 'true') return null;
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT o.id FROM access_email_outbox o JOIN registration_access_links l ON l.id = o."linkId"
        WHERE ((o.status = 'pending' AND (o."nextAttemptAt" <= NOW() OR o."expiresAt" <= NOW() OR l."expiresAt" <= NOW() OR l."usedAt" IS NOT NULL))
          OR (o.status = 'processing' AND o."leaseExpiresAt" < NOW()))
          AND (${registrationId ?? null}::uuid IS NULL OR l."registrationId" = ${registrationId ?? null}::uuid)
        ORDER BY o."createdAt" FOR UPDATE OF o SKIP LOCKED LIMIT 1`;
      if (!rows[0]) return null;
      const item = await tx.accessEmailOutbox.findUniqueOrThrow({
        where: { id: rows[0].id },
        include: { link: true },
      });
      const invalid =
        item.link.usedAt ||
        item.link.expiresAt <= new Date() ||
        item.expiresAt <= new Date();
      let malformed = false;
      try {
        if (item.payloadEncrypted) readMessage(item.payloadEncrypted);
      } catch {
        malformed = true;
      }
      if (
        invalid ||
        item.attempts >= 5 ||
        !item.payloadEncrypted ||
        malformed
      ) {
        await tx.registrationAccessLink.update({
          where: { id: item.linkId },
          data: { expiresAt: new Date() },
        });
        return tx.accessEmailOutbox.update({
          where: { id: item.id },
          data: {
            status: invalid ? 'skipped' : 'failed',
            payloadEncrypted: null,
            leaseId: null,
            leaseExpiresAt: null,
          },
        });
      }
      return tx.accessEmailOutbox.update({
        where: { id: item.id },
        data: {
          status: 'processing',
          leaseId: randomUUID(),
          leaseExpiresAt: new Date(Date.now() + 90_000),
          attempts: { increment: 1 },
          firstAttemptAt: item.firstAttemptAt ?? new Date(),
        },
      });
    });
  }
}
