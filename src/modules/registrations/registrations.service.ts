import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
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
import type { PaginationDto } from '../../common/pagination.js';
import { isUniqueConstraint } from '../../common/prisma-errors.js';

export const hashParticipantToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

@Injectable()
export class RegistrationsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async reserve(publicId: string, input: CreateRegistrationDto) {
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
        const now = new Date();
        assertRegistrationOpen(event, now);
        if (!event.owner?.active)
          throw new ConflictException(
            'O organizador deste evento está indisponível.',
          );
        const account = await tx.paymentAccount.findFirst({
          where: { ownerId: event.ownerId!, active: true },
        });
        if (!account)
          throw new ConflictException(
            'O organizador ainda não conectou sua conta de recebimento.',
          );
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
            answers: answers as Prisma.InputJsonObject,
            formSnapshot: event.form as Prisma.InputJsonValue,
            priceInCents: event.priceInCents,
            reservationExpiresAt: expiresAt,
            manageTokenHash: hashParticipantToken(manageToken),
          },
        });
        await tx.auditLog.create({
          data: {
            entityType: 'registration',
            entityId: registration.id,
            action: 'registration.reserved',
            metadata: { eventId: event.id },
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
      if (isUniqueConstraint(error, ['eventId', 'email'], 'registrations_eventId_email_key'))
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
        status: true,
        checkout: true,
        createdAt: true,
      },
    });
    return {
      id: registration.id,
      name: registration.name,
      email: registration.email,
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
        publicId: registration.event.publicId,
        status: registration.event.status,
      },
      payments,
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

  private async eventAccess(eventId: string, actor: AuthenticatedUser) {
    const event = await this.prisma.academicEvent.findUnique({
      where: { id: eventId },
    });
    if (!event) throw new NotFoundException('Evento não encontrado.');
    if (actor.role !== 'admin' && event.ownerId !== actor.id)
      throw new ForbiddenException('Você não tem acesso a este evento.');
    return event;
  }

  async list(
    eventId: string,
    actor: AuthenticatedUser,
    pagination: PaginationDto,
  ) {
    await this.eventAccess(eventId, actor);
    const where = { eventId };
    const [items, total] = await Promise.all([
      this.prisma.registration.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (pagination.page - 1) * pagination.limit,
        take: pagination.limit,
        select: {
          id: true,
          name: true,
          email: true,
          answers: true,
          formSnapshot: true,
          priceInCents: true,
          status: true,
          reservationExpiresAt: true,
          suspendedAt: true,
          cancellationRequestedAt: true,
          createdAt: true,
        },
      }),
      this.prisma.registration.count({ where }),
    ]);
    return { items, total, page: pagination.page, limit: pagination.limit };
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
