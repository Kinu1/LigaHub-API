import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma.service.js';
import { Prisma } from '../src/generated/prisma/client.js';
import { ApiExceptionFilter, validationPipe } from '../src/common/http.js';
import { RegistrationsService } from '../src/modules/registrations/registrations.service.js';
import { decryptCredential } from '../src/modules/payments/payment-security.js';
import { EmailGateway } from '../src/modules/notifications/email.gateway.js';
import { EmailOutboxService } from '../src/modules/notifications/email-outbox.service.js';
import { PaymentGateway } from '../src/modules/payments/payment.gateway.js';

describe('Cortesias manuais — HTTP e concorrência real PostgreSQL', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let service: RegistrationsService;
  let ownerId: string;
  let adminId: string;
  let eventId: string;
  let publicId: string;
  const emailSend = vi
    .fn()
    .mockRejectedValue(new Error('Provedor simulado indisponível'));
  const charge = vi
    .fn()
    .mockRejectedValue(new Error('Nenhuma cobrança permitida'));
  const actor = () => ({
    id: ownerId,
    role: 'organizer' as const,
    name: 'Organizador Teste',
    email: 'owner@ligahub.test',
  });
  const input = (email = `${randomUUID()}@ligahub.test`) => ({
    name: 'Ana Participante',
    email,
    cpf: '52998224725',
    registrationTypeId: 'profissional',
    answers: { curso: 'Medicina' },
  });
  const token = (id: string) =>
    app.get(JwtService).sign(
      { sub: id, version: 0 },
      {
        secret: process.env.JWT_SECRET,
        issuer: 'ligahub-api',
        audience: 'ligahub',
        expiresIn: 900,
      },
    );
  const post = (body = input(), id = ownerId) =>
    request(app.getHttpServer())
      .post(`/events/${eventId}/registrations/manual`)
      .set('Authorization', `Bearer ${token(id)}`)
      .send(body);

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailGateway)
      .useValue({ send: emailSend })
      .overrideProvider(PaymentGateway)
      .useValue({ createPayment: charge })
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(validationPipe());
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    service = app.get(RegistrationsService);
  });
  beforeEach(async () => {
    vi.clearAllMocks();
    ownerId = randomUUID();
    adminId = randomUUID();
    eventId = randomUUID();
    await prisma.user.createMany({
      data: [
        {
          id: ownerId,
          name: 'Owner Teste',
          email: `${ownerId}@ligahub.test`,
          role: 'organizer',
          passwordHash: 'ficticio',
        },
        {
          id: adminId,
          name: 'Admin Teste',
          email: `${adminId}@ligahub.test`,
          role: 'admin',
          passwordHash: 'ficticio',
        },
      ],
    });
    const event = await prisma.academicEvent.create({
      data: {
        id: eventId,
        ownerId,
        title: 'Cortesia Integração',
        status: 'published',
        priceInCents: 5000,
        capacity: 10,
        startsAt: new Date(Date.now() + 86400000),
        registrationDeadline: new Date(Date.now() + 3600000),
        registrationTypes: [
          {
            id: 'profissional',
            name: 'Profissional',
            priceInCents: 5000,
            capacity: 5,
          },
        ],
        form: [{ id: 'curso', label: 'Curso', type: 'text', required: true }],
      },
    });
    publicId = event.publicId;
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    const rows = await prisma.registration.findMany({
      where: { eventId },
      select: { id: true },
    });
    const ids = rows.map((row) => row.id);
    await prisma.emailOutbox.deleteMany({
      where: { registrationId: { in: ids } },
    });
    await prisma.registration.deleteMany({ where: { eventId } });
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { actorId: { in: [ownerId, adminId] } },
          { entityId: { in: [eventId, ...ids] } },
        ],
      },
    });
    await prisma.academicEvent.deleteMany({ where: { id: eventId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, adminId] } } });
  });
  afterAll(async () => {
    await app?.close();
  });

  it('confirma categoria paga sem conta de recebimento, registra autor e enfileira sem expor segredos', async () => {
    const result = await post(input('  ANA@LIGAHUB.TEST  '), adminId).expect(
      201,
    );
    expect(result.body).toEqual({
      id: expect.any(String),
      status: 'confirmed',
      origin: 'manual',
      emailDeliveryStatus: 'pending',
    });
    const row = await prisma.registration.findUniqueOrThrow({
      where: { id: result.body.id },
    });
    expect(row).toMatchObject({
      name: 'Ana Participante',
      email: 'ana@ligahub.test',
      priceInCents: 0,
      status: 'confirmed',
      origin: 'manual',
      manualAuthorId: adminId,
      registrationTypeId: 'profissional',
      registrationTypeName: 'Profissional',
      answers: { curso: 'Medicina' },
    });
    expect(row.manualCreatedAt).toBeInstanceOf(Date);
    expect(decryptCredential(row.participantCpfEncrypted!)).toBe('52998224725');
    expect(
      await prisma.auditLog.findFirst({
        where: {
          entityId: row.id,
          actorId: adminId,
          action: 'registration.confirmed_manual',
        },
      }),
    ).toBeTruthy();
    const outbox = await prisma.emailOutbox.findUniqueOrThrow({
      where: { registrationId: row.id },
    });
    expect(outbox.status).toBe('pending');
    const payload = JSON.parse(decryptCredential(outbox.payloadEncrypted!));
    expect(payload.origin).toBe('manual');
    expect(emailSend).not.toHaveBeenCalled();
    expect(charge).not.toHaveBeenCalled();
    expect(
      await prisma.paymentAttempt.count({ where: { registrationId: row.id } }),
    ).toBe(0);
    expect(
      await prisma.pixPayout.count({ where: { registrationId: row.id } }),
    ).toBe(0);
    await request(app.getHttpServer())
      .post(`/public/registrations/${row.id}/payments`)
      .set('x-registration-token', decryptCredential(row.manageTokenEncrypted!))
      .set('idempotency-key', randomUUID())
      .send({ method: 'pix', cpf: '52998224725', installments: 1 })
      .expect(409);
    expect(charge).not.toHaveBeenCalled();
    expect(
      await prisma.paymentAttempt.count({ where: { registrationId: row.id } }),
    ).toBe(0);
    const list = await request(app.getHttpServer())
      .get(`/events/${eventId}/registrations`)
      .set('Authorization', `Bearer ${token(ownerId)}`)
      .expect(200);
    expect(list.body.items[0]).toMatchObject({
      origin: 'manual',
      emailDeliveryStatus: 'pending',
      manualAuthorId: adminId,
    });
    expect(JSON.stringify(list.body)).not.toMatch(/Encrypted|Token|payload/);
    expect(
      await service.participantStatus(row.id, payload.token),
    ).toMatchObject({ origin: 'manual', status: 'confirmed' });
    expect(
      await service.participantDetails(
        row.id,
        decryptCredential(row.manageTokenEncrypted!),
      ),
    ).toMatchObject({
      origin: 'manual',
      registrationTypeName: 'Profissional',
      payments: [],
    });
    const file = await service.exportParticipants(eventId, actor(), {
      page: 1,
      limit: 20,
    });
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(file as unknown as ExcelJS.Buffer);
    expect(book.getWorksheet(1)!.getCell('K2').text).toBe('Cortesia');
    expect(book.getWorksheet(1)!.getCell('B2').text).toBe('Profissional');
  });

  it('recusa não autenticado, organizador de outro evento e ator inativo', async () => {
    await request(app.getHttpServer())
      .post(`/events/${eventId}/registrations/manual`)
      .send(input())
      .expect(401);
    await prisma.academicEvent.update({
      where: { id: eventId },
      data: { ownerId: adminId },
    });
    await post().expect(403);
    await prisma.user.update({
      where: { id: ownerId },
      data: { active: false },
    });
    await post().expect(401);
    expect(await prisma.registration.count({ where: { eventId } })).toBe(0);
  });

  it.each([
    { cpf: '11111111111' },
    { name: 'Ana' },
    { name: '   ' },
    { email: 'invalido' },
    { registrationTypeId: 'inexistente' },
    { answers: {} },
    { answers: { curso: 42 } },
    { cpf: '' },
  ])('valida os dados sem gravar inscrição: %j', async (invalid) => {
    await post({ ...input(), ...invalid } as ReturnType<typeof input>).expect(
      400,
    );
    expect(await prisma.registration.count({ where: { eventId } })).toBe(0);
    expect(emailSend).not.toHaveBeenCalled();
    expect(charge).not.toHaveBeenCalled();
  });

  it.each([
    { startsAt: null },
    { startsAt: new Date(0) },
    { status: 'closed' },
    { endsAt: new Date(0) },
  ])('recusa evento sem início futuro ou encerrado: %j', async (data) => {
    await prisma.academicEvent.update({ where: { id: eventId }, data });
    await post().expect(409);
  });

  it('aceita rascunho depois do prazo público e recusa responsável inativo', async () => {
    await prisma.academicEvent.update({
      where: { id: eventId },
      data: { status: 'draft', registrationDeadline: new Date(0) },
    });
    await post().expect(201);
    await prisma.user.update({
      where: { id: ownerId },
      data: { active: false },
    });
    await post(input(), adminId).expect(409);
  });

  it('serializa duas cortesias pela última vaga da categoria', async () => {
    await prisma.academicEvent.update({
      where: { id: eventId },
      data: {
        registrationTypes: [
          {
            id: 'profissional',
            name: 'Profissional',
            priceInCents: 5000,
            capacity: 1,
          },
        ],
      },
    });
    const results = await Promise.all([post(), post()]);
    expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      201, 409,
    ]);
    expect(
      await prisma.registration.count({
        where: { eventId, status: 'confirmed' },
      }),
    ).toBe(1);
  });

  it('serializa manual e pública pela última vaga geral sem cobrança', async () => {
    await prisma.academicEvent.update({
      where: { id: eventId },
      data: {
        capacity: 1,
        registrationTypes: [
          {
            id: 'profissional',
            name: 'Profissional',
            priceInCents: 0,
            capacity: null,
          },
        ],
      },
    });
    const results = await Promise.allSettled([
      service.createManual(eventId, input(), actor()),
      service.reserve(publicId, input()),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(
      await prisma.registration.count({
        where: { eventId, status: 'confirmed' },
      }),
    ).toBe(1);
    expect(charge).not.toHaveBeenCalled();
  });

  it('duplicatas concorrentes retornam 409 e somente o ID existente, inclusive com capacidade cheia', async () => {
    const body = input('DUPLICADA@ligahub.test');
    const results = await Promise.all([post(body), post(body)]);
    const created = results.find((r) => r.status === 201)!;
    const conflict = results.find((r) => r.status === 409)!;
    expect(created).toBeTruthy();
    expect(conflict).toBeTruthy();
    expect(conflict.body.registrationId).toBe(created.body.id);
    expect(JSON.stringify(conflict.body)).not.toMatch(
      /Token|Encrypted|cpf|answers/,
    );
    expect(
      await prisma.emailOutbox.count({
        where: { registrationId: created.body.id },
      }),
    ).toBe(1);
    await prisma.academicEvent.update({
      where: { id: eventId },
      data: { capacity: 1 },
    });
    expect((await post(body).expect(409)).body.registrationId).toBe(
      created.body.id,
    );
  });

  it('duplicata pública/manual concorrente mantém um único registro e origem pública histórica por padrão', async () => {
    await prisma.academicEvent.update({
      where: { id: eventId },
      data: {
        registrationTypes: [
          { id: 'profissional', name: 'Profissional', priceInCents: 0 },
        ],
      },
    });
    const body = input();
    const results = await Promise.allSettled([
      service.reserve(publicId, body),
      service.createManual(eventId, body, actor()),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.registration.count({ where: { eventId } })).toBe(1);
    const publicRow = await service.reserve(publicId, input());
    expect(
      await prisma.registration.findUnique({
        where: { id: publicRow.id },
        select: { origin: true, manualAuthorId: true, manualCreatedAt: true },
      }),
    ).toEqual({
      origin: 'public',
      manualAuthorId: null,
      manualCreatedAt: null,
    });
  });

  it('conta reservas vigentes, libera expiradas e preserva confirmação quando o envio falha', async () => {
    await prisma.academicEvent.update({
      where: { id: eventId },
      data: { capacity: 1 },
    });
    const reserved = await prisma.registration.create({
      data: {
        eventId,
        name: 'Reserva Teste',
        email: 'reserva@ligahub.test',
        answers: {},
        registrationTypeId: 'profissional',
        registrationTypeName: 'Profissional',
        formSnapshot: [],
        priceInCents: 5000,
        status: 'reserved',
        reservationExpiresAt: new Date(Date.now() + 60000),
        manageTokenHash: 'ficticio',
      },
    });
    await post().expect(409);
    await prisma.registration.update({
      where: { id: reserved.id },
      data: { reservationExpiresAt: new Date(0) },
    });
    const result = await post().expect(201);
    vi.stubEnv('EMAIL_DELIVERY_ENABLED', 'true');
    vi.stubEnv('EMAIL_PROVIDER', 'resend');
    vi.stubEnv('RESEND_API_KEY', 'fake-test-key');
    vi.stubEnv('EMAIL_FROM', 'teste@example.com');
    vi.stubEnv('FRONTEND_URL', 'http://localhost:3101');
    const batch = await app
      .get(EmailOutboxService)
      .processBatch(result.body.id);
    expect(batch.failed).toBe(1);
    expect(emailSend).toHaveBeenCalledTimes(1);
    expect(emailSend.mock.calls[0][0].text).toContain(
      'Sua cortesia foi registrada',
    );
    expect(emailSend.mock.calls[0][0].text).not.toContain(
      'pagamento foi aprovado',
    );
    expect(
      await prisma.registration.findUnique({
        where: { id: result.body.id },
        select: { status: true },
      }),
    ).toEqual({ status: 'confirmed' });
    expect(
      await prisma.emailOutbox.findUnique({
        where: { registrationId: result.body.id },
        select: { status: true },
      }),
    ).toEqual({ status: 'pending' });
    expect(charge).not.toHaveBeenCalled();
  });

  it('falha de persistência da fila reverte a transação inteira, sem inscrição ou auditoria órfã', async () => {
    const broken = new Proxy(prisma, {
      get(target, key) {
        if (key === '$transaction')
          return (work: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
            target.$transaction(async (tx) => {
              const transactional = new Proxy(tx, {
                get(database, property) {
                  if (property === 'emailOutbox')
                    return {
                      findUnique: async () => null,
                      create: async () => {
                        throw new Error('fila indisponível');
                      },
                    };
                  return Reflect.get(database, property);
                },
              });
              return work(transactional);
            });
        return Reflect.get(target, key);
      },
    });
    await expect(
      new RegistrationsService(broken).createManual(eventId, input(), actor()),
    ).rejects.toThrow('fila indisponível');
    expect(await prisma.registration.count({ where: { eventId } })).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: { actorId: ownerId, action: 'registration.confirmed_manual' },
      }),
    ).toBe(0);
  });
});
