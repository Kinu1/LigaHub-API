import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma.service.js';
import type { AuthenticatedUser } from '../auth/auth.decorators.js';
import { PaymentAccountsService } from './payment-accounts.service.js';
import { PaymentGateway } from './payment.gateway.js';
import {
  assertProviderPayment,
  decryptCredential,
  digest,
  encryptCredential,
} from './payment-security.js';
import {
  payoutMode,
  platformPixAccountId,
  readPixDestination,
} from './pix-payout.policy.js';
import type { PixPayout } from '../../generated/prisma/client.js';
import { organizerPayoutAmount } from './pix-pricing.js';

export type ManualReceipt = {
  receiptId: string;
  paidAt: string;
  amountInCents: number;
};

@Injectable()
export class ManualPayoutsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PaymentAccountsService)
    private readonly accounts: PaymentAccountsService,
    @Inject(PaymentGateway) private readonly gateway: PaymentGateway,
  ) {}

  private admin(actor: AuthenticatedUser) {
    if (actor.role !== 'admin')
      throw new ForbiddenException(
        'Somente administradores registram repasses manuais.',
      );
    if (payoutMode() !== 'manual')
      throw new ConflictException('Os repasses manuais não estão habilitados.');
  }

  private details(row: PixPayout) {
    const destination = readPixDestination(row.destinationEncrypted);
    return {
      id: row.id,
      amountInCents: row.amountInCents,
      keyType: destination.keyType,
      key: destination.key,
      status: row.status,
      reservedBy: row.manualReservedBy,
      reservedAt: row.manualReservedAt,
      receiptId: row.manualReceiptEncrypted
        ? decryptCredential(row.manualReceiptEncrypted)
        : null,
      paidAt: row.manualPaidAt,
    };
  }

  async receipt(actor: AuthenticatedUser, id: string) {
    const row = await this.prisma.pixPayout.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Repasse não encontrado.');
    if (actor.role !== 'admin' && row.ownerId !== actor.id)
      throw new ForbiddenException('Você não pode consultar este repasse.');
    return this.details(row);
  }

  async prepare(actor: AuthenticatedUser, id: string) {
    this.admin(actor);
    const row = await this.prisma.pixPayout.findUnique({
      where: { id },
      include: { payment: { include: { account: true, registration: true } } },
    });
    if (!row) throw new NotFoundException('Repasse não encontrado.');
    if (row.status === 'manual_reserved') {
      if (row.manualReservedBy !== actor.id)
        throw new ConflictException(
          'Outro administrador já está realizando este repasse.',
        );
      return this.details(row);
    }
    if (
      !['pending', 'held'].includes(row.status) ||
      row.submittedAt ||
      row.providerPayoutId ||
      row.providerTransactionId ||
      row.leaseId
    )
      throw new ConflictException(
        'Este repasse já foi iniciado ou concluído. Confira seu histórico.',
      );
    const destination = readPixDestination(row.destinationEncrypted);
    const attempt = row.payment;
    if (
      row.ownerId !== destination.ownerId ||
      attempt.payoutOwnerId !== row.ownerId ||
      attempt.accountId !== platformPixAccountId() ||
      !attempt.account.active ||
      !attempt.providerPaymentId ||
      attempt.method !== 'pix' ||
      organizerPayoutAmount(attempt) !== row.amountInCents ||
      attempt.account.isTest !==
        ((process.env.MERCADO_PAGO_TEST_MODE ?? 'true') === 'true')
    )
      throw new ConflictException(
        'O repasse não corresponde ao recebimento da plataforma.',
      );
    const token = await this.accounts.accessToken(attempt.accountId);
    const payment = await this.gateway.getPayment(
      token,
      attempt.providerPaymentId,
      attempt.providerApi === 'orders' ? 'orders' : 'payments',
    );
    assertProviderPayment(
      payment,
      attempt.id,
      attempt.account.merchantId,
      attempt.amountInCents,
      'pix',
      1,
    );
    if (
      String(payment.id) !== attempt.providerPaymentId ||
      payment.status !== 'approved' ||
      payment.status_detail !== 'accredited'
    )
      throw new ConflictException(
        'O pagamento ainda não está aprovado e acreditado.',
      );
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM academic_events WHERE id = ${attempt.registration.eventId}::uuid FOR UPDATE`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${row.ownerId}))`;
      const registration = await tx.registration.findUniqueOrThrow({
        where: { id: row.registrationId },
        include: { event: { include: { owner: true } } },
      });
      const current = await tx.paymentAttempt.findUniqueOrThrow({
        where: { id: attempt.id },
      });
      const count = await tx.paymentAttempt.count({
        where: {
          registrationId: row.registrationId,
          status: { in: ['approved', 'in_mediation'] },
        },
      });
      const approvedDestination = await tx.organizerPixDestination.findUnique({
        where: { ownerId: row.ownerId },
      });
      if (
        current.status !== 'approved' ||
        current.updatedAt.getTime() !== attempt.updatedAt.getTime() ||
        count !== 1 ||
        registration.status !== 'confirmed' ||
        registration.cancellationRequestedAt ||
        registration.suspendedAt ||
        registration.event.ownerId !== row.ownerId ||
        !registration.event.owner?.active ||
        !approvedDestination?.approvedAt ||
        approvedDestination.fingerprint !== destination.fingerprint
      )
        throw new ConflictException(
          'Inscrição, pagamento ou chave Pix precisam de revisão antes do repasse.',
        );
      const changed = await tx.pixPayout.updateMany({
        where: {
          id,
          status: { in: ['pending', 'held'] },
          submittedAt: null,
          leaseId: null,
        },
        data: {
          status: 'manual_reserved',
          manualReservedBy: actor.id,
          manualReservedAt: new Date(),
          reason: null,
        },
      });
      if (changed.count !== 1)
        throw new ConflictException(
          'Este repasse já foi reservado. Atualize o histórico.',
        );
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          entityType: 'pix_payout',
          entityId: id,
          action: 'pix_payout.manual_reserved',
        },
      });
      return this.details(
        await tx.pixPayout.findUniqueOrThrow({ where: { id } }),
      );
    });
  }

  async confirm(actor: AuthenticatedUser, id: string, input: ManualReceipt) {
    this.admin(actor);
    const receiptId =
      typeof input.receiptId === 'string'
        ? input.receiptId.trim().toUpperCase()
        : '';
    const paidAt = new Date(input.paidAt);
    if (
      !/^[A-Z0-9][A-Z0-9._/-]{5,119}$/.test(receiptId) ||
      !Number.isFinite(paidAt.getTime()) ||
      paidAt.getTime() > Date.now() ||
      !Number.isSafeInteger(input.amountInCents)
    )
      throw new BadRequestException(
        'Informe valor, data e identificador da transação do comprovante válidos.',
      );
    const hash = digest(receiptId);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM pix_payouts WHERE id = ${id}::uuid FOR UPDATE`;
      const row = await tx.pixPayout.findUnique({ where: { id } });
      if (!row) throw new NotFoundException('Repasse não encontrado.');
      if (row.manualReservedBy !== actor.id)
        throw new ForbiddenException(
          'O registro deve ser concluído pelo administrador que reservou o repasse.',
        );
      if (row.amountInCents !== input.amountInCents)
        throw new ConflictException(
          'O valor deve corresponder ao valor integral da inscrição.',
        );
      if (
        row.status === 'manual_paid' &&
        row.manualReceiptHash === hash &&
        row.manualPaidAt?.getTime() === paidAt.getTime()
      )
        return this.details(row);
      if (
        row.status !== 'manual_reserved' ||
        row.submittedAt ||
        row.providerPayoutId ||
        !row.manualReservedAt ||
        paidAt.getTime() < row.manualReservedAt.getTime() - 60_000
      )
        throw new ConflictException(
          'Este repasse não está disponível para registrar o comprovante.',
        );
      const duplicate = await tx.pixPayout.findUnique({
        where: { manualReceiptHash: hash },
      });
      if (duplicate)
        throw new ConflictException(
          'Este comprovante já foi utilizado em outro repasse.',
        );
      const updated = await tx.pixPayout.update({
        where: { id },
        data: {
          status: 'manual_paid',
          manualReceiptHash: hash,
          manualReceiptEncrypted: encryptCredential(receiptId),
          manualPaidAt: paidAt,
          reason: null,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          entityType: 'pix_payout',
          entityId: id,
          action: 'pix_payout.manual_recorded',
          metadata: {
            amountInCents: row.amountInCents,
            paidAt: paidAt.toISOString(),
          },
        },
      });
      return this.details(updated);
    });
  }
}
