import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  platformPixAccountId,
  payoutMode,
} from '../payments/pix-payout.policy.js';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma.service.js';
import type { AcademicEvent, Prisma } from '../../generated/prisma/client.js';
import type { AuthenticatedUser } from '../auth/auth.decorators.js';
import type {
  CreateEventDto,
  EventPaginationDto,
  RegistrationTypeDto,
  UpdateEventDto,
} from './catalog.dto.js';
import { validateForm } from './forms.js';
import { validateEventImage } from './event-images.js';
import {
  MIN_EVENT_PRICE_IN_CENTS,
  MIN_EVENT_PRICE_MESSAGE,
} from '../events/entities/academic-event.entity.js';

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
  registrationStartsAt?: Date | null;
}): void {
  const deadline = event.registrationDeadline ?? event.startsAt;
  if (
    event.registrationStartsAt &&
    (!deadline || event.registrationStartsAt >= deadline)
  )
    throw new BadRequestException(
      'O início das inscrições deve ser anterior ao encerramento das inscrições e ao início do evento.',
    );
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

function validateRegistrationTypes(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20)
    throw new BadRequestException('Adicione de 1 a 20 tipos de inscrição.');
  const ids = new Set<string>();
  return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      throw new BadRequestException('Um tipo de inscrição é inválido.');
    const type = item as Record<string, unknown>;
    if (
      Object.keys(type).some(
        (key) => !['id', 'name', 'priceInCents', 'capacity'].includes(key),
      ) ||
      typeof type.id !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,80}$/.test(type.id) ||
      ids.has(type.id) ||
      typeof type.name !== 'string' ||
      !type.name.trim() ||
      type.name.length > 120 ||
      !Number.isSafeInteger(type.priceInCents) ||
      ((type.priceInCents as number) !== 0 &&
        (type.priceInCents as number) < MIN_EVENT_PRICE_IN_CENTS) ||
      (type.priceInCents as number) > 2147483647 ||
      (type.capacity !== undefined &&
        type.capacity !== null &&
        (!Number.isSafeInteger(type.capacity) ||
          (type.capacity as number) < 1 ||
          (type.capacity as number) > 2147483647))
    )
      throw new BadRequestException(
        'Os dados de um tipo de inscrição são inválidos.',
      );
    ids.add(type.id);
    return {
      id: type.id,
      name: type.name.trim(),
      priceInCents: type.priceInCents as number,
      capacity: (type.capacity as number | null | undefined) ?? null,
    };
  });
}

