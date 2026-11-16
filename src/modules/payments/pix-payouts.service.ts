import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma.service.js';
import type { AuthenticatedUser } from '../auth/auth.decorators.js';
import type { PixPayout, Prisma } from '../../generated/prisma/client.js';
import { PaymentAccountsService } from './payment-accounts.service.js';
import { PaymentGateway } from './payment.gateway.js';
import { assertProviderPayment } from './payment-security.js';
import {
  PixPayoutGateway,
  payoutsTestMode,
  type PayoutTransaction,
} from './pix-payout.gateway.js';
import {
  platformPixAccountId,
  payoutMode,
  readPixDestination,
} from './pix-payout.policy.js';
import type { ReconcileResult } from './payments.service.js';

@Injectable()
export class PixPayoutsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PaymentAccountsService)
    private readonly accounts: PaymentAccountsService,
    @Inject(PaymentGateway) private readonly payments: PaymentGateway,
    @Inject(PixPayoutGateway) private readonly gateway: PixPayoutGateway,
  ) {}

  async history(actor: AuthenticatedUser, page = 1) {
    const where = actor.role === 'admin' ? {} : { ownerId: actor.id };
    const select = {
      id: true,
      paymentId: true,
      registrationId: true,
      ownerId: true,
      amountInCents: true,
      status: true,
      reason: true,
      createdAt: true,
      updatedAt: true,
      manualReservedBy: true,
      manualReservedAt: true,
      manualPaidAt: true,
      payment: {
        select: {
          registration: {
            select: { name: true, event: { select: { title: true } } },
          },
        },
      },
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.pixPayout.findMany({
        where,
        select,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * 50,
        take: 50,
      }),
      this.prisma.pixPayout.count({ where }),
    ]);
    return { items, total, page, limit: 50 };
  }

  async process(deadline = Date.now() + 60_000): Promise<ReconcileResult> {
    const result: ReconcileResult = {
      status: 'completed',
      processed: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
    };
    if (
      payoutMode() !== 'automatic' ||
      process.env.MERCADO_PAGO_PAYOUTS_ENABLED !== 'true'
    )
      return result;
    this.gateway.preflight();
    const rows = await this.prisma.pixPayout.findMany({
      where: {
        status: { in: ['pending', 'held', 'processing'] },
        nextAttemptAt: { lte: new Date() },
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: new Date() } }],
      },
      orderBy: [{ nextAttemptAt: 'asc' }, { id: 'asc' }],
      take: 25,
    });
    for (const row of rows) {
      // Até 20s para renovar OAuth e duas consultas de até 12s, mais margem de persistência.
      if (Date.now() + 50_000 > deadline) {
        result.skipped++;
        continue;
      }
      const leaseId = randomUUID();
      const claimed = await this.prisma.pixPayout.updateMany({
        where: {
          id: row.id,
          status: { in: ['pending', 'held', 'processing'] },
          OR: [
            { leaseExpiresAt: null },
            { leaseExpiresAt: { lte: new Date() } },
          ],
        },
        data: { leaseId, leaseExpiresAt: new Date(Date.now() + 120_000) },
      });
      if (claimed.count !== 1) {
        result.skipped++;
        continue;
      }
      result.processed++;
      try {
        await this.processOne(row, leaseId);
        result.succeeded++;
      } catch {
        result.failed++;
        // Um envio iniciado sem resposta persistida NÃO pode ser reenviado.
        const current = await this.prisma.pixPayout.findUniqueOrThrow({
          where: { id: row.id },
        });
        await this.finish(
          row.id,
          leaseId,
          current.submittedAt && !current.providerPayoutId
            ? {
                status: 'unknown',
                reason: 'submission_uncertain_manual_review',
              }
            : { reason: 'provider_or_configuration_unavailable' },
        );
      } finally {
        await this.prisma.pixPayout.updateMany({
          where: { id: row.id, leaseId },
          data: {
            leaseId: null,
            leaseExpiresAt: null,
            nextAttemptAt: new Date(Date.now() + 60_000),
          },
        });
      }
    }
    if (result.failed) {
      result.status = result.succeeded ? 'partial' : 'failed';
      result.errorCode = 'PAYOUT_SYNC_FAILED';
    }
    return result;
  }

  private async finish(
    id: string,
    leaseId: string,
    data: Prisma.PixPayoutUpdateManyMutationInput,
  ) {
    await this.prisma.pixPayout.updateMany({ where: { id, leaseId }, data });
  }

  private async processOne(row: PixPayout, leaseId: string): Promise<void> {
    // Recarrega após adquirir a posse; outro worker pode ter salvo o resultado.
    row = await this.prisma.pixPayout.findUniqueOrThrow({
      where: { id: row.id },
    });
    const attempt = await this.prisma.paymentAttempt.findUniqueOrThrow({
      where: { id: row.paymentId },
      include: { account: true, registration: { select: { eventId: true } } },
    });
    // Nunca trocar a origem de uma transferência já enviada, mesmo após mudar a configuração.
    const token = await this.accounts.accessToken(attempt.accountId);
    if (row.submittedAt) {
      if (!row.providerPayoutId || !row.providerTransactionId) {
        await this.finish(row.id, leaseId, {
          status: 'unknown',
          reason: 'submission_uncertain_manual_review',
        });
        return;
      }
      const transaction = await this.gateway.transaction(
        token,
        row.providerPayoutId,
        row.providerTransactionId,
      );
      await this.applyTransaction(row, leaseId, transaction);
      return;
    }

    const destination = readPixDestination(row.destinationEncrypted);
    if (
      destination.ownerId !== row.ownerId ||
      row.amountInCents !== attempt.amountInCents ||
      row.amountInCents < 100 ||
      attempt.method !== 'pix' ||
      attempt.payoutOwnerId !== row.ownerId ||
      attempt.accountId !== platformPixAccountId() ||
      !attempt.account.active ||
      attempt.account.isTest !== payoutsTestMode()
    ) {
      await this.finish(row.id, leaseId, {
        status: 'held',
        reason: 'invalid_routing_or_destination',
      });
      return;
    }
    if (!attempt.providerPaymentId) {
      await this.finish(row.id, leaseId, {
        status: 'held',
        reason: 'payment_not_verified',
      });
      return;
    }
    // O webhook dispara a fila; a transferência depende de nova consulta autenticada ao provedor.
    const payment = await this.payments.getPayment(
      token,
      attempt.providerPaymentId,
      attempt.providerApi === 'orders' ? 'orders' : 'payments',
    );
    assertProviderPayment(
      payment,
      attempt.id,
      attempt.account.merchantId,
      row.amountInCents,
      'pix',
      1,
    );
    if (
      String(payment.id) !== attempt.providerPaymentId ||
      payment.status !== 'approved' ||
      payment.status_detail !== 'accredited'
    ) {
      await this.finish(row.id, leaseId, {
        status: 'held',
        reason: 'payment_not_accredited',
      });
      return;
    }
    // Valida corpo e assinatura ANTES de marcar o envio irreversível.
    this.gateway.preflight();
    this.gateway.body(row.id, row.amountInCents, destination);
    const ready = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM academic_events WHERE id = ${attempt.registration.eventId}::uuid FOR UPDATE`;
      // Mesma trava usada no cadastro/aprovação: não permite alterar o destino durante a decisão de envio.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${row.ownerId}))`;
      const registration = await tx.registration.findUniqueOrThrow({
        where: { id: row.registrationId },
        include: { event: { include: { owner: true } } },
      });
      const latest = await tx.paymentAttempt.findUniqueOrThrow({
        where: { id: row.paymentId },
      });
      const approved = await tx.paymentAttempt.count({
        where: {
          registrationId: row.registrationId,
          status: { in: ['approved', 'in_mediation'] },
        },
      });
      const currentDestination = await tx.organizerPixDestination.findUnique({
        where: { ownerId: row.ownerId },
      });
      if (
        latest.status !== 'approved' ||
        latest.updatedAt.getTime() !== attempt.updatedAt.getTime() ||
        approved !== 1 ||
        registration.status !== 'confirmed' ||
        registration.suspendedAt ||
        registration.cancellationRequestedAt ||
        registration.event.ownerId !== row.ownerId ||
        !registration.event.owner?.active ||
        !currentDestination?.approvedAt ||
        currentDestination.fingerprint !== destination.fingerprint
      )
        return false;
      const changed = await tx.pixPayout.updateMany({
        where: { id: row.id, leaseId, submittedAt: null },
        data: { submittedAt: new Date(), status: 'processing', reason: null },
      });
      if (changed.count !== 1) return false;
      await tx.auditLog.create({
        data: {
          entityType: 'pix_payout',
          entityId: row.id,
          action: 'pix_payout.submission_started',
          metadata: {
            paymentId: row.paymentId,
            amountInCents: row.amountInCents,
          },
        },
      });
      return true;
    });
    if (!ready) {
      await this.finish(row.id, leaseId, {
        status: 'held',
        reason: 'registration_payment_or_destination_changed',
      });
      return;
    }
    const created = await this.gateway.create(
      token,
      row.id,
      row.amountInCents,
      destination,
    );
    const transaction = created?.transactions?.[0];
    if (
      !/^POP[A-Z0-9]+$/.test(created?.id ?? '') ||
      created.transactions.length !== 1 ||
      !/^TOP[A-Z0-9]+$/.test(transaction?.id ?? '')
    )
      throw new Error('Invalid provider identifiers');
    await this.finish(row.id, leaseId, {
      providerPayoutId: created.id,
      providerTransactionId: transaction.id,
      status: 'processing',
      reason: null,
    });
    // HTTP 202 e status "approved" não comprovam crédito: a consulta posterior decide.
  }

  private async applyTransaction(
    row: PixPayout,
    leaseId: string,
    transaction: PayoutTransaction,
  ) {
    if (
      transaction.id !== row.providerTransactionId ||
      transaction.external_reference !== row.id ||
      transaction.amount?.currency !== 'BRL' ||
      !Number.isFinite(transaction.amount.value) ||
      Math.abs(transaction.amount.value * 100 - row.amountInCents) > 0.00001
    )
      throw new Error('Invalid provider transaction');
    const paid =
      transaction.status === 'success' &&
      transaction.status_detail === 'accredited';
    const failed = ['error', 'rejected', 'refunded', 'canceled'].includes(
      transaction.status,
    );
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.pixPayout.updateMany({
        where: { id: row.id, leaseId },
        data: {
          status: paid ? 'paid' : failed ? 'failed' : 'processing',
          reason: paid
            ? null
            : failed
              ? 'provider_transfer_failed_manual_review'
              : 'awaiting_bank_confirmation',
        },
      });
      if (changed.count === 1 && (paid || failed))
        await tx.auditLog.create({
          data: {
            entityType: 'pix_payout',
            entityId: row.id,
            action: paid ? 'pix_payout.paid' : 'pix_payout.failed',
          },
        });
    });
  }
}
