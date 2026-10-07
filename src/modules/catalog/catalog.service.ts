import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma.service.js';
import type { AcademicEvent, Prisma } from '../../generated/prisma/client.js';
import type { AuthenticatedUser } from '../auth/auth.decorators.js';
import type {
  CreateEventDto,
  EventPaginationDto,
  UpdateEventDto,
} from './catalog.dto.js';
import { validateForm } from './forms.js';

export function assertOwnership(
  event: { ownerId: string | null },
  actor: AuthenticatedUser,
): void {
  if (actor.role !== 'admin' && event.ownerId !== actor.id)
    throw new ForbiddenException(
      'Você não tem permissão para gerenciar este evento.',
    );
}

export function validateEventDates(event: {
  startsAt: Date | null;
  endsAt: Date | null;
  registrationDeadline: Date | null;
}): void {
  if (event.endsAt && (!event.startsAt || event.endsAt <= event.startsAt))
    throw new BadRequestException(
      'A data final deve ser posterior à data inicial.',
    );
  if (
    event.registrationDeadline &&
    (!event.startsAt || event.registrationDeadline > event.startsAt)
  )
    throw new BadRequestException(
      'O prazo de inscrição deve ser anterior ou igual ao início do evento.',
    );
}

@Injectable()
export class CatalogService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private validateInput(input: UpdateEventDto) {
    for (const field of [
      'title',
      'priceInCents',
      'capacity',
      'ownerId',
      'reservationMinutes',
      'form',
    ] as const) {
      if (input[field] === null)
        throw new BadRequestException(`O campo ${field} não pode ser nulo.`);
    }
  }

  private async owner(
    ownerId: string | undefined,
    actor: AuthenticatedUser,
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    if (actor.role !== 'admin' && ownerId && ownerId !== actor.id)
      throw new ForbiddenException(
        'Você não pode atribuir um evento a outro responsável.',
      );
    const id = actor.role === 'admin' ? ownerId : actor.id;
    if (!id)
      throw new BadRequestException(
        'Informe o organizador responsável pelo evento.',
      );
    const owner = await tx.user.findUnique({ where: { id } });
    if (!owner || !owner.active || owner.role !== 'organizer')
      throw new BadRequestException(
        'O responsável deve ser um organizador ativo.',
      );
    return id;
  }

  async create(input: CreateEventDto, actor: AuthenticatedUser) {
    this.validateInput(input);
    const dates = {
      startsAt: input.startsAt ? new Date(input.startsAt) : null,
      endsAt: input.endsAt ? new Date(input.endsAt) : null,
      registrationDeadline: input.registrationDeadline
        ? new Date(input.registrationDeadline)
        : null,
    };
    validateEventDates(dates);
    const title = input.title.trim();
    if (!title)
      throw new BadRequestException('O título do evento é obrigatório.');
    const form = validateForm(input.form ?? []);
    return this.prisma.$transaction(async (tx) => {
      const ownerId = await this.owner(input.ownerId, actor, tx);
      const event = await tx.academicEvent.create({
        data: {
          id: randomUUID(),
          title,
          priceInCents: input.priceInCents,
          capacity: input.capacity,
          ownerId,
          description: input.description ?? '',
          location: input.location ?? '',
          ...dates,
          reservationMinutes: input.reservationMinutes ?? 15,
          form,
        },
      });
      await this.audit(tx, actor, event.id, 'created', {});
      return event;
    });
  }

  async list(query: EventPaginationDto, actor: AuthenticatedUser) {
    const where = actor.role === 'admin' ? {} : { ownerId: actor.id };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.academicEvent.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.academicEvent.count({ where }),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  }

  async get(id: string, actor: AuthenticatedUser) {
    const event = await this.prisma.academicEvent.findUnique({ where: { id } });
    if (!event) throw new NotFoundException('O evento não foi encontrado.');
    assertOwnership(event, actor);
    return event;
  }

  async update(id: string, input: UpdateEventDto, actor: AuthenticatedUser) {
    this.validateInput(input);
    return this.prisma.$transaction(async (tx) => {
      const event = await this.lock(tx, id, actor);
      const registrations = await tx.registration.count({
        where: { eventId: id },
      });
      if (
        registrations &&
        input.form !== undefined &&
        JSON.stringify(validateForm(input.form)) !== JSON.stringify(event.form)
      )
        throw new ConflictException(
          'O formulário não pode ser alterado após a primeira inscrição.',
        );
      if (
        registrations &&
        input.priceInCents !== undefined &&
        input.priceInCents !== event.priceInCents
      )
        throw new ConflictException(
          'O preço não pode ser alterado após a primeira inscrição.',
        );
      const occupied = await tx.registration.count({
        where: {
          eventId: id,
          OR: [
            { status: 'confirmed' },
            { status: 'reserved', reservationExpiresAt: { gt: new Date() } },
          ],
        },
      });
      if (input.capacity !== undefined && input.capacity < occupied)
        throw new ConflictException(
          'A capacidade não pode ser inferior às vagas confirmadas e reservadas.',
        );
      const dates = {
        startsAt:
          input.startsAt !== undefined
            ? input.startsAt
              ? new Date(input.startsAt)
              : null
            : event.startsAt,
        endsAt:
          input.endsAt !== undefined
            ? input.endsAt
              ? new Date(input.endsAt)
              : null
            : event.endsAt,
        registrationDeadline:
          input.registrationDeadline !== undefined
            ? input.registrationDeadline
              ? new Date(input.registrationDeadline)
              : null
            : event.registrationDeadline,
      };
      validateEventDates(dates);
      if (
        event.status === 'published' &&
        (!dates.startsAt || dates.startsAt <= new Date())
      )
        throw new BadRequestException(
          'Um evento publicado precisa de início futuro.',
        );
      const data: Prisma.AcademicEventUpdateInput = { ...dates };
      if (input.title !== undefined) {
        if (!input.title?.trim())
          throw new BadRequestException('O título do evento é obrigatório.');
        data.title = input.title.trim();
      }
      if (input.description !== undefined)
        data.description = input.description ?? '';
      if (input.location !== undefined) data.location = input.location ?? '';
      if (input.priceInCents !== undefined)
        data.priceInCents = input.priceInCents;
      if (input.capacity !== undefined) data.capacity = input.capacity;
      if (input.reservationMinutes !== undefined)
        data.reservationMinutes = input.reservationMinutes;
      if (input.form !== undefined) data.form = validateForm(input.form);
      if (input.ownerId !== undefined && input.ownerId !== event.ownerId) {
        if (registrations)
          throw new ConflictException(
            'O responsável não pode mudar após a primeira inscrição.',
          );
        data.owner = {
          connect: { id: await this.owner(input.ownerId, actor, tx) },
        };
      }
      const updated = await tx.academicEvent.update({ where: { id }, data });
      await this.audit(tx, actor, id, 'updated', {
        fields: Object.keys(input),
      });
      return updated;
    });
  }

  async transition(
    id: string,
    status: 'published' | 'suspended' | 'closed',
    actor: AuthenticatedUser,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const event = await this.lock(tx, id, actor);
      if (event.status === 'closed')
        throw new ConflictException(
          'O evento encerrado não pode mudar de estado.',
        );
      if (status === 'published') {
        if (!event.startsAt || event.startsAt <= new Date())
          throw new BadRequestException(
            'Informe uma data inicial futura para publicar o evento.',
          );
        if (
          event.registrationDeadline &&
          event.registrationDeadline <= new Date()
        )
          throw new BadRequestException('O prazo de inscrição já terminou.');
        validateEventDates(event);
        validateForm(event.form);
        if (
          !event.ownerId ||
          !(await tx.user.findFirst({
            where: { id: event.ownerId, active: true, role: 'organizer' },
          }))
        )
          throw new BadRequestException(
            'O evento deve possuir um organizador ativo.',
          );
      }
      if (status === 'suspended' && event.status === 'draft')
        throw new ConflictException(
          'Publique o evento antes de suspender inscrições.',
        );
      const updated = await tx.academicEvent.update({
        where: { id },
        data: { status },
      });
      await this.audit(tx, actor, id, status, {});
      return updated;
    });
  }

  async publicEvent(publicId: string) {
    const event = await this.prisma.academicEvent.findUnique({
      where: { publicId },
      include: { owner: { select: { active: true } } },
    });
    if (!event || event.status === 'draft')
      throw new NotFoundException('O evento não foi encontrado.');
    const now = new Date();
    const occupied = await this.prisma.registration.count({
      where: {
        eventId: event.id,
        OR: [
          { status: 'confirmed' },
          { status: 'reserved', reservationExpiresAt: { gt: now } },
        ],
      },
    });
    const publicKey = event.ownerId
      ? (
          await this.prisma.paymentAccount.findFirst({
            where: { ownerId: event.ownerId, active: true },
            orderBy: { createdAt: 'desc' },
            select: { publicKey: true },
          })
        )?.publicKey
      : undefined;
    const availableSpots = Math.max(0, event.capacity - occupied);
    const acceptingRegistrations =
      event.status === 'published' &&
      event.owner?.active === true &&
      Boolean(event.startsAt && event.startsAt > now) &&
      (!event.registrationDeadline || event.registrationDeadline > now) &&
      availableSpots > 0 &&
      Boolean(publicKey);
    return {
      publicId: event.publicId,
      title: event.title,
      description: event.description,
      location: event.location,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      registrationDeadline: event.registrationDeadline,
      priceInCents: event.priceInCents,
      status: event.status,
      form: event.form,
      reservationMinutes: event.reservationMinutes,
      availableSpots,
      acceptingRegistrations,
      publicKey: publicKey ?? null,
    };
  }

  private async lock(
    tx: Prisma.TransactionClient,
    id: string,
    actor: AuthenticatedUser,
  ): Promise<AcademicEvent> {
    await tx.$queryRaw`SELECT id FROM academic_events WHERE id = ${id}::uuid FOR UPDATE`;
    const event = await tx.academicEvent.findUnique({ where: { id } });
    if (!event) throw new NotFoundException('O evento não foi encontrado.');
    assertOwnership(event, actor);
    return event;
  }

  private async audit(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    id: string,
    action: string,
    metadata: Prisma.InputJsonObject,
  ) {
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        entityType: 'event',
        entityId: id,
        action,
        metadata,
      },
    });
  }
}