@Injectable()
export class CatalogService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private validateInput(input: UpdateEventDto) {
    validateEventImage(input.logoImage, 'logo');
    validateEventImage(input.bannerImage, 'banner');
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
    if (
      input.priceInCents !== undefined &&
      input.priceInCents < MIN_EVENT_PRICE_IN_CENTS
    )
      throw new BadRequestException(MIN_EVENT_PRICE_MESSAGE);
    if (input.registrationTypes !== undefined)
      validateRegistrationTypes(input.registrationTypes);
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
      registrationStartsAt: input.registrationStartsAt
        ? new Date(input.registrationStartsAt)
        : null,
      startsAt: input.startsAt ? new Date(input.startsAt) : null,
      endsAt: input.endsAt ? new Date(input.endsAt) : null,
      registrationDeadline: input.registrationDeadline
        ? new Date(input.registrationDeadline)
        : null,
    };
    validateEventDates(dates);
    const registrationTypes = validateRegistrationTypes(
      input.registrationTypes ?? [
        {
          id: 'geral',
          name: 'Inscrição geral',
          priceInCents: input.priceInCents,
        },
      ],
    );
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
          registrationTypes,
          capacity: input.capacity,
          ownerId,
          description: input.description ?? '',
          location: input.location ?? '',
          logoImage: input.logoImage ?? null,
          bannerImage: input.bannerImage ?? null,
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
    const where: Prisma.AcademicEventWhereInput = {
      ...(actor.role === 'admin' ? {} : { ownerId: actor.id }),
      ...(query.search
        ? { title: { contains: query.search.trim(), mode: 'insensitive' } }
        : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.academicEvent.findMany({
        omit: { logoImage: true, bannerImage: true },
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
      if (
        registrations &&
        input.registrationTypes !== undefined &&
        JSON.stringify(validateRegistrationTypes(input.registrationTypes)) !==
          JSON.stringify(event.registrationTypes)
      )
        throw new ConflictException(
          'Os tipos de inscrição não podem ser alterados após a primeira inscrição.',
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
        registrationStartsAt:
          input.registrationStartsAt !== undefined
            ? input.registrationStartsAt
              ? new Date(input.registrationStartsAt)
              : null
            : event.registrationStartsAt,
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
      if (input.logoImage !== undefined) data.logoImage = input.logoImage;
      if (input.bannerImage !== undefined) data.bannerImage = input.bannerImage;
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
      if (input.registrationTypes !== undefined) {
        const types = validateRegistrationTypes(input.registrationTypes);
        data.registrationTypes = types;
        data.priceInCents = Math.max(
          MIN_EVENT_PRICE_IN_CENTS,
          types.find((type) => type.priceInCents > 0)?.priceInCents ?? 0,
        );
      }
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
    const configuredTypes = Array.isArray(event.registrationTypes)
      ? (event.registrationTypes as unknown as RegistrationTypeDto[])
      : [];
    const sourceTypes = configuredTypes.length
      ? configuredTypes
      : [
          {
            id: 'geral',
            name: 'Inscrição geral',
            priceInCents: event.priceInCents,
            capacity: null,
          },
        ];
    const registrationTypes = await Promise.all(
      sourceTypes.map(async (type) => {
        const typeOccupied = await this.prisma.registration.count({
          where: {
            eventId: event.id,
            registrationTypeId: type.id,
            OR: [
              { status: 'confirmed' },
              { status: 'reserved', reservationExpiresAt: { gt: now } },
            ],
          },
        });
        return {
          ...type,
          capacity: type.capacity ?? null,
          availableSpots:
            type.capacity == null
              ? null
              : Math.max(0, type.capacity - typeOccupied),
        };
      }),
    );
    const centralAccountId = platformPixAccountId();
    const centralDestination =
      centralAccountId && event.ownerId
        ? await this.prisma.organizerPixDestination.findUnique({
            where: { ownerId: event.ownerId },
            select: { approvedAt: true },
          })
        : null;
    const publicKey = centralAccountId
      ? centralDestination?.approvedAt
        ? (
            await this.prisma.paymentAccount.findFirst({
              where: {
                id: centralAccountId,
                active: true,
                isTest:
                  (process.env.MERCADO_PAGO_TEST_MODE ?? 'true') === 'true',
              },
              select: { publicKey: true },
            })
          )?.publicKey
        : undefined
      : event.ownerId
        ? (
            await this.prisma.paymentAccount.findFirst({
              where: { ownerId: event.ownerId, active: true },
              orderBy: { createdAt: 'desc' },
              select: { publicKey: true },
            })
          )?.publicKey
        : undefined;
    const availableSpots = Math.max(0, event.capacity - occupied);
    const hasAvailableFreeType = registrationTypes.some(
      (type) =>
        type.priceInCents === 0 &&
        (type.availableSpots === null || type.availableSpots > 0),
    );
    const hasAvailablePaidType = registrationTypes.some(
      (type) =>
        type.priceInCents > 0 &&
        (type.availableSpots === null || type.availableSpots > 0),
    );
    const acceptingRegistrations =
      event.status === 'published' &&
      event.owner?.active === true &&
      Boolean(event.startsAt && event.startsAt > now) &&
      (!event.registrationStartsAt || event.registrationStartsAt <= now) &&
      (!event.registrationDeadline || event.registrationDeadline > now) &&
      availableSpots > 0 &&
      (hasAvailableFreeType || (Boolean(publicKey) && hasAvailablePaidType));
    return {
      publicId: event.publicId,
      title: event.title,
      description: event.description,
      logoImage: event.logoImage,
      bannerImage: event.bannerImage,
      location: event.location,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      registrationDeadline: event.registrationDeadline,
      registrationStartsAt: event.registrationStartsAt,
      priceInCents: event.priceInCents,
      registrationTypes,
      status: event.status,
      form: event.form,
      reservationMinutes: event.reservationMinutes,
      availableSpots,
      acceptingRegistrations,
      publicKey: publicKey ?? null,
      ...(centralAccountId && payoutMode() === 'manual'
        ? { pixFeePolicy: { platformFeeInCents: 100 } }
        : {}),
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
