import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { pixRouting } from '../payments/pix-routing.js';
import { publicPixPricing } from '../payments/pix-pricing.js';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { AuthenticatedUser } from '../auth/auth.decorators.js';
import { validateAnswers } from '../catalog/forms.js';
import {
  assertAvailableCapacity,
  assertRegistrationOpen,
} from './registration.policy.js';
import type { CreateRegistrationDto } from './registrations.dto.js';

import { isUniqueConstraint } from '../../common/prisma-errors.js';
import {
  encryptCredential,
  decryptCredential,
} from '../payments/payment-security.js';
import { participantFinancial } from './participant-financial.js';
import { validParticipantCpf } from './participant-cpf.js';
import { createParticipantsWorkbook } from './participants-export.js';
import type { RegistrationPaginationDto } from './registrations.dto.js';

const participantSelect = {
  id: true,
  name: true,
  email: true,
  answers: true,
  formSnapshot: true,
  reviewReason: true,
  priceInCents: true,
  registrationTypeName: true,
  registrationTypeId: true,
  participantCpfEncrypted: true,
  payments: {
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true, status: true },
  },
  status: true,
  reservationExpiresAt: true,
  suspendedAt: true,
  cancellationRequestedAt: true,
  createdAt: true,
} satisfies Prisma.RegistrationSelect;

export const hashParticipantToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

