import {
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { Prisma } from '../src/generated/prisma/client.js';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma.service.js';
import { RegistrationsModule } from '../src/modules/registrations/registrations.module.js';
import { RegistrationsService } from '../src/modules/registrations/registrations.service.js';
import { AdminService } from '../src/modules/admin/admin.service.js';

describe('Reservas de vagas e controle de inscrições no PostgreSQL', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: RegistrationsService;
  const owners: string[] = [];
  const events: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [RegistrationsModule],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    service = moduleRef.get(RegistrationsService);
  });

  afterEach(async () => {
    const registrations = await prisma.registration.findMany({
      where: { eventId: { in: events } },
      select: { id: true },
    });
    const ids = registrations.map(({ id }) => id);
    await prisma.paymentAttempt.deleteMany({
      where: { registrationId: { in: ids } },
    });
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { entityId: { in: [...events, ...ids, ...owners] } },
          { actorId: { in: owners } },
        ],
      },
    });
    await prisma.registration.deleteMany({
      where: { eventId: { in: events } },
    });
    await prisma.paymentAccount.deleteMany({
      where: { ownerId: { in: owners } },
    });
    await prisma.academicEvent.deleteMany({ where: { id: { in: events } } });
    await prisma.user.deleteMany({ where: { id: { in: owners } } });
    owners.length = 0;
    events.length = 0;
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  async function fixture(capacity = 1, active = true) {
    const ownerId = randomUUID();
    owners.push(ownerId);
    await prisma.user.create({
      data: {
        id: ownerId,
        name: 'Responsável dos testes',
        email: `${ownerId}@ligahub.test`,
        role: 'admin',
        active,
        passwordHash: 'hash-ficticio-teste',
      },
    });
    await prisma.paymentAccount.create({
      data: {
        ownerId,
        merchantId: `teste-${ownerId}`,
        publicKey: 'TEST-chave-publica',
        accessTokenEncrypted: 'credencial-ficticia-sem-chamadas-externas',
      },
    });
    const id = randomUUID();
    events.push(id);
    const event = await prisma.academicEvent.create({
      data: {
        id,
        ownerId,
        title: 'Evento de integração',
        capacity,
        priceInCents: 2500,
        status: 'published',
        startsAt: new Date(Date.now() + 86_400_000),
        registrationDeadline: new Date(Date.now() + 3_600_000),
      },
    });
    return { event, ownerId };
  }

  const input = (email = `${randomUUID()}@ligahub.test`) => ({
    cpf: '12345678909',
    name: 'Participante de teste',
    email,
    answers: {},
  });

  it('exporta o snapshot completo mesmo com inserção, exclusão e pagamento concorrentes entre lotes', async () => {
    const { event, ownerId } = await fixture(1000);
    const baseTime = Date.now() - 10_000;
    const original = Array.from({ length: 502 }, (_, index) => ({
      id: randomUUID(),
      eventId: event.id,
      name: `Snapshot ${index}`,
      email: `snapshot-${index}@ligahub.test`,
      answers: {},
      formSnapshot: [],
      priceInCents: 2500,
      status: 'confirmed',
      manageTokenHash: 'teste',
      participantCpfEncrypted: null,
      reservationExpiresAt: new Date(Date.now() + 60000),
      createdAt: new Date(baseTime + index),
    }));
    await prisma.registration.createMany({ data: original });
    const account = await prisma.paymentAccount.findFirstOrThrow({
      where: { ownerId },
    });
    const approved = await prisma.paymentAttempt.create({
      data: {
        registrationId: original[1].id,
        accountId: account.id,
        idempotencyKey: randomUUID(),
        requestHash: 'teste',
        method: 'pix',
        installments: 1,
        amountInCents: 2500,
        status: 'approved',
        createdAt: new Date(baseTime),
      },
    });
    await prisma.paymentAttempt.create({
      data: {
        registrationId: original[1].id,
        accountId: account.id,
        idempotencyKey: randomUUID(),
        requestHash: 'teste',
        method: 'pix',
        installments: 1,
        amountInCents: 2500,
        status: 'rejected',
        createdAt: new Date(baseTime + 1000),
      },
    });
    let batches = 0;
    const scoped = new Proxy(prisma, {
      get(target, property) {
        if (property === '$transaction')
          return (
            work: (tx: Prisma.TransactionClient) => Promise<Buffer>,
            options: {
              isolationLevel: Prisma.TransactionIsolationLevel;
              timeout: number;
            },
          ) =>
            target.$transaction(async (tx) => {
              const reader = new Proxy(tx, {
                get(transaction, key) {
                  if (key === 'registration')
                    return new Proxy(transaction.registration, {
                      get(model, operation) {
                        if (operation === 'findMany')
                          return async (
                            args: Prisma.RegistrationFindManyArgs,
                          ) => {
                            const rows = await model.findMany(args);
                            if (++batches === 1) {
                              // A separate connection commits while the export transaction is open.
                              await prisma.registration.create({
                                data: {
                                  ...original[0],
                                  id: randomUUID(),
                                  email: 'new@ligahub.test',
                                  name: 'Concorrente',
                                  createdAt: new Date(),
                                },
                              });
                              await prisma.registration.delete({
                                where: { id: original[0].id },
                              });
                              await prisma.paymentAttempt.update({
                                where: { id: approved.id },
                                data: { status: 'refunded' },
                              });
                              await prisma.registration.update({
                                where: { id: original[1].id },
                                data: { name: 'Alterado', status: 'canceled' },
                              });
                            }
                            return rows;
                          };
                        const value: unknown = Reflect.get(model, operation);
                        return typeof value === 'function'
                          ? value.bind(model)
                          : value;
                      },
                    });
                  const value: unknown = Reflect.get(transaction, key);
                  return typeof value === 'function'
                    ? value.bind(transaction)
                    : value;
                },
              });
              return work(reader);
            }, options);
        const value: unknown = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const file = await new RegistrationsService(scoped).exportParticipants(
      event.id,
      {
        id: ownerId,
        role: 'organizer',
        name: 'Teste',
        email: 'owner@ligahub.test',
      },
      { page: 4, limit: 20, status: 'confirmed', search: 'Snapshot' },
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file as unknown as ExcelJS.Buffer);
    const sheet = workbook.getWorksheet(1)!;
    expect(batches).toBe(2);
    expect(sheet.rowCount).toBe(503);
    const names = new Set<string>();
    sheet.eachRow((row, index) => {
      if (index > 1) names.add(row.getCell(3).text);
    });
    expect(names.size).toBe(502);
    expect(names).toEqual(new Set(original.map((row) => row.name)));
    expect(sheet.getCell('F502').value).toBe('Confirmada');
    expect(sheet.getCell('G502').value).toBe('Aprovado');
    expect(sheet.getCell('I502').value).toBe('Recusado');
  }, 30_000);

  it('conta e lista somente solicitações abertas, preservando histórico e propriedade', async () => {
    const { event, ownerId } = await fixture(2);
    const other = await fixture();
    const actor = {
      id: ownerId,
      name: 'Organizador',
      email: `${ownerId}@ligahub.test`,
      role: 'organizer' as const,
    };
    const outsider = { ...actor, id: other.ownerId };
    const admin = { ...actor, role: 'admin' as const };
    const dashboard = new AdminService(prisma);
    const baseline = (await dashboard.dashboard(admin)).cancellationRequests;
    const open = await service.reserve(event.publicId, input());
    const resolved = await service.reserve(event.publicId, input());
    for (const registration of [open, resolved]) {
      await prisma.registration.update({
        where: { id: registration.id },
        data: { status: 'confirmed' },
      });
      await service.requestCancellation(
        registration.id,
        registration.manageToken,
      );
    }
    expect((await dashboard.dashboard(actor)).cancellationRequests).toBe(2);
    const history = await prisma.registration.findUniqueOrThrow({
      where: { id: resolved.id },
    });
    // Estado persistido após reembolso, sem chamar provedor externo.
    await prisma.registration.update({
      where: { id: resolved.id },
      data: { status: 'canceled' },
    });
    expect((await dashboard.dashboard(actor)).cancellationRequests).toBe(1);
    expect((await dashboard.dashboard(outsider)).cancellationRequests).toBe(0);
    expect((await dashboard.dashboard(admin)).cancellationRequests).toBe(
      baseline + 1,
    );
    const filter = { page: 1, limit: 1, status: 'cancellation' as const };
    for (const allowed of [actor, admin]) {
      const first = await service.list(event.id, allowed, filter);
      expect(first).toMatchObject({ total: 1, page: 1, limit: 1 });
      expect(first.items.map(({ id }) => id)).toEqual([open.id]);
      const second = await service.list(event.id, allowed, {
        ...filter,
        page: 2,
      });
      expect(second.total).toBe(1);
      expect(second.items).toEqual([]);
    }
    await expect(
      service.list(event.id, outsider, filter),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const canceled = await service.list(event.id, actor, {
      ...filter,
      status: 'canceled',
    });
    expect(canceled.items).toHaveLength(1);
    expect(canceled.items[0]).toMatchObject({
      id: resolved.id,
      cancellationRequestedAt: history.cancellationRequestedAt,
    });
    const unfiltered = await service.list(event.id, actor, {
      page: 1,
      limit: 20,
    });
    expect(unfiltered.total).toBe(2);
    expect(
      await prisma.auditLog.count({
        where: { entityId: resolved.id, action: 'cancellation.requested' },
      }),
    ).toBe(1);
  });

  it('persiste a abertura, bloqueia reserva antecipada e libera após a abertura', async () => {
    const { event } = await fixture();
    const opening = new Date(Date.now() + 60_000);
    await prisma.academicEvent.update({
      where: { id: event.id },
      data: { registrationStartsAt: opening },
    });
    expect(
      (
        await prisma.academicEvent.findUniqueOrThrow({
          where: { id: event.id },
        })
      ).registrationStartsAt,
    ).toEqual(opening);
    await expect(service.reserve(event.publicId, input())).rejects.toThrow(
      'ainda não começaram',
    );
    expect(
      await prisma.registration.count({ where: { eventId: event.id } }),
    ).toBe(0);
    await prisma.academicEvent.update({
      where: { id: event.id },
      data: { registrationStartsAt: new Date(Date.now() - 1000) },
    });
    expect((await service.reserve(event.publicId, input())).status).toBe(
      'reserved',
    );
  });

  it('deve reservar a última vaga para apenas uma de duas solicitações simultâneas', async () => {
    const { event } = await fixture();
    const results = await Promise.allSettled([
      service.reserve(event.publicId, input()),
      service.reserve(event.publicId, input()),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const failures = results.filter((result) => result.status === 'rejected');
    expect(failures).toHaveLength(1);
    expect(failures[0].reason).toBeInstanceOf(ConflictException);
    expect(
      await prisma.registration.count({
        where: { eventId: event.id, status: 'reserved' },
      }),
    ).toBe(1);
  });

  it('deve impedir inscrições duplicadas pelo e-mail normalizado', async () => {
    const { event } = await fixture(2);
    const email = `participante-${randomUUID()}@ligahub.test`;
    await service.reserve(event.publicId, input(`  ${email.toUpperCase()}  `));
    await expect(service.reserve(event.publicId, input(email))).rejects.toThrow(
      'Você já possui uma inscrição',
    );
    expect(
      await prisma.registration.count({ where: { eventId: event.id, email } }),
    ).toBe(1);
  });

  it('deve liberar uma vaga cuja reserva já expirou', async () => {
    const { event } = await fixture();
    const first = await service.reserve(event.publicId, input());
    await prisma.registration.update({
      where: { id: first.id },
      data: { reservationExpiresAt: new Date(Date.now() - 1000) },
    });
    const next = await service.reserve(event.publicId, input());
    expect(next.status).toBe('reserved');
    expect(
      (await prisma.registration.findUniqueOrThrow({ where: { id: first.id } }))
        .status,
    ).toBe('expired');
    expect(
      await prisma.registration.count({
        where: { eventId: event.id, status: 'reserved' },
      }),
    ).toBe(1);
  });

  it('não deve gravar inscrição nem auditoria quando uma resposta obrigatória for inválida', async () => {
    const { event } = await fixture();
    await prisma.academicEvent.update({
      where: { id: event.id },
      data: {
        form: [
          {
            id: 'instituicao',
            label: 'Instituição',
            type: 'text',
            required: true,
          },
        ],
      },
    });
    await expect(service.reserve(event.publicId, input())).rejects.toThrow(
      'O campo Instituição é obrigatório.',
    );
    expect(
      await prisma.registration.count({ where: { eventId: event.id } }),
    ).toBe(0);
    expect(await prisma.auditLog.count({ where: { entityId: event.id } })).toBe(
      0,
    );
  });

  it('deve rejeitar um token incorreto sem revelar dados da inscrição', async () => {
    const { event } = await fixture();
    const reserved = await service.reserve(event.publicId, input());
    await expect(
      service.participantDetails(reserved.id, 'x'.repeat(43)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    const details = await service.participantDetails(
      reserved.id,
      reserved.manageToken,
    );
    expect(details.id).toBe(reserved.id);
    expect(details).not.toHaveProperty('manageTokenHash');
  });

  it('deve rejeitar uma reserva quando o responsável estiver inativo', async () => {
    const { event } = await fixture(1, false);
    await expect(service.reserve(event.publicId, input())).rejects.toThrow(
      'O organizador deste evento está indisponível.',
    );
    expect(
      await prisma.registration.count({ where: { eventId: event.id } }),
    ).toBe(0);
  });

  it('deve conservar a vaga de uma inscrição confirmada quando ela for suspensa', async () => {
    const { event, ownerId } = await fixture();
    const reserved = await service.reserve(event.publicId, input());
    await prisma.registration.update({
      where: { id: reserved.id },
      data: { status: 'confirmed' },
    });
    await service.suspend(reserved.id, true, {
      id: ownerId,
      name: 'Responsável dos testes',
      email: `${ownerId}@ligahub.test`,
      role: 'admin',
    });
    const suspended = await prisma.registration.findUniqueOrThrow({
      where: { id: reserved.id },
    });
    expect(suspended.status).toBe('confirmed');
    expect(suspended.suspendedAt).not.toBeNull();
    await expect(
      service.reserve(event.publicId, input()),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(
      await prisma.registration.count({ where: { eventId: event.id } }),
    ).toBe(1);
  });
});
