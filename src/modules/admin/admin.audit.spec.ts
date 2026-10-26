import { randomUUID } from 'node:crypto';
import { AdminService } from './admin.service.js';
import { auditDetails } from './audit-details.js';
import type { PrismaService } from '../../prisma.service.js';

describe('Detalhes da auditoria administrativa', () => {
  it('limita os metadados aos campos conhecidos e não devolve credenciais', () => {
    expect(
      auditDetails({
        active: false,
        previousActive: true,
        amountInCents: 2500,
        accessToken: 'credencial-simulada',
        passwordHash: 'hash-simulado',
        fields: ['title', 'capacity', 'passwordHash'],
        status: { internal: 'dado inesperado' },
      }),
    ).toEqual({
      active: false,
      previousActive: true,
      amountInCents: 2500,
      fields: ['title', 'capacity'],
    });
    expect(auditDetails(null)).toEqual({});
    expect(auditDetails([])).toEqual({});
  });

  it('inclui responsável e contexto por consultas em lote, mantendo filtro e paginação', async () => {
    const actorId = randomUUID();
    const registrationId = randomUUID();
    const item = {
      id: randomUUID(),
      actorId,
      entityType: 'registration',
      entityId: registrationId,
      action: 'registration.suspended',
      metadata: {},
      createdAt: new Date(),
    };
    const prisma = {
      $transaction: (queries: Promise<unknown>[]) => Promise.all(queries),
      auditLog: {
        findMany: vi.fn().mockResolvedValue([item]),
        count: vi.fn().mockResolvedValue(21),
      },
      user: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            {
              id: actorId,
              name: 'Ana Administradora',
              email: 'ana@ligahub.test',
              role: 'admin',
            },
          ]),
      },
      academicEvent: { findMany: vi.fn().mockResolvedValue([]) },
      registration: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            {
              id: registrationId,
              name: 'Pedro Participante',
              event: { title: 'Jornada acadêmica' },
            },
          ]),
      },
      paymentAttempt: { findMany: vi.fn().mockResolvedValue([]) },
      paymentAccount: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const service = new AdminService(prisma as unknown as PrismaService);
    const result = await service.audit({
      page: 2,
      limit: 20,
      entityType: 'registration',
    });
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
      where: { entityType: 'registration' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: 20,
      take: 20,
    });
    expect(prisma.auditLog.count).toHaveBeenCalledWith({
      where: { entityType: 'registration' },
    });
    expect(result.items[0]).toMatchObject({
      actor: { name: 'Ana Administradora', role: 'admin' },
      subject: { name: 'Pedro Participante', eventTitle: 'Jornada acadêmica' },
    });
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { id: { in: [actorId] } },
      select: { id: true, name: true, email: true, role: true },
    });
    expect(result).toMatchObject({ total: 21, page: 2, limit: 20 });
  });

  it('preserva registros antigos sem responsável ou objeto correspondente', async () => {
    const prisma = {
      $transaction: (queries: Promise<unknown>[]) => Promise.all(queries),
      auditLog: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: randomUUID(),
            actorId: null,
            entityType: 'legacy',
            entityId: 'identificador-antigo',
            action: 'acao.antiga',
            metadata: null,
            createdAt: new Date(),
          },
        ]),
        count: vi.fn().mockResolvedValue(1),
      },
      user: { findMany: vi.fn().mockResolvedValue([]) },
      academicEvent: { findMany: vi.fn().mockResolvedValue([]) },
      registration: { findMany: vi.fn().mockResolvedValue([]) },
      paymentAttempt: { findMany: vi.fn().mockResolvedValue([]) },
      paymentAccount: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const result = await new AdminService(
      prisma as unknown as PrismaService,
    ).audit({ page: 1, limit: 20 });
    expect(result.items[0]).toMatchObject({
      actor: null,
      subject: null,
      metadata: {},
      entityId: 'identificador-antigo',
    });
  });
});
