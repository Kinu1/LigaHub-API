import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma.service.js';
import type {
  CommunicationCampaign,
  Prisma,
} from '../../generated/prisma/client.js';
import { encryptCredential } from '../payments/payment-security.js';
import { sanitizeHtml } from './html-sanitizer.js';
import {
  audienceWhere,
  campaignAccess,
  eventAccess,
  validateCategories,
  type Role,
} from './communications.policy.js';
import { CommunicationsGateway } from './communications.gateway.js';
import { content, render, withFiles } from './communications.message.js';
import type {
  CreateCampaignDto,
  UpdateCampaignDto,
  ListCampaignsQuery,
  ListRecipientsQuery,
} from './dto/index.js';

@Injectable()
export class CommunicationsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CommunicationsGateway)
    private readonly gateway: CommunicationsGateway,
  ) {}
  private response(c: CommunicationCampaign) {
    const { contentEncrypted: _c, envelopeEncrypted: _e, ...safe } = c;
    return { ...safe, ...content(c) };
  }
  private fields(
    dto: CreateCampaignDto | UpdateCampaignDto,
    c?: CommunicationCampaign,
  ) {
    const htmlContent = sanitizeHtml(
      dto.htmlContent ?? (c ? content(c).htmlContent : ''),
    );
    if (!htmlContent.trim()) throw new BadRequestException('Conteúdo vazio.');
    const textContent = dto.textContent ?? (c ? content(c).textContent : '');
    const subject = dto.subject ?? c?.subject ?? '';
    if (!subject.trim() || /[\r\n]/.test(subject))
      throw new BadRequestException('Assunto inválido.');
    return {
      subject,
      htmlContent: '',
      textContent: '',
      contentEncrypted: encryptCredential(
        JSON.stringify({ htmlContent, textContent }),
      ),
      audienceType: dto.audienceType ?? c?.audienceType ?? 'all_active',
      audienceCategoryIds:
        dto.audienceCategoryIds ?? c?.audienceCategoryIds ?? [],
      confirmedOnly: dto.confirmedOnly ?? c?.confirmedOnly ?? false,
    };
  }
  async createCampaign(
    eventId: string,
    userId: string,
    role: Role,
    dto: CreateCampaignDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const event = await eventAccess(tx, eventId, userId, role);
      const data = this.fields(dto);
      validateCategories(event, data.audienceType, data.audienceCategoryIds);
      return this.response(
        await tx.communicationCampaign.create({
          data: {
            ...data,
            eventId,
            ownerId: userId,
            idempotencyKey: randomUUID(),
          },
        }),
      );
    });
  }
  async updateCampaign(
    eventId: string,
    id: string,
    userId: string,
    role: Role,
    dto: UpdateCampaignDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const c = await campaignAccess(tx, eventId, id, userId, role, true, true);
      const data = this.fields(dto, c);
      const event = await eventAccess(tx, eventId, userId, role);
      validateCategories(event, data.audienceType, data.audienceCategoryIds);
      return this.response(
        await tx.communicationCampaign.update({ where: { id }, data }),
      );
    });
  }
  async getCampaign(eventId: string, id: string, userId: string, role: Role) {
    const c = await campaignAccess(this.prisma, eventId, id, userId, role);
    const [attachments, event, owner, groups] = await Promise.all([
      this.prisma.communicationAttachment.findMany({
        where: { campaignId: id },
        select: {
          id: true,
          campaignId: true,
          filename: true,
          mimeType: true,
          sizeBytes: true,
          checksum: true,
          status: true,
          expiresAt: true,
          uploadedAt: true,
          totalChunks: true,
        },
      }),
      this.prisma.academicEvent.findUnique({
        where: { id: eventId },
        select: {
          title: true,
          location: true,
          startsAt: true,
          logoImage: true,
        },
      }),
      this.prisma.user.findUnique({
        where: { id: c.ownerId },
        select: { email: true, name: true },
      }),
      this.prisma.communicationRecipient.groupBy({
        by: ['status'],
        where: { campaignId: id },
        _count: true,
      }),
    ]);
    const counts = Object.fromEntries(groups.map((g) => [g.status, g._count]));
    return {
      ...this.response(c),
      event,
      owner,
      attachments: attachments.map((a) => ({
        ...a,
        sizeBytes: Number(a.sizeBytes),
      })),
      recipientCount: c.snapshotCount,
      counts,
      allDelivered: c.snapshotCount > 0 && counts.delivered === c.snapshotCount,
    };
  }
  async listCampaigns(
    eventId: string,
    userId: string,
    role: Role,
    q: ListCampaignsQuery,
  ) {
    await eventAccess(this.prisma, eventId, userId, role);
    const where: Prisma.CommunicationCampaignWhereInput = {
      eventId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.search
        ? { subject: { contains: q.search, mode: 'insensitive' } }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.communicationCampaign.findMany({
        where,
        take: q.limit ?? 20,
        skip: q.offset ?? 0,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          subject: true,
          status: true,
          audienceType: true,
          confirmedOnly: true,
          snapshotCount: true,
          createdAt: true,
          sentAt: true,
          _count: { select: { attachments: true } },
        },
      }),
      this.prisma.communicationCampaign.count({ where }),
    ]);
    return {
      data: items.map(({ _count, snapshotCount, ...c }) => ({
        ...c,
        recipientCount: snapshotCount,
        attachmentCount: _count.attachments,
      })),
      total,
      limit: q.limit ?? 20,
      offset: q.offset ?? 0,
    };
  }
  async previewAudience(
    eventId: string,
    id: string,
    userId: string,
    role: Role,
  ) {
    const c = await campaignAccess(this.prisma, eventId, id, userId, role);
    const where = audienceWhere(c);
    const [total, groups, sample] = await Promise.all([
      this.prisma.registration.count({ where }),
      this.prisma.registration.groupBy({
        where,
        by: ['registrationTypeId'],
        _count: true,
      }),
      this.prisma.registration.findMany({
        where,
        take: 10,
        orderBy: { id: 'asc' },
        select: {
          id: true,
          email: true,
          name: true,
          status: true,
          registrationTypeId: true,
        },
      }),
    ]);
    return {
      total,
      byCategory: [
        ...groups.reduce((totals, g) => {
          const categoryId = g.registrationTypeId ?? 'geral';
          totals.set(categoryId, (totals.get(categoryId) ?? 0) + g._count);
          return totals;
        }, new Map<string, number>()),
      ].map(([categoryId, count]) => ({ categoryId, count })),
      sample: sample.map(({ id, registrationTypeId, ...r }) => ({
        ...r,
        registrationId: id,
        categoryId: registrationTypeId ?? 'geral',
      })),
    };
  }
  async sendTestEmail(
    eventId: string,
    id: string,
    userId: string,
    role: Role,
    email?: string,
  ) {
    if (!this.gateway.configured())
      throw new ServiceUnavailableException('Resend indisponível.');
    const message = await this.prisma.$transaction(async (tx) => {
      const c = await campaignAccess(tx, eventId, id, userId, role, true, true);
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (email && email.toLowerCase() !== user.email.toLowerCase())
        throw new ForbiddenException('Teste apenas para seu email.');
      const event = await tx.academicEvent.findUniqueOrThrow({
        where: { id: eventId },
      });
      const files = await tx.communicationAttachment.findMany({
        where: { campaignId: id },
      });
      if (files.some((f) => f.status !== 'ready'))
        throw new ConflictException('Finalize todos anexos.');
      return withFiles(
        {
          ...render(c, event, user),
          to: [user.email],
          subject: `[TESTE] ${c.subject}`,
        },
        files,
      );
    });
    const providerId = await this.gateway.send(
      message,
      `comms-test/${id}/${randomUUID()}`,
    );
    return { providerId, message: 'E-mail de teste enviado.' };
  }
  async finalizeSend(
    eventId: string,
    id: string,
    userId: string,
    role: Role,
    key: string,
  ) {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const c = await campaignAccess(tx, eventId, id, userId, role, true);
          if (c.status !== 'draft') {
            if (c.idempotencyKey !== key)
              throw new ConflictException('Campanha enviada com outra chave.');
            return {
              campaignId: id,
              recipientCount: c.snapshotCount,
              status: 'queued',
              alreadySent: true,
            };
          }
          const other = await tx.communicationCampaign.findUnique({
            where: { eventId_idempotencyKey: { eventId, idempotencyKey: key } },
          });
          if (other && other.id !== id)
            throw new ConflictException('Chave pertence a outra campanha.');
          if (!this.gateway.configured())
            throw new ServiceUnavailableException('Resend indisponível.');
          const event = await tx.academicEvent.findUniqueOrThrow({
            where: { id: eventId },
          });
          validateCategories(event, c.audienceType, c.audienceCategoryIds);
          const files = await tx.communicationAttachment.findMany({
            where: { campaignId: id },
          });
          if (files.some((f) => f.status !== 'ready' || !f.encryptedPayload))
            throw new ConflictException('Finalize todos anexos.');
          const rows = await tx.registration.findMany({
            where: audienceWhere(c),
            select: { id: true, email: true, name: true },
          });
          if (!rows.length)
            throw new BadRequestException('Nenhum destinatário elegível.');
          const user = await tx.user.findUniqueOrThrow({
            where: { id: userId },
          });
          const envelope = render(c, event, user);
          // Resolve the packaged logo before accepting a campaign, without persisting copies.
          withFiles(envelope, files);
          await tx.communicationCampaign.update({
            where: { id },
            data: {
              status: 'sending',
              idempotencyKey: key,
              sentAt: new Date(),
              snapshotCount: rows.length,
              envelopeEncrypted: encryptCredential(JSON.stringify(envelope)),
            },
          });
          await tx.communicationRecipient.createMany({
            data: rows.map((r) => ({
              campaignId: id,
              registrationId: r.id,
              email: r.email,
              name: r.name,
              status: 'queued',
            })),
          });
          return {
            campaignId: id,
            recipientCount: rows.length,
            status: 'queued',
          };
        },
        { timeout: 30000 },
      );
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002')
        throw new ConflictException('Chave de envio já utilizada.');
      throw e;
    }
  }
  async listRecipients(
    eventId: string,
    id: string,
    userId: string,
    role: Role,
    q: ListRecipientsQuery,
  ) {
    await campaignAccess(this.prisma, eventId, id, userId, role);
    const where: Prisma.CommunicationRecipientWhereInput = {
      campaignId: id,
      ...(q.status ? { status: q.status } : {}),
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: 'insensitive' } },
              { email: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.communicationRecipient.findMany({
        where,
        take: q.limit ?? 50,
        skip: q.offset ?? 0,
        orderBy: { id: 'asc' },
        include: {
          webhookEvents: {
            where: { eventType: { in: ['email.bounced', 'email.complained'] } },
            select: { id: true, eventType: true, receivedAt: true },
            orderBy: { receivedAt: 'desc' },
            take: 20,
          },
        },
      }),
      this.prisma.communicationRecipient.count({ where }),
    ]);
    return {
      data: items.map(({ leaseId: _l, leaseExpiresAt: _e, ...r }) => r),
      total,
      limit: q.limit ?? 50,
      offset: q.offset ?? 0,
    };
  }
}
