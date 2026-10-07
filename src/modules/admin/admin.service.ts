import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma.service.js';
import { Prisma, type AuditLog } from '../../generated/prisma/client.js';
import type { AuthenticatedUser } from '../auth/auth.decorators.js';
import type { PaginationDto } from '../../common/pagination.js';

@Injectable()
export class AdminService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

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

  async audit(query: PaginationDto) {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.auditLog.count(),
    ]);
    return { items, total, page: query.page, limit: query.limit };
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
