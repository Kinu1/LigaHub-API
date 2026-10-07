import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException, UnauthorizedException, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../prisma.service.js';
import { Prisma, type PaymentAttempt } from '../../generated/prisma/client.js';
import type { AuthenticatedUser } from '../auth/auth.decorators.js';
import { PaymentAccountsService } from './payment-accounts.service.js';
import type { CreatePaymentDto } from './payment.dto.js';
import { PaymentGateway, PaymentRejectedByProvider } from './payment.gateway.js';
import { assertProviderPayment, digest, verifyWebhook, type ProviderPayment } from './payment-security.js';

const unresolved = ['created', 'pending', 'in_process', 'authorized', 'in_mediation'];
const providerStatuses = ['pending', 'approved', 'authorized', 'in_process', 'in_mediation', 'rejected', 'cancelled', 'refunded', 'charged_back'];

@Injectable()
export class PaymentsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaymentsService.name);
  private timer?: ReturnType<typeof setInterval>;
  private syncing = false;
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(PaymentGateway) private readonly gateway: PaymentGateway, @Inject(PaymentAccountsService) private readonly accounts: PaymentAccountsService) {}

  onModuleInit(): void {
    if (process.env.PAYMENT_RECONCILIATION_ENABLED === 'false') return;
    this.timer = setInterval(() => { void this.reconcile(); }, 60_000);
    this.timer.unref();
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }

  private async participant(registrationId: string, token?: string) {
    if (!token || token.length > 256) throw new UnauthorizedException('Informe o token de acesso à inscrição.');
    const registration = await this.prisma.registration.findUnique({ where: { id: registrationId }, include: { event: { include: { owner: true } } } });
    const actual = Buffer.from(digest(token), 'hex');
    const expected = Buffer.from(registration?.manageTokenHash ?? '0'.repeat(64), 'hex');
    if (!registration || actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new UnauthorizedException('O acesso à inscrição é inválido.');
    return registration;
  }

  async checkoutConfig(registrationId: string, token?: string) {
    const registration = await this.participant(registrationId, token);
    this.assertCanPay(registration);
    const account = await this.prisma.paymentAccount.findFirst({ where: { ownerId: registration.event.ownerId ?? '', active: true }, orderBy: { createdAt: 'desc' } });
    if (!account) throw new ServiceUnavailableException('O organizador ainda não conectou uma conta de pagamento.');
    return { publicKey: account.publicKey, amountInCents: registration.priceInCents, currency: 'BRL', maxInstallments: 12 };
  }

  async create(registrationId: string, token: string | undefined, idempotencyKey: string | undefined, input: CreatePaymentDto) {
    if (!idempotencyKey || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) throw new BadRequestException('Envie uma chave UUID v4 no cabeçalho Idempotency-Key.');
    if (input.method === 'pix' && input.installments !== 1) throw new BadRequestException('O Pix deve ser pago em uma parcela.');
    const registration = await this.participant(registrationId, token);
    const requestHash = digest(JSON.stringify({ method: input.method, cardToken: input.cardToken ?? null, paymentMethodId: input.paymentMethodId ?? null, issuerId: input.issuerId ?? null, installments: input.installments, cpf: input.cpf }));
    const attempt = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM academic_events WHERE id = ${registration.eventId}::uuid FOR UPDATE`;
      const existing = await tx.paymentAttempt.findUnique({ where: { idempotencyKey } });
      if (existing) {
        if (existing.registrationId !== registration.id || existing.requestHash !== requestHash) throw new ConflictException('A chave de idempotência já foi utilizada com outros dados.');
        return existing;
      }
      const current = await tx.registration.findUniqueOrThrow({ where: { id: registration.id }, include: { event: { include: { owner: true } } } });
      this.assertCanPay(current);
      const active = await tx.paymentAttempt.findFirst({ where: { registrationId, status: { in: unresolved } } });
      if (active) throw new ConflictException('Já existe um pagamento em processamento. Consulte seu resultado antes de tentar outro.');
      const account = await tx.paymentAccount.findFirst({ where: { ownerId: current.event.ownerId ?? '', active: true }, orderBy: { createdAt: 'desc' } });
      if (!account) throw new ServiceUnavailableException('O organizador ainda não conectou uma conta de pagamento.');
      if (input.method === 'pix') {
        const expiresAt = new Date(Math.max(current.reservationExpiresAt.getTime(), Date.now() + 30 * 60_000 + 30_000));
        if (current.event.startsAt && current.event.startsAt <= expiresAt) throw new BadRequestException('Prazo insuficiente para pagamento Pix antes do evento.');
        await tx.registration.update({ where: { id: registrationId }, data: { reservationExpiresAt: expiresAt } });
        await tx.auditLog.create({ data: { entityType: 'registration', entityId: registrationId, action: 'reservation.pix_extended', metadata: { expiresAt: expiresAt.toISOString() } } });
      }
      const created = await tx.paymentAttempt.create({ data: { id: randomUUID(), registrationId, accountId: account.id, idempotencyKey, requestHash, method: input.method, installments: input.installments, amountInCents: current.priceInCents } });
      await tx.auditLog.create({ data: { entityType: 'payment', entityId: created.id, action: 'payment.created', metadata: { method: created.method, amountInCents: created.amountInCents } } });
      return created;
    });
    if (!unresolved.includes(attempt.status)) return this.publicAttempt(attempt);
    const accessToken = await this.accounts.accessToken(attempt.accountId);
    let payment = attempt.providerPaymentId ? await this.gateway.getPayment(accessToken, attempt.providerPaymentId) : await this.gateway.searchPayment(accessToken, attempt.id);
    if (!payment) {
      const current = await this.prisma.registration.findUniqueOrThrow({ where: { id: registrationId }, include: { event: { include: { owner: true } } } });
      this.assertCanPay(current);
      const body: Record<string, unknown> = {
        transaction_amount: attempt.amountInCents / 100,
        description: current.event.title.slice(0, 256),
        external_reference: attempt.id,
        installments: attempt.installments,
        payment_method_id: input.method === 'pix' ? 'pix' : input.paymentMethodId,
        payer: { email: current.email, first_name: current.name.slice(0, 100), identification: { type: 'CPF', number: input.cpf } },
        notification_url: this.notificationUrl(),
      };
      if (input.method === 'pix') {
        if (current.reservationExpiresAt.getTime() < Date.now() + 30 * 60_000) throw new ConflictException('O prazo do Pix não permite reenviar a cobrança. Aguarde a reconciliação do pagamento.');
        body.date_of_expiration = current.reservationExpiresAt.toISOString();
      } else {
        body.token = input.cardToken;
        if (input.issuerId) body.issuer_id = input.issuerId;
      }
      try {
        payment = await this.gateway.createPayment(accessToken, attempt.idempotencyKey, body);
      } catch (error) {
        if (error instanceof PaymentRejectedByProvider) {
          await this.prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM academic_events WHERE id = ${registration.eventId}::uuid FOR UPDATE`;
            await tx.paymentAttempt.updateMany({ where: { id: attempt.id, status: 'created', providerPaymentId: null }, data: { status: 'rejected', statusDetail: 'invalid_payment_data' } });
            await tx.auditLog.create({ data: { entityType: 'payment', entityId: attempt.id, action: 'payment.request_rejected' } });
          });
        }
        throw error;
      }
    }
    return this.publicAttempt(await this.applyPayment(attempt.id, payment));
  }

  private notificationUrl(): string {
    const value = process.env.MERCADO_PAGO_NOTIFICATION_URL;
    if (!value || !value.startsWith('https://')) throw new ServiceUnavailableException('Configure uma URL HTTPS para notificações do Mercado Pago.');
    return value;
  }

  private assertCanPay(registration: { status: string; suspendedAt: Date | null; cancellationRequestedAt: Date | null; reservationExpiresAt: Date; event: { status: string; registrationDeadline: Date | null; startsAt: Date | null; owner: { active: boolean } | null } }): void {
    if (registration.status !== 'reserved' || registration.suspendedAt || registration.cancellationRequestedAt || registration.reservationExpiresAt <= new Date() || !registration.event.owner?.active || registration.event.status !== 'published' || (registration.event.registrationDeadline && registration.event.registrationDeadline <= new Date()) || (registration.event.startsAt && registration.event.startsAt <= new Date())) throw new ConflictException('A inscrição não está disponível para pagamento.');
  }

  async applyPayment(attemptId: string, payment: ProviderPayment): Promise<PaymentAttempt> {
    const attempt = await this.prisma.paymentAttempt.findUnique({ where: { id: attemptId }, include: { account: true, registration: true } });
    if (!attempt) throw new NotFoundException('A tentativa de pagamento não foi encontrada.');
    assertProviderPayment(payment, attempt.id, attempt.account.merchantId, attempt.amountInCents, attempt.method, attempt.installments);
    if (!providerStatuses.includes(payment.status)) throw new BadRequestException('O provedor retornou um estado de pagamento desconhecido.');
    const updatedAt = new Date(payment.date_last_updated);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM academic_events WHERE id = ${attempt.registration.eventId}::uuid FOR UPDATE`;
      const current = await tx.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
      if (current.providerPaymentId && current.providerPaymentId !== String(payment.id)) throw new ConflictException('A tentativa já está associada a outro pagamento.');
      if (current.providerUpdatedAt && current.providerUpdatedAt >= updatedAt) return current;
      if (['refunded', 'charged_back'].includes(current.status) || (current.status === 'approved' && !['approved', 'refunded', 'charged_back', 'in_mediation'].includes(payment.status))) return current;
      const registration = await tx.registration.findUniqueOrThrow({ where: { id: current.registrationId }, include: { event: { include: { owner: true } } } });
      const data = payment.point_of_interaction?.transaction_data;
      const checkout: Record<string, string> = {};
      if (data?.qr_code) checkout.qrCode = data.qr_code;
      if (data?.qr_code_base64) checkout.qrCodeBase64 = data.qr_code_base64;
      if (data?.ticket_url && /^https:\/\/(?:www\.)?mercadopago\.com(?:\.br)?\//.test(data.ticket_url)) checkout.ticketUrl = data.ticket_url;
      const saved = await tx.paymentAttempt.update({ where: { id: current.id }, data: { providerPaymentId: String(payment.id), status: payment.status, statusDetail: payment.status_detail?.slice(0, 256), providerUpdatedAt: updatedAt, lastSyncedAt: new Date(), checkout } });
      if (payment.status === 'approved' && registration.status !== 'confirmed') {
        const occupied = await tx.registration.count({ where: { eventId: registration.eventId, id: { not: registration.id }, OR: [{ status: 'confirmed' }, { status: 'reserved', reservationExpiresAt: { gt: new Date() } }] } });
        const canConfirm = ['reserved', 'expired'].includes(registration.status) && !registration.suspendedAt && !registration.cancellationRequestedAt && registration.event.owner?.active && registration.event.status === 'published' && (!registration.event.startsAt || registration.event.startsAt > new Date()) && occupied < registration.event.capacity;
        const status = canConfirm ? 'confirmed' : 'payment_review';
        await tx.registration.update({ where: { id: registration.id }, data: { status } });
        await tx.auditLog.create({ data: { entityType: 'registration', entityId: registration.id, action: canConfirm ? 'registration.confirmed' : 'registration.payment_review', metadata: { paymentId: current.id, reason: canConfirm ? 'payment_approved' : 'capacity_or_registration_unavailable' } } });
      } else if (['refunded', 'charged_back'].includes(payment.status) && ['confirmed', 'payment_review'].includes(registration.status)) {
        const otherApproved = await tx.paymentAttempt.count({ where: { registrationId: registration.id, id: { not: current.id }, status: { in: ['approved', 'in_mediation'] } } });
        if (otherApproved === 0) await tx.registration.update({ where: { id: registration.id }, data: { status: 'canceled' } });
      }
      await tx.auditLog.create({ data: { entityType: 'payment', entityId: current.id, action: 'payment.updated', metadata: { status: payment.status, providerPaymentId: String(payment.id) } } });
      return saved;
    });
  }

  async webhook(signature?: string, requestId?: string, dataId?: string, bodyId?: string, type?: string): Promise<{ received: true }> {
    verifyWebhook(signature, requestId, dataId);
    if (bodyId !== undefined && bodyId !== dataId) throw new UnauthorizedException('O identificador da notificação é inválido.');
    if (type && type !== 'payment') return { received: true };
    const attempt = await this.prisma.paymentAttempt.findUnique({ where: { providerPaymentId: dataId! } });
    if (attempt) {
      const token = await this.accounts.accessToken(attempt.accountId);
      await this.applyPayment(attempt.id, await this.gateway.getPayment(token, dataId!));
    }
    // Notifications arriving before the creation response are recovered by durable reconciliation.
    return { received: true };
  }

  async participantPayments(id: string, token?: string) {
    await this.participant(id, token);
    const attempts = await this.prisma.paymentAttempt.findMany({ where: { registrationId: id }, orderBy: { createdAt: 'desc' } });
    return attempts.map((attempt) => this.publicAttempt(attempt));
  }

  async history(actor: AuthenticatedUser, page = 1) {
    const where: Prisma.PaymentAttemptWhereInput = actor.role === 'admin' ? {} : { registration: { event: { ownerId: actor.id } } };
    const records = await this.prisma.paymentAttempt.findMany({ where, skip: (page - 1) * 50, take: 50, orderBy: { createdAt: 'desc' } });
    return records.map((attempt) => this.publicAttempt(attempt));
  }

  private publicAttempt(attempt: PaymentAttempt) {
    return { id: attempt.id, registrationId: attempt.registrationId, method: attempt.method, installments: attempt.installments, amountInCents: attempt.amountInCents, status: attempt.status, statusDetail: attempt.statusDetail, checkout: attempt.checkout, createdAt: attempt.createdAt, updatedAt: attempt.updatedAt };
  }

  async reconcile(): Promise<void> {
    if (this.syncing) return;
    this.syncing = true;
    try {
      const attempts = await this.prisma.paymentAttempt.findMany({ where: { status: { in: [...unresolved, 'approved'] } }, take: 12, orderBy: [{ lastSyncedAt: { sort: 'asc', nulls: 'first' } }, { updatedAt: 'asc' }] });
      for (const attempt of attempts) {
        try {
          const token = await this.accounts.accessToken(attempt.accountId);
          const payment = attempt.providerPaymentId ? await this.gateway.getPayment(token, attempt.providerPaymentId) : await this.gateway.searchPayment(token, attempt.id);
          if (payment) await this.applyPayment(attempt.id, payment);
          await this.prisma.paymentAttempt.update({ where: { id: attempt.id }, data: { lastSyncedAt: new Date() } });
        } catch {
          await this.prisma.paymentAttempt.update({ where: { id: attempt.id }, data: { lastSyncedAt: new Date() } }).catch(() => undefined);
          this.logger.warn('Uma tentativa de pagamento aguarda nova reconciliação.');
        }
      }
    } catch { this.logger.warn('A reconciliação de pagamentos está temporariamente indisponível.'); }
    finally { this.syncing = false; }
  }
}
