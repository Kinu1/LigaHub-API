import {
  confirmationBlock,
  reviewMessages,
} from '../registrations/payment-review.policy.js';
import type { PaymentHistoryQuery } from './payment-history.query.js';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../prisma.service.js';
import { Prisma, type PaymentAttempt } from '../../generated/prisma/client.js';
import type { AuthenticatedUser } from '../auth/auth.decorators.js';
import { PaymentAccountsService } from './payment-accounts.service.js';
import { enqueueConfirmation } from '../notifications/confirmation-email.js';
import type { CreatePaymentDto } from './payment.dto.js';
import {
  PaymentGateway,
  PaymentRejectedByProvider,
} from './payment.gateway.js';
import {
  assertProviderPayment,
  digest,
  encryptCredential,
  decryptCredential,
  verifyWebhook,
  WebhookValidationError,
  type ProviderPayment,
} from './payment-security.js';
import type { ProviderApi } from './payment-orders.js';

const unresolved = [
  'created',
  'pending',
  'in_process',
  'authorized',
  'in_mediation',
];
const providerStatuses = [
  'pending',
  'approved',
  'authorized',
  'in_process',
  'in_mediation',
  'rejected',
  'cancelled',
  'refunded',
  'charged_back',
];

@Injectable()
export class PaymentsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaymentsService.name);
  private timer?: ReturnType<typeof setInterval>;
  private syncing = false;
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PaymentGateway) private readonly gateway: PaymentGateway,
    @Inject(PaymentAccountsService)
    private readonly accounts: PaymentAccountsService,
  ) {}

  onModuleInit(): void {
    if (
      process.env.BACKGROUND_TIMERS_ENABLED === 'false' ||
      process.env.PAYMENT_RECONCILIATION_ENABLED === 'false'
    )
      return;
    this.timer = setInterval(() => {
      void this.reconcile();
    }, 60_000);
    this.timer.unref();
  }
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async participant(registrationId: string, token?: string) {
    if (!token || token.length > 256)
      throw new UnauthorizedException('Informe o token de acesso à inscrição.');
    const registration = await this.prisma.registration.findUnique({
      where: { id: registrationId },
      include: { event: { include: { owner: true } } },
    });
    const actual = Buffer.from(digest(token), 'hex');
    const expected = Buffer.from(
      registration?.manageTokenHash ?? '0'.repeat(64),
      'hex',
    );
    if (
      !registration ||
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    )
      throw new UnauthorizedException('O acesso à inscrição é inválido.');
    return registration;
  }

  async checkoutConfig(registrationId: string, token?: string) {
    const registration = await this.participant(registrationId, token);
    this.assertCanPay(registration);
    const account = await this.prisma.paymentAccount.findFirst({
      where: { ownerId: registration.event.ownerId ?? '', active: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!account)
      throw new ServiceUnavailableException(
        'O organizador ainda não conectou uma conta de pagamento.',
      );
    return {
      publicKey: account.publicKey,
      amountInCents: registration.priceInCents,
      currency: 'BRL',
      maxInstallments: 12,
    };
  }

  async create(
    registrationId: string,
    token: string | undefined,
    idempotencyKey: string | undefined,
    input: CreatePaymentDto,
  ) {
    if (
      !idempotencyKey ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        idempotencyKey,
      )
    )
      throw new BadRequestException(
        'Envie uma chave UUID v4 no cabeçalho Idempotency-Key.',
      );
    if (input.method === 'pix' && input.installments !== 1)
      throw new BadRequestException('O Pix deve ser pago em uma parcela.');
    if (input.paymentTypeId === 'debit_card' && input.installments !== 1)
      throw new BadRequestException(
        'O cartão de débito deve ser pago em uma parcela.',
      );
    const registration = await this.participant(registrationId, token);
    const requestHash = digest(
      JSON.stringify({
        method: input.method,
        cardToken: input.cardToken ?? null,
        paymentMethodId: input.paymentMethodId ?? null,
        issuerId: input.issuerId ?? null,
        installments: input.installments,
        cpf: input.cpf,
        ...(input.payerName !== undefined
          ? { payerName: input.payerName }
          : {}),
        ...(input.paymentTypeId ? { paymentTypeId: input.paymentTypeId } : {}),
      }),
    );
    const attempt = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM academic_events WHERE id = ${registration.eventId}::uuid FOR UPDATE`;
      const existing = await tx.paymentAttempt.findUnique({
        where: { idempotencyKey },
      });
      if (existing) {
        if (
          existing.registrationId !== registration.id ||
          existing.requestHash !== requestHash
        )
          throw new ConflictException(
            'A chave de idempotência já foi utilizada com outros dados.',
          );
        return existing;
      }
      const current = await tx.registration.findUniqueOrThrow({
        where: { id: registration.id },
        include: { event: { include: { owner: true } } },
      });
      this.assertCanPay(current);
      // Falhas locais de configuração não devem criar cobranças pendentes.
      this.notificationUrl();
      const active = await tx.paymentAttempt.findFirst({
        where: { registrationId, status: { in: unresolved } },
      });
      if (active)
        throw new ConflictException(
          'Já existe um pagamento em processamento. Consulte seu resultado antes de tentar outro.',
        );
      const account = await tx.paymentAccount.findFirst({
        where: { ownerId: current.event.ownerId ?? '', active: true },
        orderBy: { createdAt: 'desc' },
      });
      if (!account)
        throw new ServiceUnavailableException(
          'O organizador ainda não conectou uma conta de pagamento.',
        );
      let expiresAt = current.reservationExpiresAt;
      if (input.method === 'pix') {
        expiresAt = new Date(
          Math.max(
            current.reservationExpiresAt.getTime(),
            Date.now() + 30 * 60_000 + 30_000,
          ),
        );
        if (current.event.startsAt && current.event.startsAt <= expiresAt)
          throw new BadRequestException(
            'Prazo insuficiente para pagamento Pix antes do evento.',
          );
        await tx.registration.update({
          where: { id: registrationId },
          data: { reservationExpiresAt: expiresAt },
        });
        await tx.auditLog.create({
          data: {
            entityType: 'registration',
            entityId: registrationId,
            action: 'reservation.pix_extended',
            metadata: { expiresAt: expiresAt.toISOString() },
          },
        });
      }
      const attemptId = randomUUID();
      const payer = { name: input.payerName ?? current.name, cpf: input.cpf };
      const providerRequest = {
        transaction_amount: current.priceInCents / 100,
        external_reference: attemptId,
        installments: input.installments,
        payment_method_id:
          input.method === 'pix' ? 'pix' : input.paymentMethodId,
        payment_type_id: input.paymentTypeId ?? 'credit_card',
        payer: {
          email: current.email,
          first_name: payer.name.slice(0, 100),
          identification: { type: 'CPF', number: input.cpf },
        },
        ...(input.method === 'pix'
          ? {
              expiration_time: `PT${Math.min(2_592_000, Math.ceil((expiresAt.getTime() - Date.now()) / 1000))}S`,
            }
          : { token: input.cardToken }),
      };
      const created = await tx.paymentAttempt.create({
        data: {
          id: attemptId,
          providerApi: 'orders',
          submissionStarted: false,
          payerEncrypted: encryptCredential(JSON.stringify(payer)),
          providerRequestEncrypted: encryptCredential(
            JSON.stringify(providerRequest),
          ),
          registrationId,
          accountId: account.id,
          idempotencyKey,
          requestHash,
          method: input.method,
          installments: input.installments,
          amountInCents: current.priceInCents,
        },
      });
      await tx.auditLog.create({
        data: {
          entityType: 'payment',
          entityId: created.id,
          action: 'payment.created',
          metadata: {
            method: created.method,
            amountInCents: created.amountInCents,
          },
        },
      });
      return created;
    });
    if (!unresolved.includes(attempt.status))
      return this.publicAttempt(attempt);
    const expiredAttempt = await this.expireUnsubmitted(attempt);
    if (expiredAttempt) return this.publicAttempt(expiredAttempt);
    const accessToken = await this.accounts.accessToken(attempt.accountId);
    const api = this.providerApi(attempt);
    let payment = attempt.providerPaymentId
      ? await this.gateway.getPayment(
          accessToken,
          attempt.providerPaymentId,
          api,
        )
      : await this.gateway.searchPayment(accessToken, attempt.id, {
          api,
          createdAt: attempt.createdAt,
        });
    if (!payment) {
      const current = await this.prisma.registration.findUniqueOrThrow({
        where: { id: registrationId },
        include: { event: { include: { owner: true } } },
      });
      this.assertCanPay(current);
      let request: Record<string, unknown>;
      if (api === 'orders') {
        if (!attempt.providerRequestEncrypted)
          throw new ServiceUnavailableException(
            'A requisição original da order não está disponível. Aguarde a reconciliação.',
          );
        request = JSON.parse(
          decryptCredential(attempt.providerRequestEncrypted),
        ) as Record<string, unknown>;
      } else {
        request = {
          transaction_amount: attempt.amountInCents / 100,
          description: current.event.title.slice(0, 256),
          external_reference: attempt.id,
          installments: attempt.installments,
          payment_method_id:
            input.method === 'pix' ? 'pix' : input.paymentMethodId,
          payer: {
            email: current.email,
            first_name: current.name.slice(0, 100),
            identification: { type: 'CPF', number: input.cpf },
          },
          notification_url: this.notificationUrl(),
        };
        if (input.method === 'pix') {
          if (current.reservationExpiresAt.getTime() < Date.now() + 30 * 60_000)
            throw new ConflictException(
              'O prazo do Pix não permite reenviar a cobrança. Aguarde a reconciliação do pagamento.',
            );
          request.date_of_expiration =
            current.reservationExpiresAt.toISOString();
        } else {
          request.token = input.cardToken;
          if (input.issuerId) request.issuer_id = input.issuerId;
        }
      }
      const terminal = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM academic_events WHERE id = ${registration.eventId}::uuid FOR UPDATE`;
        const latest = await tx.paymentAttempt.findUniqueOrThrow({
          where: { id: attempt.id },
        });
        if (!unresolved.includes(latest.status)) return latest;
        const latestRegistration = await tx.registration.findUniqueOrThrow({
          where: { id: registrationId },
          include: { event: { include: { owner: true } } },
        });
        this.assertCanPay(latestRegistration);
        await tx.paymentAttempt.update({
          where: { id: attempt.id },
          data: { submissionStarted: true },
        });
        return null;
      });
      if (terminal) return this.publicAttempt(terminal);
      try {
        payment = await this.gateway.createPayment(
          accessToken,
          attempt.idempotencyKey,
          request,
          api,
        );
      } catch (error) {
        if (error instanceof PaymentRejectedByProvider) {
          await this.prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM academic_events WHERE id = ${registration.eventId}::uuid FOR UPDATE`;
            await tx.paymentAttempt.updateMany({
              where: {
                id: attempt.id,
                status: 'created',
                providerPaymentId: null,
              },
              data: {
                status: 'rejected',
                statusDetail: error.reason,
                providerRequestEncrypted: null,
                ...(!attempt.payerEncrypted && attempt.providerRequestEncrypted
                  ? { payerEncrypted: this.encryptOriginalPayer(attempt) }
                  : {}),
              },
            });
            await tx.auditLog.create({
              data: {
                entityType: 'payment',
                entityId: attempt.id,
                action: 'payment.request_rejected',
              },
            });
          });
        }
        throw error;
      }
    }
    return this.publicAttempt(await this.applyPayment(attempt.id, payment));
  }

  async confirmPaymentReview(id: string, actor: AuthenticatedUser) {
    const load = (db: Prisma.TransactionClient | PrismaService) =>
      db.registration.findUnique({
        where: { id },
        include: { event: { include: { owner: true } } },
      });
    const authorize = async (
      db: Prisma.TransactionClient | PrismaService,
      ownerId: string | null,
    ) => {
      const user = await db.user.findUnique({ where: { id: actor.id } });
      if (
        !user?.active ||
        !['admin', 'organizer'].includes(user.role) ||
        (user.role !== 'admin' && ownerId !== user.id)
      )
        throw new ForbiddenException('Você não pode reavaliar esta inscrição.');
    };
    const safe = (record: {
      id: string;
      status: string;
      reviewReason: string | null;
    }) => ({
      id: record.id,
      status: record.status,
      reviewReason: record.reviewReason,
    });
    const registration = await load(this.prisma);
    if (!registration) throw new NotFoundException('Inscrição não encontrada.');
    const version = (record: NonNullable<Awaited<ReturnType<typeof load>>>) => {
      const { event: _event, ...fields } = record;
      return digest(JSON.stringify(fields));
    };
    await authorize(this.prisma, registration.event.ownerId);
    if (registration.status === 'confirmed') return safe(registration);
    if (registration.status !== 'payment_review')
      throw new ConflictException(
        registration.status === 'canceled'
          ? reviewMessages.registration_canceled
          : 'O estado da inscrição não permite reavaliação de pagamento.',
      );
    const attempts = await this.prisma.paymentAttempt.findMany({
      where: { registrationId: id },
    });
    const relevant = attempts.filter((a) =>
      ['approved', 'in_mediation'].includes(a.status),
    );
    const attempt = relevant[0];
    const financialConflict = () =>
      new ConflictException(
        'Não há um único pagamento aprovado verificável. Confira e ajuste o pagamento na conta do provedor e depois sincronize.',
      );
    if (
      relevant.length !== 1 ||
      attempt.status !== 'approved' ||
      !attempt.providerPaymentId
    )
      throw financialConflict();
    let payment: ProviderPayment;
    try {
      const token = await this.accounts.accessToken(attempt.accountId);
      payment = await this.gateway.getPayment(
        token,
        attempt.providerPaymentId,
        this.providerApi(attempt),
      );
    } catch {
      throw new ServiceUnavailableException(
        'Não foi possível consultar o provedor. Tente reavaliar novamente mais tarde.',
      );
    }
    // Compartilha a validação de estados terminais e datas com a reconciliação.
    const synced = await this.applyPayment(attempt.id, payment, true, attempt);
    return this.prisma
      .$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM academic_events WHERE id = ${registration.eventId}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM registrations WHERE id = ${id}::uuid FOR UPDATE`;
        const current = await load(tx);
        if (!current) throw new NotFoundException('Inscrição não encontrada.');
        await authorize(tx, current.event.ownerId);
        if (current.status === 'confirmed') return safe(current);
        const latest = await tx.paymentAttempt.findMany({
          where: { registrationId: id },
        });
        const approved = latest.filter((a) =>
          ['approved', 'in_mediation'].includes(a.status),
        );
        const saved = latest.find((a) => a.id === attempt.id);
        if (
          payment.status !== 'approved' ||
          !saved ||
          saved.status !== 'approved' ||
          approved.length !== 1 ||
          approved[0].id !== attempt.id ||
          saved.updatedAt.getTime() !== synced.updatedAt.getTime() ||
          saved.providerUpdatedAt?.getTime() !==
            new Date(payment.date_last_updated).getTime() ||
          saved.providerPaymentId !== String(payment.id)
        )
          throw financialConflict();
        if (version(current) !== version(registration))
          throw new ConflictException(
            'A inscrição mudou durante a consulta. Atualize a página e reavalie.',
          );
        const occupied = await tx.registration.count({
          where: {
            eventId: current.eventId,
            id: { not: id },
            OR: [
              { status: 'confirmed' },
              { status: 'reserved', reservationExpiresAt: { gt: new Date() } },
            ],
          },
        });
        const reason = confirmationBlock(current, occupied, new Date(), true);
        if (reason) {
          await tx.registration.update({
            where: { id },
            data: {
              reviewReason: current.status === 'canceled' ? null : reason,
            },
          });
          await tx.auditLog.create({
            data: {
              entityType: 'registration',
              entityId: id,
              action: 'registration.payment_review_blocked',
              actorId: actor.id,
              metadata: { paymentId: attempt.id, reason },
            },
          });
          return { blocked: reason } as const;
        }
        const confirmed = await tx.registration.update({
          where: { id },
          data: { status: 'confirmed', reviewReason: null },
        });
        await enqueueConfirmation(tx, current);
        await tx.auditLog.create({
          data: {
            entityType: 'registration',
            entityId: id,
            action: 'registration.payment_review_confirmed',
            actorId: actor.id,
            metadata: {
              paymentId: attempt.id,
              reason: current.reviewReason ?? 'reason_not_recorded',
            },
          },
        });
        return safe(confirmed);
      })
      .then((result) => {
        if ('blocked' in result)
          throw new ConflictException(reviewMessages[result.blocked]);
        return result;
      });
  }

  private notificationUrl(): string {
    const value = process.env.MERCADO_PAGO_NOTIFICATION_URL;
    try {
      const url = new URL(value ?? '');
      if (url.protocol !== 'https:' || url.username || url.password || url.hash)
        throw new Error('URL inválida.');
      return url.toString();
    } catch {
      throw new ServiceUnavailableException(
        'Configure uma URL HTTPS para notificações do Mercado Pago.',
      );
    }
  }

  private assertCanPay(registration: {
    status: string;
    suspendedAt: Date | null;
    cancellationRequestedAt: Date | null;
    reservationExpiresAt: Date;
    event: {
      status: string;
      registrationDeadline: Date | null;
      startsAt: Date | null;
      owner: { active: boolean } | null;
    };
  }): void {
    if (
      registration.status !== 'reserved' ||
      registration.suspendedAt ||
      registration.cancellationRequestedAt ||
      registration.reservationExpiresAt <= new Date() ||
      !registration.event.owner?.active ||
      registration.event.status !== 'published' ||
      (registration.event.registrationDeadline &&
        registration.event.registrationDeadline <= new Date()) ||
      (registration.event.startsAt && registration.event.startsAt <= new Date())
    )
      throw new ConflictException(
        'A inscrição não está disponível para pagamento.',
      );
  }

  async applyPayment(
    attemptId: string,
    payment: ProviderPayment,
    reviewOnly = false,
    expectedAttempt?: PaymentAttempt,
  ): Promise<PaymentAttempt> {
    const attempt = await this.prisma.paymentAttempt.findUnique({
      where: { id: attemptId },
      include: { account: true, registration: true },
    });
    if (!attempt)
      throw new NotFoundException(
        'A tentativa de pagamento não foi encontrada.',
      );
    assertProviderPayment(
      payment,
      attempt.id,
      attempt.account.merchantId,
      attempt.amountInCents,
      attempt.method,
      attempt.installments,
    );
    if (!providerStatuses.includes(payment.status))
      throw new BadRequestException(
        'O provedor retornou um estado de pagamento desconhecido.',
      );
    const updatedAt = new Date(payment.date_last_updated);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM academic_events WHERE id = ${attempt.registration.eventId}::uuid FOR UPDATE`;
      const current = await tx.paymentAttempt.findUniqueOrThrow({
        where: { id: attempt.id },
      });
      if (
        expectedAttempt &&
        current.updatedAt.getTime() !== expectedAttempt.updatedAt.getTime()
      )
        throw new ConflictException(
          'O pagamento mudou durante a consulta. Atualize a página e reavalie.',
        );
      if (
        current.providerPaymentId &&
        current.providerPaymentId !== String(payment.id)
      )
        throw new ConflictException(
          'A tentativa já está associada a outro pagamento.',
        );
      if (current.providerUpdatedAt && current.providerUpdatedAt >= updatedAt)
        return current;
      if (
        ['refunded', 'charged_back'].includes(current.status) ||
        (current.status === 'approved' &&
          !['approved', 'refunded', 'charged_back', 'in_mediation'].includes(
            payment.status,
          ))
      )
        return current;
      const registration = await tx.registration.findUniqueOrThrow({
        where: { id: current.registrationId },
        include: { event: { include: { owner: true } } },
      });
      const data = payment.point_of_interaction?.transaction_data;
      const checkout: Record<string, string> = {};
      if (data?.qr_code) checkout.qrCode = data.qr_code;
      if (data?.qr_code_base64) checkout.qrCodeBase64 = data.qr_code_base64;
      if (
        data?.ticket_url &&
        /^https:\/\/(?:www\.)?mercadopago\.com(?:\.br)?\//.test(data.ticket_url)
      )
        checkout.ticketUrl = data.ticket_url;
      const saved = await tx.paymentAttempt.update({
        where: { id: current.id },
        data: {
          providerPaymentId: String(payment.id),
          providerRequestEncrypted: null,
          // Preserve legacy pending requests before discarding their card token.
          ...(!current.payerEncrypted && current.providerRequestEncrypted
            ? { payerEncrypted: this.encryptOriginalPayer(current) }
            : {}),
          status: payment.status,
          statusDetail: payment.status_detail?.slice(0, 256),
          providerUpdatedAt: updatedAt,
          lastSyncedAt: new Date(),
          checkout,
        },
      });
      if (
        !reviewOnly &&
        payment.status === 'approved' &&
        registration.status !== 'confirmed'
      ) {
        const occupied = await tx.registration.count({
          where: {
            eventId: registration.eventId,
            id: { not: registration.id },
            OR: [
              { status: 'confirmed' },
              { status: 'reserved', reservationExpiresAt: { gt: new Date() } },
            ],
          },
        });
        const block = confirmationBlock(registration, occupied, new Date());
        const reason =
          block === 'invalid_registration_state' &&
          registration.status === 'payment_review'
            ? registration.reviewReason
            : block;
        const canConfirm = block === null;
        const status = canConfirm
          ? 'confirmed'
          : registration.status === 'canceled'
            ? 'canceled'
            : 'payment_review';
        await tx.registration.update({
          where: { id: registration.id },
          data: { status, reviewReason: status === 'canceled' ? null : reason },
        });
        if (canConfirm) await enqueueConfirmation(tx, registration);
        await tx.auditLog.create({
          data: {
            entityType: 'registration',
            entityId: registration.id,
            action: canConfirm
              ? 'registration.confirmed'
              : 'registration.payment_review',
            metadata: {
              paymentId: current.id,
              reason: canConfirm ? 'payment_approved' : reason,
            },
          },
        });
      } else if (
        ['refunded', 'charged_back'].includes(payment.status) &&
        ['confirmed', 'payment_review'].includes(registration.status)
      ) {
        const otherApproved = await tx.paymentAttempt.count({
          where: {
            registrationId: registration.id,
            id: { not: current.id },
            status: { in: ['approved', 'in_mediation'] },
          },
        });
        if (otherApproved === 0) {
          await tx.registration.update({
            where: { id: registration.id },
            data: { status: 'canceled', reviewReason: null },
          });
          await tx.auditLog.create({
            data: {
              entityType: 'registration',
              entityId: registration.id,
              action: 'registration.canceled',
              metadata: {
                paymentId: current.id,
                status: 'canceled',
                reason:
                  payment.status === 'refunded'
                    ? 'payment_refunded'
                    : 'payment_charged_back',
              },
            },
          });
        }
      }
      await tx.auditLog.create({
        data: {
          entityType: 'payment',
          entityId: current.id,
          action: 'payment.updated',
          metadata: {
            status: payment.status,
            providerPaymentId: String(payment.id),
          },
        },
      });
      return saved;
    });
  }

  async webhook(
    signature?: string,
    requestId?: string,
    dataId?: string,
    bodyId?: string,
    type?: string,
  ): Promise<{ received: true }> {
    try {
      verifyWebhook(signature, requestId, dataId);
    } catch (error) {
      if (error instanceof WebhookValidationError)
        this.logger.warn({
          event: 'payment.webhook.rejected',
          reason: error.reason,
          signaturePresent: typeof signature === 'string' && !!signature,
          requestIdPresent: typeof requestId === 'string' && !!requestId,
          dataIdPresent: typeof dataId === 'string' && !!dataId,
          ...(error.ageSeconds !== undefined
            ? { ageSeconds: error.ageSeconds }
            : {}),
        });
      throw error;
    }
    if (bodyId !== undefined && bodyId !== dataId)
      throw new UnauthorizedException(
        'O identificador da notificação é inválido.',
      );
    if (type && !['payment', 'order'].includes(type)) return { received: true };
    const attempt = await this.prisma.paymentAttempt.findUnique({
      where: { providerPaymentId: dataId! },
    });
    if (attempt) {
      const api = this.providerApi(attempt);
      if ((type ?? 'payment') !== (api === 'orders' ? 'order' : 'payment'))
        return { received: true };
      const token = await this.accounts.accessToken(attempt.accountId);
      await this.applyPayment(
        attempt.id,
        await this.gateway.getPayment(token, dataId!, api),
      );
    }
    // Notifications arriving before the creation response are recovered by durable reconciliation.
    return { received: true };
  }

  async participantPayments(id: string, token?: string) {
    await this.participant(id, token);
    const attempts = await this.prisma.paymentAttempt.findMany({
      where: { registrationId: id },
      orderBy: { createdAt: 'desc' },
    });
    return attempts.map((attempt) => this.publicAttempt(attempt));
  }

  async history(
    actor: AuthenticatedUser,
    page = 1,
    paginated = false,
    filters: Partial<PaymentHistoryQuery> = {},
  ) {
    const conditions: Prisma.PaymentAttemptWhereInput[] = [
      actor.role === 'admin'
        ? {}
        : { registration: { event: { ownerId: actor.id } } },
    ];
    if (filters.eventId)
      conditions.push({ registration: { eventId: filters.eventId } });
    if (filters.eventSearch)
      conditions.push({
        registration: {
          event: {
            title: { contains: filters.eventSearch, mode: 'insensitive' },
          },
        },
      });
    if (filters.status) conditions.push({ status: filters.status });
    if (filters.method) conditions.push({ method: filters.method });
    if (filters.from || filters.to)
      conditions.push({
        createdAt: {
          ...(filters.from ? { gte: new Date(filters.from) } : {}),
          ...(filters.to ? { lt: new Date(filters.to) } : {}),
        },
      });
    const where: Prisma.PaymentAttemptWhereInput = { AND: conditions };
    const records = await this.prisma.paymentAttempt.findMany({
      where,
      skip: (page - 1) * 50,
      take: 50,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        registration: {
          select: { event: { select: { id: true, title: true } } },
        },
      },
    });
    const items = records.map((attempt) => ({
      ...this.publicAttempt(attempt),
      payer: this.historyPayer(attempt),
      event: attempt.registration.event,
    }));
    if (!paginated) return items;
    const total = await this.prisma.paymentAttempt.count({ where });
    return { items, total, page, limit: 50 };
  }

  private publicAttempt(attempt: PaymentAttempt) {
    return {
      id: attempt.id,
      registrationId: attempt.registrationId,
      method: attempt.method,
      installments: attempt.installments,
      amountInCents: attempt.amountInCents,
      status: attempt.status,
      statusDetail: attempt.statusDetail,
      checkout: attempt.checkout,
      createdAt: attempt.createdAt,
      updatedAt: attempt.updatedAt,
    };
  }

  private historyPayer(
    attempt: PaymentAttempt,
  ): { name: string; cpf: string } | null {
    const encrypted =
      attempt.payerEncrypted ?? attempt.providerRequestEncrypted;
    if (!encrypted) return null;
    try {
      const stored = JSON.parse(decryptCredential(encrypted)) as {
        name?: unknown;
        cpf?: unknown;
        payer?: {
          first_name?: unknown;
          last_name?: unknown;
          identification?: { type?: unknown; number?: unknown };
        };
      } | null;
      if (!stored || typeof stored !== 'object') return null;
      const name = attempt.payerEncrypted
        ? stored.name
        : [stored.payer?.first_name, stored.payer?.last_name]
            .filter((part) => typeof part === 'string' && part.trim())
            .join(' ');
      const cpf = attempt.payerEncrypted
        ? stored.cpf
        : stored.payer?.identification?.type === 'CPF'
          ? stored.payer.identification.number
          : undefined;
      if (
        typeof name !== 'string' ||
        !name.trim() ||
        typeof cpf !== 'string' ||
        !/^\d{11}$/.test(cpf)
      )
        return null;
      return { name: name.trim(), cpf };
    } catch {
      throw new ServiceUnavailableException(
        'Não foi possível consultar os dados do pagador.',
      );
    }
  }

  private encryptOriginalPayer(attempt: PaymentAttempt): string | null {
    const payer = this.historyPayer(attempt);
    return payer ? encryptCredential(JSON.stringify(payer)) : null;
  }

  private providerApi(attempt: PaymentAttempt): ProviderApi {
    if (!attempt.providerApi || attempt.providerApi === 'payments')
      return 'payments';
    if (attempt.providerApi === 'orders') return 'orders';
    throw new ServiceUnavailableException(
      'A API da tentativa de pagamento é inválida.',
    );
  }

  async reconcile(): Promise<void> {
    if (this.syncing) return;
    this.syncing = true;
    try {
      const attempts = await this.prisma.paymentAttempt.findMany({
        where: { status: { in: [...unresolved, 'approved'] } },
        take: 12,
        orderBy: [
          { lastSyncedAt: { sort: 'asc', nulls: 'first' } },
          { updatedAt: 'asc' },
        ],
      });
      for (const attempt of attempts) {
        try {
          if (await this.expireUnsubmitted(attempt)) continue;
          const token = await this.accounts.accessToken(attempt.accountId);
          const api = this.providerApi(attempt);
          const payment = attempt.providerPaymentId
            ? await this.gateway.getPayment(
                token,
                attempt.providerPaymentId,
                api,
              )
            : await this.gateway.searchPayment(token, attempt.id, {
                api,
                createdAt: attempt.createdAt,
              });
          if (payment) await this.applyPayment(attempt.id, payment);
          await this.prisma.paymentAttempt.update({
            where: { id: attempt.id },
            data: { lastSyncedAt: new Date() },
          });
        } catch {
          await this.prisma.paymentAttempt
            .update({
              where: { id: attempt.id },
              data: { lastSyncedAt: new Date() },
            })
            .catch(() => undefined);
          this.logger.warn(
            'Uma tentativa de pagamento aguarda nova reconciliação.',
          );
        }
      }
    } catch {
      this.logger.warn(
        'A reconciliação de pagamentos está temporariamente indisponível.',
      );
    } finally {
      this.syncing = false;
    }
  }

  private async expireUnsubmitted(
    attempt: PaymentAttempt,
  ): Promise<PaymentAttempt | null> {
    if (
      attempt.status !== 'created' ||
      attempt.submissionStarted !== false ||
      attempt.providerPaymentId
    )
      return null;
    const registration = await this.prisma.registration.findUniqueOrThrow({
      where: { id: attempt.registrationId },
    });
    if (registration.reservationExpiresAt > new Date()) return null;
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM academic_events WHERE id = ${registration.eventId}::uuid FOR UPDATE`;
      const current = await tx.paymentAttempt.findUniqueOrThrow({
        where: { id: attempt.id },
      });
      const latestRegistration = await tx.registration.findUniqueOrThrow({
        where: { id: attempt.registrationId },
      });
      if (
        current.status !== 'created' ||
        current.submissionStarted !== false ||
        current.providerPaymentId ||
        latestRegistration.reservationExpiresAt > new Date()
      )
        return null;
      const closed = await tx.paymentAttempt.update({
        where: { id: current.id },
        data: {
          status: 'cancelled',
          statusDetail: 'not_submitted_before_expiration',
          providerRequestEncrypted: null,
          lastSyncedAt: new Date(),
        },
      });
      await tx.auditLog.create({
        data: {
          entityType: 'payment',
          entityId: current.id,
          action: 'payment.updated',
          metadata: {
            status: 'cancelled',
            reason: 'not_submitted_before_expiration',
          },
        },
      });
      return closed;
    });
  }
}
