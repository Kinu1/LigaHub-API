import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma.service.js';
import { encryptCredential } from '../payments/payment-security.js';
import { EmailGateway, selectedEmailProvider } from './email.gateway.js';
import { readMessage } from './outbox-payload.js';
import type { OutboxQueryDto } from './outbox-query.dto.js';

@Injectable()
export class OutboxAdminService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EmailGateway) private readonly gateway: EmailGateway,
  ) {}

  async list(query: OutboxQueryDto) {
    const where = { status: query.status };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.emailOutbox.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          registrationId: true,
          status: true,
          attempts: true,
          createdAt: true,
          firstAttemptAt: true,
          nextAttemptAt: true,
          leaseExpiresAt: true,
          sentAt: true,
        },
      }),
      this.prisma.emailOutbox.count({ where }),
    ]);
    return {
      items: items.map((item) => ({
        ...item,
        reason:
          item.status === 'failed'
            ? item.firstAttemptAt &&
              Date.now() - item.firstAttemptAt.getTime() >= 23 * 3_600_000
              ? 'idempotency_window_expired'
              : item.attempts >= 8
                ? 'attempt_limit_reached'
                : 'manual_review_required'
            : null,
      })),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async retry(id: string, actorId: string) {
    // Não inicia envio sem configuração de entrega e chave local válida.
    if (
      process.env.EMAIL_DELIVERY_ENABLED !== 'true' ||
      !(selectedEmailProvider() === 'smtp'
        ? process.env.SMTP_HOST
        : process.env.RESEND_API_KEY)
    )
      throw new ServiceUnavailableException('Entrega de e-mails desativada.');
    encryptCredential('outbox-preflight');
    const item = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM email_outbox WHERE id = ${id}::uuid FOR UPDATE`;
      const row = await tx.emailOutbox.findUnique({ where: { id } });
      if (!row) throw new NotFoundException('Item da fila não encontrado.');
      await tx.$queryRaw`SELECT id FROM registrations WHERE id = ${row.registrationId}::uuid FOR UPDATE`;
      const registration = await tx.registration.findUniqueOrThrow({
        where: { id: row.registrationId },
      });
      if (
        row.status !== 'failed' ||
        !row.firstAttemptAt ||
        Date.now() - row.firstAttemptAt.getTime() >= 23 * 3_600_000 ||
        registration.status !== 'confirmed' ||
        registration.suspendedAt ||
        !registration.statusTokenHash ||
        !registration.statusTokenExpiresAt ||
        registration.statusTokenExpiresAt <= new Date() ||
        !row.payloadEncrypted
      )
        throw new ConflictException('O item não permite retomada segura.');
      try {
        readMessage(row.payloadEncrypted);
      } catch {
        throw new ConflictException('O payload não permite retomada segura.');
      }
      const updated = await tx.emailOutbox.update({
        where: { id },
        data: {
          status: 'processing',
          attempts: { increment: 1 },
          leaseId: randomUUID(),
          leaseExpiresAt: new Date(Date.now() + 90_000),
        },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          entityType: 'registration',
          entityId: row.registrationId,
          action: 'registration.email_retry_authorized',
          metadata: { outboxId: id, attempt: updated.attempts },
        },
      });
      return updated;
    });
    let providerId: string;
    try {
      providerId = await this.gateway.send(
        readMessage(item.payloadEncrypted!),
        `confirmation/${item.id}`,
      );
    } catch {
      await this.prisma.emailOutbox.updateMany({
        where: { id, status: 'processing', leaseId: item.leaseId },
        data: { status: 'failed', leaseId: null, leaseExpiresAt: null },
      });
      throw new ServiceUnavailableException(
        'O provedor não confirmou o envio; o item exige análise.',
      );
    }
    await this.prisma.emailOutbox.updateMany({
      where: { id, status: 'processing', leaseId: item.leaseId },
      data: {
        status: 'sent',
        providerId,
        sentAt: new Date(),
        payloadEncrypted: null,
        leaseId: null,
        leaseExpiresAt: null,
      },
    });
    return { id, status: 'sent' };
  }
}
