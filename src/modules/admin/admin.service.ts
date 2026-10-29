import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma.service.js';
import { Prisma, type AuditLog } from '../../generated/prisma/client.js';
import type { AuthenticatedUser } from '../auth/auth.decorators.js';
import type { PaginationDto } from '../../common/pagination.js';
import type { AuditQueryDto } from './audit-query.dto.js';
import type { OperationsQueryDto } from './operations-query.dto.js';
import { auditDetails } from './audit-details.js';

@Injectable()
export class AdminService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async dashboard(actor: AuthenticatedUser) {
    const event = actor.role === 'admin' ? {} : { ownerId: actor.id };
    const [
      events,
      drafts,
      confirmed,
      cancellationRequests,
      pendingPayments,
      approved,
      account,
    ] = await this.prisma.$transaction([
      this.prisma.academicEvent.count({ where: event }),
      this.prisma.academicEvent.count({ where: { ...event, status: 'draft' } }),
      this.prisma.registration.count({ where: { event, status: 'confirmed' } }),
      this.prisma.registration.count({
        where: {
          event,
          cancellationRequestedAt: { not: null },
          status: { not: 'canceled' },
        },
      }),
      this.prisma.paymentAttempt.count({
        where: {
          registration: { event },
          status: {
            in: [
              'created',
              'pending',
              'in_process',
              'authorized',
              'in_mediation',
            ],
          },
        },
      }),
      this.prisma.paymentAttempt.aggregate({
        where: { registration: { event }, status: 'approved' },
        _sum: { amountInCents: true },
      }),
      this.prisma.paymentAccount.count({
        where: {
          active: true,
          owner:
            actor.role === 'admin'
              ? { role: 'organizer', active: true }
              : { id: actor.id, active: true },
        },
      }),
    ]);
    return {
      events,
      drafts,
      confirmed,
      cancellationRequests,
      pendingPayments,
      approvedBaseAmountInCents: approved._sum.amountInCents ?? 0,
      accountConnected: account > 0,
    };
  }

  async overview() {
    const now = new Date();
    const [
      users,
      events,
      registrations,
      activeReservations,
      payments,
      approved,
    ] = await this.prisma.$transaction([
      this.prisma.user.count(),
      this.prisma.academicEvent.groupBy({ by: ['status'], _count: true }),
      this.prisma.registration.groupBy({ by: ['status'], _count: true }),
      this.prisma.registration.count({
        where: { status: 'reserved', reservationExpiresAt: { gt: now } },
      }),
      this.prisma.paymentAttempt.groupBy({ by: ['status'], _count: true }),
      this.prisma.paymentAttempt.aggregate({
        where: { status: 'approved' },
        _sum: { amountInCents: true },
      }),
    ]);
    return {
      users,
      events,
      registrations,
      activeReservations,
      payments,
      approvedBaseAmountInCents: approved._sum.amountInCents ?? 0,
      generatedAt: now,
    };
  }

  async operations(query: OperationsQueryDto) {
    try {
      const page = query.page || 1;
      const limit = query.limit || 20;
      const now = new Date();

      const flags = {
        backgroundJobsEnabled: process.env.BACKGROUND_JOBS_ENABLED === 'true',
        backgroundTimersEnabled:
          process.env.BACKGROUND_TIMERS_ENABLED !== 'false',
        emailDeliveryEnabled: process.env.EMAIL_DELIVERY_ENABLED === 'true',
        paymentReconciliationEnabled:
          process.env.PAYMENT_RECONCILIATION_ENABLED !== 'false',
      };

      const [
        jobs,
        emailQueueCounts,
        oldestEmailNext,
        accessQueueCounts,
        oldestAccessNext,
        failedPayments,
        failedPaymentsTotal,
      ] = await Promise.all([
        this.prisma.backgroundJob.findMany({
          where: { name: { in: ['emails', 'payments'] } },
        }),
        this.prisma.emailOutbox.groupBy({
          by: ['status'],
          _count: true,
        }),
        this.prisma.emailOutbox.findFirst({
          where: { status: 'pending' },
          orderBy: { nextAttemptAt: 'asc' },
          select: { nextAttemptAt: true },
        }),
        this.prisma.accessEmailOutbox.groupBy({
          by: ['status'],
          _count: true,
        }),
        this.prisma.accessEmailOutbox.findFirst({
          where: { status: 'pending' },
          orderBy: { nextAttemptAt: 'asc' },
          select: { nextAttemptAt: true },
        }),
        this.prisma.paymentAttempt.findMany({
          where: { lastSyncErrorCode: { not: null } },
          skip: (page - 1) * limit,
          take: limit,
          orderBy: [{ lastSyncAttemptAt: 'desc' }, { id: 'desc' }],
          select: {
            id: true,
            registrationId: true,
            method: true,
            amountInCents: true,
            status: true,
            lastSyncAttemptAt: true,
            lastSyncSucceededAt: true,
            lastSyncErrorCode: true,
            createdAt: true,
            updatedAt: true,
            registration: {
              select: {
                event: {
                  select: { id: true, title: true },
                },
              },
            },
          },
        }),
        this.prisma.paymentAttempt.count({
          where: { lastSyncErrorCode: { not: null } },
        }),
      ]);

      const routineMap = new Map(jobs.map((j) => [j.name, j]));
      const routines = (['emails', 'payments'] as const).map((name) => {
        const job = routineMap.get(name);
        const activeLease = Boolean(
          job?.leaseExpiresAt && job.leaseExpiresAt > now,
        );
        const unfinished = Boolean(job?.startedAt && !job.finishedAt);
        return {
          name,
          startedAt: job?.startedAt ?? null,
          finishedAt: job?.finishedAt ?? null,
          lastSucceededAt: job?.lastSucceededAt ?? null,
          lastFailedAt: job?.lastFailedAt ?? null,
          status: unfinished
            ? activeLease
              ? 'running'
              : 'unfinished'
            : (job?.status ?? null),
          errorCode: job?.errorCode ?? null,
          runCount: job?.runCount ?? 0,
          failureCount: job?.failureCount ?? 0,
          processedCount: unfinished ? null : (job?.processedCount ?? 0),
          succeededCount: unfinished ? null : (job?.succeededCount ?? 0),
          failedCount: unfinished ? null : (job?.failedCount ?? 0),
          skippedCount: unfinished ? null : (job?.skippedCount ?? 0),
          activeLease,
          leaseExpiresAt: job?.leaseExpiresAt ?? null,
        };
      });

      const formatQueue = (
        counts: { status: string; _count: number }[],
        oldest: { nextAttemptAt: Date } | null,
      ) => {
        const map = new Map(counts.map((c) => [c.status, c._count]));
        return {
          pending: map.get('pending') ?? 0,
          processing: map.get('processing') ?? 0,
          sent: map.get('sent') ?? 0,
          failed: map.get('failed') ?? 0,
          skipped: map.get('skipped') ?? 0,
          oldestNextAttemptAt: oldest?.nextAttemptAt ?? null,
        };
      };

      const queues = {
        confirmation: formatQueue(emailQueueCounts, oldestEmailNext),
        access: formatQueue(accessQueueCounts, oldestAccessNext),
      };

      const items = failedPayments.map((p) => ({
        id: p.id,
        registrationId: p.registrationId,
        event: p.registration?.event ?? null,
        method: p.method,
        amountInCents: p.amountInCents,
        status: p.status,
        lastSyncAttemptAt: p.lastSyncAttemptAt ?? null,
        lastSyncSucceededAt: p.lastSyncSucceededAt ?? null,
        lastSyncErrorCode: p.lastSyncErrorCode ?? null,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      }));

      return {
        flags,
        routines,
        queues,
        failedPayments: {
          items,
          total: failedPaymentsTotal,
          page,
          limit,
        },
      };
    } catch {
      throw new ServiceUnavailableException(
        'Diagnóstico operacional indisponível.',
      );
    }
  }

  async audit(query: AuditQueryDto) {
    const where = query.entityType ? { entityType: query.entityType } : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return {
      items: await this.describeAudit(items),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  private async describeAudit(items: AuditLog[]) {
    if (!items.length) return [];
    const uuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const ids = (type: string) =>
      items
        .filter((item) => item.entityType === type && uuid.test(item.entityId))
        .map((item) => item.entityId);
    const userIds = [
      ...new Set([
        ...ids('user'),
        ...items.flatMap((item) => (item.actorId ? [item.actorId] : [])),
      ]),
    ];
    const [users, events, registrations, payments, accounts] =
      await Promise.all([
        this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true, role: true },
        }),
        this.prisma.academicEvent.findMany({
          where: { id: { in: ids('event') } },
          select: { id: true, title: true },
        }),
        this.prisma.registration.findMany({
          where: { id: { in: ids('registration') } },
          select: { id: true, name: true, event: { select: { title: true } } },
        }),
        this.prisma.paymentAttempt.findMany({
          where: { id: { in: ids('payment') } },
          select: {
            id: true,
            registration: {
              select: { name: true, event: { select: { title: true } } },
            },
          },
        }),
        this.prisma.paymentAccount.findMany({
          where: { id: { in: ids('payment_account') } },
          select: { id: true, owner: { select: { name: true } } },
        }),
      ]);
    const actors = new Map(users.map((user) => [user.id, user]));
    const subjects = new Map<string, { name: string; eventTitle?: string }>([
      ...users.map((user) => [`user:${user.id}`, { name: user.name }] as const),
      ...events.map(
        (event) => [`event:${event.id}`, { name: event.title }] as const,
      ),
      ...registrations.map(
        (registration) =>
          [
            `registration:${registration.id}`,
            { name: registration.name, eventTitle: registration.event.title },
          ] as const,
      ),
      ...payments.map(
        (payment) =>
          [
            `payment:${payment.id}`,
            {
              name: payment.registration.name,
              eventTitle: payment.registration.event.title,
            },
          ] as const,
      ),
      ...accounts.map(
        (account) =>
          [
            `payment_account:${account.id}`,
            { name: account.owner.name },
          ] as const,
      ),
    ]);
    return items.map((item) => ({
      ...item,
      metadata: auditDetails(item.metadata),
      actor: item.actorId ? (actors.get(item.actorId) ?? null) : null,
      subject: subjects.get(`${item.entityType}:${item.entityId}`) ?? null,
    }));
  }

  async eventHistory(
    eventId: string,
    actor: AuthenticatedUser,
    query: PaginationDto,
  ) {
    const event = await this.prisma.academicEvent.findUnique({
      where: { id: eventId },
    });
    if (!event) throw new NotFoundException('Evento não encontrado.');
    if (actor.role !== 'admin' && event.ownerId !== actor.id)
      throw new ForbiddenException(
        'Você não tem acesso ao histórico deste evento.',
      );
    // Filtragem no banco evita carregar todos os participantes na memória.
    const scope = Prisma.sql`
      (a."entityType" = 'event' AND a."entityId" = ${eventId})
      OR (a."entityType" = 'registration' AND EXISTS (
        SELECT 1 FROM registrations r WHERE r.id::text = a."entityId" AND r."eventId" = ${eventId}::uuid
      ))
      OR (a."entityType" = 'payment' AND EXISTS (
        SELECT 1 FROM payment_attempts p JOIN registrations r ON r.id = p."registrationId"
        WHERE p.id::text = a."entityId" AND r."eventId" = ${eventId}::uuid
      ))`;
    const [items, totals] = await this.prisma.$transaction([
      this.prisma.$queryRaw<AuditLog[]>(
        Prisma.sql`SELECT a.* FROM audit_logs a WHERE ${scope} ORDER BY a."createdAt" DESC, a.id DESC LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
      ),
      this.prisma.$queryRaw<{ total: bigint }[]>(
        Prisma.sql`SELECT count(*) AS total FROM audit_logs a WHERE ${scope}`,
      ),
    ]);
    return {
      items,
      total: Number(totals[0]?.total ?? 0),
      page: query.page,
      limit: query.limit,
    };
  }
}
