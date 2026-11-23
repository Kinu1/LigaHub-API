import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma.service.js';
import {
  CommunicationsGateway,
  DeliveryError,
  type CommunicationsMessage,
} from './communications.gateway.js';
import { AttachmentsService } from './attachments.service.js';
import { decryptCredential } from '../payments/payment-security.js';
import {
  eligible,
  terminalRecipientStates,
  type Db,
} from './communications.policy.js';
import { withFiles } from './communications.message.js';
import { randomUUID } from 'node:crypto';

@Injectable()
export class CommunicationsProcessor {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CommunicationsGateway)
    private readonly gateway: CommunicationsGateway,
    @Inject(AttachmentsService)
    private readonly attachments: AttachmentsService,
  ) {}
  async processBatch(deadline = Date.now() + 60000) {
    const result = {
      status: 'completed' as 'completed' | 'partial' | 'failed',
      processed: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      errorCode: null as string | null,
    };
    if (Date.now() + 15000 >= deadline) return result;
    await this.reconcileWebhooks(deadline);
    await this.expire(new Date(), deadline);
    if (!this.gateway.configured()) {
      if (Date.now() + 10000 < deadline)
        await this.attachments.cleanup(new Date(), deadline);
      return result;
    }
    for (let i = 0; i < 10 && Date.now() + 15000 < deadline; i++) {
      const item = await this.claim();
      if (!item) break;
      result.processed++;
      if (item.status !== 'processing') {
        if (item.status === 'failed') result.failed++;
        else if (item.status === 'skipped') result.skipped++;
        await this.refreshCampaign(item.campaignId);
        continue;
      }
      const lease = item.leaseId!;
      let submissionStarted = false;
      try {
        // Last eligibility read immediately before transport. Accepted rows never enter claim.
        const registration = await this.prisma.registration.findUnique({
          where: { id: item.registrationId },
        });
        const c = await this.prisma.communicationCampaign.findUniqueOrThrow({
          where: { id: item.campaignId },
        });
        if (!registration || !eligible(registration, c)) {
          await this.fenced(item.id, lease, {
            status: 'skipped',
            errorCode: 'INELIGIBLE',
          });
          result.skipped++;
          await this.refreshCampaign(item.campaignId);
          continue;
        }
        if (Date.now() + 13000 >= deadline) {
          // No transport attempt occurred: release without consuming retry budget/window.
          await this.fenced(item.id, lease, {
            status: 'queued',
            attempts: { decrement: 1 },
            firstAttemptAt: item.attempts === 1 ? null : item.firstAttemptAt,
          });
          break;
        }
        if (!c.envelopeEncrypted)
          throw new DeliveryError(false, 'INVALID_SNAPSHOT');
        const files = await this.prisma.communicationAttachment.findMany({
          where: { campaignId: c.id },
        });
        const envelope = JSON.parse(
          decryptCredential(c.envelopeEncrypted),
        ) as CommunicationsMessage;
        const message = withFiles({ ...envelope, to: [item.email] }, files);
        submissionStarted = true;
        const providerId = await this.gateway.send(
          message,
          `comms/${c.id}/${item.id}`,
        );
        const accepted = await this.prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM communication_recipients WHERE id=${item.id}::uuid FOR UPDATE`;
          const saved = await tx.communicationRecipient.updateMany({
            where: { id: item.id, leaseId: lease, status: 'processing' },
            data: {
              status: 'accepted',
              providerId,
              acceptedAt: new Date(),
              leaseId: null,
              leaseExpiresAt: null,
              errorCode: null,
            },
          });
          if (saved.count)
            await this.reconcileRecipient(tx, item.id, providerId);
          return saved.count === 1;
        });
        if (accepted) result.succeeded++;
        else result.failed++;
      } catch (e) {
        const temporary =
          e instanceof DeliveryError ? e.temporary : submissionStarted;
        const final =
          !temporary ||
          item.attempts >= 5 ||
          !!(
            item.firstAttemptAt &&
            Date.now() - item.firstAttemptAt.getTime() >= 23 * 3600000
          );
        await this.fenced(item.id, lease, {
          status: final ? 'failed' : 'queued',
          errorCode: e instanceof DeliveryError ? e.code : 'INVALID_MESSAGE',
          nextAttemptAt: new Date(
            Date.now() + 60000 * 2 ** (item.attempts - 1),
          ),
        });
        result.failed++;
      }
      await this.refreshCampaign(item.campaignId);
    }
    if (Date.now() + 10000 < deadline)
      await this.attachments.cleanup(new Date(), deadline);
    if (result.failed) {
      result.status = result.succeeded ? 'partial' : 'failed';
      result.errorCode = 'COMMUNICATIONS_FAILURE';
    }
    return result;
  }
  private async fenced(
    id: string,
    leaseId: string,
    data: Prisma.CommunicationRecipientUpdateManyMutationInput,
  ) {
    return this.prisma.communicationRecipient.updateMany({
      where: { id, leaseId, status: 'processing' },
      data: { ...data, leaseId: null, leaseExpiresAt: null },
    });
  }
  async claim() {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM communication_recipients WHERE (status IN ('pending','queued') AND "nextAttemptAt"<=NOW()) OR (status='processing' AND "leaseExpiresAt"<=NOW()) ORDER BY "createdAt",id FOR UPDATE SKIP LOCKED LIMIT 1`;
      if (!rows.length) return null;
      const r = await tx.communicationRecipient.findUniqueOrThrow({
        where: { id: rows[0].id },
        include: { campaign: true, registration: true },
      });
      let status: 'failed' | 'skipped' | undefined;
      let code: string | undefined;
      if (r.providerId) {
        // Defensive: never repeat a previously accepted submission.
        return tx.communicationRecipient.update({
          where: { id: r.id },
          data: {
            status: 'accepted',
            acceptedAt: r.acceptedAt ?? new Date(),
            leaseId: null,
            leaseExpiresAt: null,
          },
        });
      }
      if (!eligible(r.registration, r.campaign)) {
        status = 'skipped';
        code = 'INELIGIBLE';
      } else if (
        r.attempts >= 5 ||
        (r.firstAttemptAt &&
          Date.now() - r.firstAttemptAt.getTime() >= 23 * 3600000)
      ) {
        status = 'failed';
        code = 'RETRY_WINDOW_EXPIRED';
      }
      if (status)
        return tx.communicationRecipient.update({
          where: { id: r.id },
          data: {
            status,
            errorCode: code,
            leaseId: null,
            leaseExpiresAt: null,
          },
        });
      return tx.communicationRecipient.update({
        where: { id: r.id },
        data: {
          status: 'processing',
          attempts: { increment: 1 },
          leaseId: randomUUID(),
          leaseExpiresAt: new Date(Date.now() + 90000),
          firstAttemptAt: r.firstAttemptAt ?? new Date(),
          lastAttemptAt: new Date(),
        },
      });
    });
  }
  async reconcileRecipient(tx: Db, id: string, providerId: string) {
    // Caller holds recipient row lock; acceptance and webhook updates serialize here.
    const events = await tx.communicationWebhookEvent.findMany({
      where: { providerId, processedAt: null },
      orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
    });
    let r = await tx.communicationRecipient.findUniqueOrThrow({
      where: { id },
    });
    for (const e of events) {
      const data: Prisma.CommunicationRecipientUpdateInput = {};
      if (e.eventType === 'email.delivered') {
        data.status = 'delivered';
        data.deliveredAt = r.deliveredAt ?? e.receivedAt;
      } else if (
        [
          'email.bounced',
          'email.complained',
          'email.failed',
          'email.suppressed',
        ].includes(e.eventType)
      ) {
        if (r.status !== 'delivered') data.status = 'failed';
        data.errorCode = e.eventType.slice(6).toUpperCase();
      } else if (
        e.eventType === 'email.delivery_delayed' &&
        !['delivered', 'failed', 'unconfirmed_after24h'].includes(r.status)
      )
        data.status = 'delayed';
      else if (
        e.eventType === 'email.sent' &&
        ['queued', 'pending', 'processing'].includes(r.status)
      )
        data.status = 'accepted';
      if (Object.keys(data).length)
        r = await tx.communicationRecipient.update({
          where: { id },
          data: { ...data, leaseId: null, leaseExpiresAt: null },
        });
      await tx.communicationWebhookEvent.updateMany({
        where: { id: e.id, processedAt: null },
        data: {
          processedAt: new Date(),
          matchedRecipientId: id,
          reconciliationStatus: 'matched',
        },
      });
    }
    return r.campaignId;
  }
  async reconcileWebhooks(deadline = Date.now() + 60000) {
    const events = await this.prisma.$queryRaw<
      { providerId: string }[]
    >`SELECT DISTINCT e."providerId" FROM communication_webhook_events e JOIN communication_recipients r ON r."providerId"=e."providerId" WHERE e."processedAt" IS NULL LIMIT 100`;
    for (const { providerId } of events) {
      if (Date.now() + 2000 >= deadline) break;
      const r = await this.prisma.communicationRecipient.findFirst({
        where: { providerId },
      });
      if (!r) continue;
      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM communication_recipients WHERE id=${r.id}::uuid FOR UPDATE`;
        await this.reconcileRecipient(tx, r.id, providerId);
      });
      await this.refreshCampaign(r.campaignId);
    }
  }
  async expire(now = new Date(), deadline = Infinity) {
    await this.prisma.communicationRecipient.updateMany({
      where: {
        status: { in: ['accepted', 'delayed'] },
        OR: [
          { acceptedAt: { lte: new Date(now.getTime() - 24 * 3600000) } },
          {
            acceptedAt: null,
            firstAttemptAt: { lte: new Date(now.getTime() - 24 * 3600000) },
          },
        ],
      },
      data: {
        status: 'unconfirmed_after24h',
        errorCode: 'NO_DELIVERY_CONFIRMATION',
      },
    });
    const campaigns = await this.prisma.communicationCampaign.findMany({
      where: { status: 'sending' },
      select: { id: true },
      take: 100,
    });
    for (const c of campaigns) {
      if (Date.now() + 2000 >= deadline) break;
      await this.refreshCampaign(c.id);
    }
  }
  async refreshCampaign(id: string) {
    const c = await this.prisma.communicationCampaign.findUnique({
      where: { id },
    });
    if (!c || c.status === 'draft') return;
    const groups = await this.prisma.communicationRecipient.groupBy({
      where: { campaignId: id },
      by: ['status'],
      _count: true,
    });
    const total = groups.reduce((n, g) => n + g._count, 0);
    if (
      total !== c.snapshotCount ||
      !total ||
      groups.some(
        (g) =>
          !terminalRecipientStates.includes(
            g.status as (typeof terminalRecipientStates)[number],
          ),
      )
    )
      return;
    const all = groups.length === 1 && groups[0].status === 'delivered';
    const status = all ? 'sent' : 'failed';
    if (c.status !== status || !c.completedAt)
      await this.prisma.communicationCampaign.update({
        where: { id },
        data: { status, completedAt: c.completedAt ?? new Date() },
      });
  }
}