@Injectable()
export class RegistrationsService {
  async participantStatus(id: string, token?: string) {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new UnauthorizedException(
        'O link de consulta é inválido ou expirou.',
      );
    const registration = await this.prisma.registration.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        status: true,
        reviewReason: true,
        suspendedAt: true,
        cancellationRequestedAt: true,
        statusTokenHash: true,
        statusTokenExpiresAt: true,
        event: {
          select: { title: true, startsAt: true, location: true, status: true },
        },
      },
    });
    const received = createHash('sha256').update(token).digest();
    const expected = Buffer.from(
      registration?.statusTokenHash ?? '0'.repeat(64),
      'hex',
    );
    if (
      !registration ||
      !registration.statusTokenExpiresAt ||
      registration.statusTokenExpiresAt <= new Date() ||
      expected.length !== received.length ||
      !timingSafeEqual(received, expected)
    )
      throw new UnauthorizedException(
        'O link de consulta é inválido ou expirou.',
      );
    return {
      id: registration.id,
      reviewReason: registration.reviewReason,
      name: registration.name,
      status: registration.status,
      suspended: Boolean(registration.suspendedAt),
      cancellationRequested: Boolean(registration.cancellationRequestedAt),
      event: registration.event,
    };
  }
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async reserve(publicId: string, input: CreateRegistrationDto) {
    if (!validParticipantCpf(input.cpf))
      throw new BadRequestException(
        'Informe um CPF válido para o participante.',
      );
    const name = input.name.trim();
    if (name.length < 2)
      throw new BadRequestException('Informe o nome completo do participante.');
    const email = input.email.trim().toLowerCase();
    const manageToken = randomBytes(32).toString('base64url');
    try {
      const record = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "academic_events" WHERE "publicId" = ${publicId}::uuid FOR UPDATE`;
        const event = await tx.academicEvent.findUnique({
          where: { publicId },
          include: { owner: true },
        });
        if (!event) throw new NotFoundException('Evento não encontrado.');
        const configuredTypes = Array.isArray(event.registrationTypes)
          ? (event.registrationTypes as unknown as Array<{
              id: string;
              name: string;
              priceInCents: number;
              capacity?: number | null;
            }>)
          : [];
        const availableTypes = configuredTypes.length
          ? configuredTypes
          : [
              {
                id: 'geral',
                name: 'Inscrição geral',
                priceInCents: event.priceInCents,
                capacity: null,
              },
            ];
        const registrationType = availableTypes.find(
          (type) =>
            type.id === (input.registrationTypeId ?? availableTypes[0].id),
        );
        if (!registrationType)
          throw new BadRequestException(
            'Selecione um tipo de inscrição válido.',
          );
        const now = new Date();
        assertRegistrationOpen(event, now);
        if (!event.owner?.active)
          throw new ConflictException(
            'O organizador deste evento está indisponível.',
          );
        if (registrationType.priceInCents > 0) {
          const routing = await pixRouting(tx, event.ownerId!);
          const account =
            routing?.account ??
            (await tx.paymentAccount.findFirst({
              where: { ownerId: event.ownerId!, active: true },
            }));
          if (!account)
            throw new ConflictException(
              'O organizador ainda não conectou sua conta de recebimento.',
            );
        }
        const answers = validateAnswers(event.form, input.answers);
        const occupied = await tx.registration.count({
          where: {
            eventId: event.id,
            OR: [
              { status: 'confirmed' },
              { status: 'reserved', reservationExpiresAt: { gt: now } },
            ],
          },
        });
        assertAvailableCapacity(event.capacity, occupied);
        if (registrationType.capacity != null) {
          const typeOccupied = await tx.registration.count({
            where: {
              eventId: event.id,
              registrationTypeId: registrationType.id,
              OR: [
                { status: 'confirmed' },
                { status: 'reserved', reservationExpiresAt: { gt: now } },
              ],
            },
          });
          assertAvailableCapacity(registrationType.capacity, typeOccupied);
        }
        const expired = await tx.registration.updateMany({
          where: {
            eventId: event.id,
            status: 'reserved',
            reservationExpiresAt: { lte: now },
          },
          data: { status: 'expired' },
        });
        if (expired.count)
          await tx.auditLog.create({
            data: {
              entityType: 'event',
              entityId: event.id,
              action: 'reservations.expired',
              metadata: { count: expired.count },
            },
          });
        const deadline = event.registrationDeadline ?? event.startsAt!;
        const expiresAt = new Date(
          Math.min(
            now.getTime() + event.reservationMinutes * 60000,
            deadline.getTime(),
          ),
        );
        const registration = await tx.registration.create({
          data: {
            eventId: event.id,
            name,
            email,
            participantCpfEncrypted: input.cpf
              ? encryptCredential(input.cpf)
              : null,
            answers: answers as Prisma.InputJsonObject,
            formSnapshot: event.form as Prisma.InputJsonValue,
            registrationTypeId: registrationType.id,
            registrationTypeName: registrationType.name,
            priceInCents: registrationType.priceInCents,
            status:
              registrationType.priceInCents === 0 ? 'confirmed' : 'reserved',
            reservationExpiresAt: expiresAt,
            manageTokenHash: hashParticipantToken(manageToken),
            manageTokenEncrypted: encryptCredential(manageToken),
          },
        });
        await tx.auditLog.create({
          data: {
            entityType: 'registration',
            entityId: registration.id,
            action:
              registrationType.priceInCents === 0
                ? 'registration.confirmed_free'
                : 'registration.reserved',
            metadata: {
              eventId: event.id,
              registrationTypeId: registrationType.id,
            },
          },
        });
        return registration;
      });
      return {
        id: record.id,
        status: record.status,
        priceInCents: record.priceInCents,
        reservationExpiresAt: record.reservationExpiresAt,
        manageToken,
      };
    } catch (error) {
      if (
        isUniqueConstraint(
          error,
          ['eventId', 'email'],
          'registrations_eventId_email_key',
        )
      )
        throw new ConflictException(
          'Você já possui uma inscrição neste evento.',
        );
      throw error;
    }
  }

  async authorize(id: string, token: string | undefined) {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new UnauthorizedException(
        'O link de acesso à inscrição é inválido.',
      );
    const registration = await this.prisma.registration.findUnique({
      where: { id },
      include: { event: true },
    });
    const expected = Buffer.from(
      registration?.manageTokenHash ?? '0'.repeat(64),
      'hex',
    );
    const received = Buffer.from(hashParticipantToken(token), 'hex');
    if (!timingSafeEqual(expected, received) || !registration)
      throw new UnauthorizedException(
        'O link de acesso à inscrição é inválido.',
      );
    return registration;
  }

  async participantDetails(id: string, token?: string) {
    const registration = await this.authorize(id, token);
    const payments = await this.prisma.paymentAttempt.findMany({
      where: { registrationId: id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        method: true,
        installments: true,
        amountInCents: true,
        registrationAmountInCents: true,
        platformFeeInCents: true,
        processingFeeInCents: true,
        status: true,
        checkout: true,
        createdAt: true,
      },
    });
    return {
      id: registration.id,
      reviewReason: registration.reviewReason,
      name: registration.name,
      email: registration.email,
      cpf: registration.participantCpfEncrypted
        ? decryptCredential(registration.participantCpfEncrypted)
        : null,
      answers: registration.answers,
      status:
        registration.status === 'reserved' &&
        registration.reservationExpiresAt <= new Date()
          ? 'expired'
          : registration.status,
      suspended: Boolean(registration.suspendedAt),
      priceInCents: registration.priceInCents,
      reservationExpiresAt: registration.reservationExpiresAt,
      cancellationRequestedAt: registration.cancellationRequestedAt,
      event: {
        title: registration.event.title,
        logoImage: registration.event.logoImage,
        bannerImage: registration.event.bannerImage,
        publicId: registration.event.publicId,
        status: registration.event.status,
      },
      payments: payments.map((payment) => {
        const {
          registrationAmountInCents: _base,
          platformFeeInCents: _platform,
          processingFeeInCents: _processing,
          ...record
        } = payment;
        return {
          ...record,
          ...(publicPixPricing(payment)
            ? { pricing: publicPixPricing(payment) }
            : {}),
        };
      }),
    };
  }

  async requestCancellation(id: string, token?: string) {
    const registration = await this.authorize(id, token);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "academic_events" WHERE "id" = ${registration.eventId}::uuid FOR UPDATE`;
      const updated = await tx.registration.updateMany({
        where: { id, cancellationRequestedAt: null },
        data: { cancellationRequestedAt: new Date() },
      });
      if (updated.count)
        await tx.auditLog.create({
          data: {
            entityType: 'registration',
            entityId: id,
            action: 'cancellation.requested',
            metadata: { eventId: registration.eventId },
          },
        });
    });
    return {
      message:
        'Solicitação de cancelamento registrada. O organizador é responsável pela análise e pelo eventual reembolso.',
    };
  }

  async renew(id: string, token?: string) {
    const authorized = await this.authorize(id, token);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "academic_events" WHERE "id" = ${authorized.eventId}::uuid FOR UPDATE`;
      const record = await tx.registration.findUniqueOrThrow({
        where: { id },
        include: { event: { include: { owner: true } } },
      });
      const now = new Date();
      assertRegistrationOpen(record.event, now);
      if (
        !record.event.owner?.active ||
        record.suspendedAt ||
        record.cancellationRequestedAt
      )
        throw new ConflictException('Não é possível renovar esta reserva.');
      if (
        !(await pixRouting(tx, record.event.ownerId!)) &&
        !(await tx.paymentAccount.findFirst({
          where: { ownerId: record.event.ownerId!, active: true },
        }))
      )
        throw new ConflictException(
          'O organizador ainda não conectou sua conta de recebimento.',
        );
      if (record.status === 'reserved' && record.reservationExpiresAt > now)
        return {
          id,
          reservationExpiresAt: record.reservationExpiresAt,
          status: record.status,
        };
      if (!['reserved', 'expired'].includes(record.status))
        throw new ConflictException('Não é possível renovar esta reserva.');
      const unresolved = await tx.paymentAttempt.count({
        where: {
          registrationId: id,
          status: {
            in: [
              'created',
              'pending',
              'in_process',
              'authorized',
              'in_mediation',
              'approved',
            ],
          },
        },
      });
      if (unresolved)
        throw new ConflictException(
          'Aguarde a confirmação do pagamento anterior antes de renovar.',
        );
      const occupied = await tx.registration.count({
        where: {
          eventId: record.eventId,
          OR: [
            { status: 'confirmed' },
            { status: 'reserved', reservationExpiresAt: { gt: now } },
          ],
        },
      });
      assertAvailableCapacity(record.event.capacity, occupied);
      const deadline =
        record.event.registrationDeadline ?? record.event.startsAt!;
      const expires = new Date(
        Math.min(
          now.getTime() + record.event.reservationMinutes * 60000,
          deadline.getTime(),
        ),
      );
      await tx.registration.update({
        where: { id },
        data: { status: 'reserved', reservationExpiresAt: expires },
      });
      await tx.auditLog.create({
        data: {
          entityType: 'registration',
          entityId: id,
          action: 'reservation.renewed',
          metadata: { eventId: record.eventId },
        },
      });
      return { id, status: 'reserved', reservationExpiresAt: expires };
    });
  }

  private async eventAccess(
    eventId: string,
    actor: AuthenticatedUser,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    const event = await db.academicEvent.findUnique({
      where: { id: eventId },
    });
    if (!event) throw new NotFoundException('Evento não encontrado.');
    if (actor.role !== 'admin' && event.ownerId !== actor.id)
      throw new ForbiddenException('Você não tem acesso a este evento.');
    return event;
  }

  private participantFilters(
    eventId: string,
    pagination: RegistrationPaginationDto,
    now: Date,
  ) {
    const where: Prisma.RegistrationWhereInput = {
      eventId,
      ...(pagination.registrationTypeId &&
      pagination.registrationTypeId !== 'geral'
        ? { registrationTypeId: pagination.registrationTypeId }
        : {}),
      ...(pagination.search
        ? {
            OR: [
              {
                name: {
                  contains: pagination.search.trim(),
                  mode: 'insensitive',
                },
              },
              {
                email: {
                  contains: pagination.search.trim(),
                  mode: 'insensitive',
                },
              },
            ],
          }
        : {}),
      ...(pagination.status === 'cancellation'
        ? {
            cancellationRequestedAt: { not: null },
            status: { not: 'canceled' },
          }
        : pagination.status === 'expired'
          ? {
              AND: [
                {
                  OR: [
                    { status: 'expired' },
                    { status: 'reserved', reservationExpiresAt: { lte: now } },
                  ],
                },
              ],
            }
          : pagination.status === 'reserved'
            ? { status: 'reserved', reservationExpiresAt: { gt: now } }
            : pagination.status
              ? { status: pagination.status }
              : {}),
    };
    if (pagination.registrationTypeId === 'geral') {
      const existing = where.AND
        ? Array.isArray(where.AND)
          ? where.AND
          : [where.AND]
        : [];
      where.AND = [
        ...existing,
        { OR: [{ registrationTypeId: 'geral' }, { registrationTypeId: null }] },
      ];
    }
    return where;
  }

  async list(
    eventId: string,
    actor: AuthenticatedUser,
    pagination: RegistrationPaginationDto,
  ) {
    await this.eventAccess(eventId, actor);
    const now = new Date();
    const where = this.participantFilters(eventId, pagination, now);
    const [items, total] = await Promise.all([
      this.prisma.registration.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (pagination.page - 1) * pagination.limit,
        take: pagination.limit,
        select: participantSelect,
      }),
      this.prisma.registration.count({ where }),
    ]);
    return {
      items: await this.presentParticipants(this.prisma, items, now),
      total,
      page: pagination.page,
      limit: pagination.limit,
    };
  }

  private async presentParticipants<
    T extends {
      participantCpfEncrypted: string | null;
      payments: { id: string; status: string }[];
      priceInCents: number;
      status: string;
      reservationExpiresAt: Date;
    },
  >(db: Prisma.TransactionClient, items: T[], now: Date) {
    const disputed = await this.disputedPayments(db, items);
    return items.map(({ participantCpfEncrypted, payments, ...item }) => ({
      ...item,
      cpf: participantCpfEncrypted
        ? decryptCredential(participantCpfEncrypted)
        : null,
      ...participantFinancial(
        item.priceInCents,
        payments,
        payments.some((payment) => disputed.has(payment.id)),
      ),
      status:
        item.status === 'reserved' && item.reservationExpiresAt <= now
          ? 'expired'
          : item.status,
    }));
  }

  private async disputedPayments(
    db: Prisma.TransactionClient,
    items: { payments: { id: string }[] }[],
  ) {
    const ids = items.flatMap((item) =>
      item.payments.map((payment) => payment.id),
    );
    if (!ids.length) return new Set<string>();
    const history = await db.auditLog.findMany({
      where: {
        entityType: 'payment',
        entityId: { in: ids },
        action: 'payment.updated',
        OR: [
          { metadata: { path: ['status'], equals: 'in_mediation' } },
          { metadata: { path: ['status'], equals: 'charged_back' } },
        ],
      },
      select: { entityId: true },
      distinct: ['entityId'],
    });
    return new Set(history.map((entry) => entry.entityId));
  }

  async exportParticipants(
    eventId: string,
    actor: AuthenticatedUser,
    pagination: RegistrationPaginationDto,
  ) {
    const now = new Date();
    const where = this.participantFilters(eventId, pagination, now);
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        const event = await this.eventAccess(eventId, actor, tx);
        const total = await tx.registration.count({ where });
        if (total > 50000)
          throw new BadRequestException(
            'A exportação suporta até 50.000 participantes. Filtre por tipo de inscrição ou situação.',
          );
        const presentParticipants = this.presentParticipants.bind(this);
        async function* rows() {
          let cursor: string | undefined;
          for (let fetched = 0; fetched < total;) {
            const batch = await tx.registration.findMany({
              where,
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
              take: Math.min(500, total - fetched),
              select: {
                id: true,
                name: true,
                email: true,
                participantCpfEncrypted: true,
                registrationTypeName: true,
                status: true,
                reservationExpiresAt: true,
                priceInCents: true,
                payments: participantSelect.payments,
              },
            });
            if (!batch.length)
              throw new Error('Snapshot de participantes incompleto.');
            for (const row of await presentParticipants(tx, batch, now))
              yield row;
            fetched += batch.length;
            cursor = batch[batch.length - 1].id;
          }
        }
        return createParticipantsWorkbook(event.title, rows());
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 120_000,
      },
    );
  }

  async suspend(id: string, suspended: boolean, actor: AuthenticatedUser) {
    const registration = await this.prisma.registration.findUnique({
      where: { id },
    });
    if (!registration) throw new NotFoundException('Inscrição não encontrada.');
    await this.eventAccess(registration.eventId, actor);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "academic_events" WHERE "id" = ${registration.eventId}::uuid FOR UPDATE`;
      await tx.registration.update({
        where: { id },
        data: { suspendedAt: suspended ? new Date() : null },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          entityType: 'registration',
          entityId: id,
          action: suspended ? 'registration.suspended' : 'registration.resumed',
          metadata: { eventId: registration.eventId },
        },
      });
    });
    return { id, suspended };
  }
}
