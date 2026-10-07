import { ForbiddenException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { hash } from 'argon2';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AdminService } from '../src/modules/admin/admin.service.js';
import { PrismaService } from '../src/prisma.service.js';
import { validationPipe } from '../src/common/http.js';

describe('Acesso administrativo e histórico imutável', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let service: AdminService;
  const ownerId = randomUUID();
  const eventId = randomUUID();
  const otherEventId = randomUUID();
  const auditIds: string[] = [];
  let registrationId: string;
  let jwt: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(validationPipe());
    await app.init();
    prisma = module.get(PrismaService);
    service = module.get(AdminService);
    await prisma.user.create({
      data: {
        id: ownerId,
        name: 'Administrador dos testes',
        email: `${ownerId}@ligahub.test`,
        role: 'admin',
        passwordHash: await hash('senha-teste'),
      },
    });
    for (const id of [eventId, otherEventId])
      await prisma.academicEvent.create({
        data: {
          id,
          ownerId,
          title: 'Teste administrativo',
          priceInCents: 2500,
          capacity: 10,
        },
      });
    const registration = await prisma.registration.create({
      data: {
        eventId,
        name: 'Participante',
        email: 'participante@ligahub.test',
        answers: {},
        formSnapshot: [],
        priceInCents: 2500,
        reservationExpiresAt: new Date(Date.now() + 60000),
        manageTokenHash: '0'.repeat(64),
      },
    });
    registrationId = registration.id;
    for (const [entityType, entityId] of [
      ['event', eventId],
      ['registration', registrationId],
      ['event', otherEventId],
    ]) {
      const log = await prisma.auditLog.create({
        data: { entityType, entityId, action: 'teste.criado' },
      });
      auditIds.push(log.id);
    }
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: `${ownerId}@ligahub.test`, password: 'senha-teste' })
      .expect(200);
    jwt = login.body.accessToken;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.auditLog.deleteMany({
        where: { OR: [{ actorId: ownerId }, { id: { in: auditIds } }] },
      });
      await prisma.registration.deleteMany({ where: { eventId } });
      await prisma.academicEvent.deleteMany({
        where: { id: { in: [eventId, otherEventId] } },
      });
      await prisma.user.deleteMany({ where: { id: ownerId } });
    }
    await app?.close();
  });

  it('deve proteger as consultas administrativas sem autenticação', async () => {
    await request(app.getHttpServer()).get('/admin/overview').expect(401);
    await request(app.getHttpServer()).get('/admin/audit').expect(401);
  });

  it('deve entregar indicadores ao administrador sem credenciais privadas', async () => {
    const response = await request(app.getHttpServer())
      .get('/admin/overview')
      .auth(jwt, { type: 'bearer' })
      .expect(200);
    expect(response.body.users).toBeGreaterThan(0);
    expect(response.body.activeReservations).toBeGreaterThan(0);
    expect(response.body.approvedBaseAmountInCents).toBeTypeOf('number');
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
  });

  it('deve filtrar o histórico de inscrições pelo evento com paginação', async () => {
    const response = await request(app.getHttpServer())
      .get(`/events/${eventId}/history?limit=1`)
      .auth(jwt, { type: 'bearer' })
      .expect(200);
    expect(response.body.total).toBe(2);
    expect(response.body.items).toHaveLength(1);
    expect([eventId, registrationId]).toContain(
      response.body.items[0].entityId,
    );
  });

  it('deve impedir que um organizador consulte histórico de outro responsável', async () => {
    await expect(
      service.eventHistory(
        eventId,
        {
          id: randomUUID(),
          role: 'organizer',
          name: 'Outro responsável',
          email: 'outro@ligahub.test',
        },
        { page: 1, limit: 20 },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('deve rejeitar parâmetros inválidos em português e impedir edição do histórico', async () => {
    const invalid = await request(app.getHttpServer())
      .get('/admin/audit?limit=101')
      .auth(jwt, { type: 'bearer' })
      .expect(400);
    expect(invalid.body.message).toBe('Dados inválidos.');
    await request(app.getHttpServer())
      .patch(`/admin/audit/${auditIds[0]}`)
      .auth(jwt, { type: 'bearer' })
      .send({ action: 'alterado' })
      .expect(404);
    expect(
      (await prisma.auditLog.findUniqueOrThrow({ where: { id: auditIds[0] } }))
        .action,
    ).toBe('teste.criado');
  });
});
