import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma.service.js';
import { RegistrationsModule } from '../src/modules/registrations/registrations.module.js';
import { RegistrationsService } from '../src/modules/registrations/registrations.service.js';

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
    name: 'Participante de teste',
    email,
    answers: {},
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
