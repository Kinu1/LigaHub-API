import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { AuthModule } from '../src/modules/auth/auth.module.js';
import { JwtAuthGuard, RolesGuard } from '../src/modules/auth/auth.guards.js';
import { PasswordHasher } from '../src/modules/users/password-hasher.js';
import { UsersService } from '../src/modules/users/users.service.js';
import { PrismaService } from '../src/prisma.service.js';

describe('Autenticação HTTP', () => {
  let app: INestApplication;
  const admin = {
    id: '7610c4b6-ec08-4fce-9335-b2357ca2eaba',
    name: 'Admin',
    email: 'admin@ligahub.test',
    role: 'admin',
    active: true,
    tokenVersion: 0,
    passwordHash: 'hash-admin',
  };
  const organizer = {
    id: '6510c4b6-ec08-4fce-9335-b2357ca2eaba',
    name: 'Organizador',
    email: 'organizer@ligahub.test',
    role: 'organizer',
    active: true,
    tokenVersion: 0,
    passwordHash: 'hash-organizer',
  };
  let accounts: (typeof admin)[];
  let previousSecret: string | undefined;
  beforeEach(async () => {
    previousSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'segredo-exclusivo-dos-testes-http-123456789';
    accounts = [{ ...admin }, { ...organizer }];
    const prisma = {
      user: {
        findUnique: vi.fn(
          async ({ where }: { where: { email?: string; id?: string } }) =>
            accounts.find((account) =>
              where.email
                ? account.email === where.email
                : account.id === where.id,
            ) ?? null,
        ),
        update: vi.fn(async ({ where }: { where: { id: string } }) => {
          const account = accounts.find((item) => item.id === where.id)!;
          account.tokenVersion += 1;
          return account;
        }),
        findMany: vi.fn(async () =>
          accounts.map(({ id, name, email, role, active }) => ({
            id,
            name,
            email,
            role,
            active,
          })),
        ),
      },
    };
    const transactionalPrisma = {
      ...prisma,
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      $transaction: vi.fn(async (operation: (tx: unknown) => unknown) =>
        operation(transactionalPrisma),
      ),
    };
    const module = await Test.createTestingModule({
      imports: [AuthModule],
      providers: [
        { provide: APP_GUARD, useExisting: JwtAuthGuard },
        { provide: APP_GUARD, useExisting: RolesGuard },
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(transactionalPrisma)
      .overrideProvider(PasswordHasher)
      .useValue({
        verify: vi.fn(async (password: string) => password === 'senha-correta'),
        hash: vi.fn().mockResolvedValue('hash-ficticio'),
      })
      .overrideProvider(UsersService)
      .useValue({ create: vi.fn(async () => ({ id: 'novo', name: 'Conta' })) })
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });
  afterEach(async () => {
    await app?.close();
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  });
  async function token(email = admin.email): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'senha-correta' })
      .expect(200);
    return response.body.accessToken as string;
  }
  it('deve autenticar e retornar apenas dados públicos da conta', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: ' ADMIN@ligahub.test ', password: 'senha-correta' })
      .expect(200);
    expect(response.body.accessToken).toEqual(expect.any(String));
    expect(response.body.expiresIn).toBe(900);
    expect(response.body.user).not.toHaveProperty('passwordHash');
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${response.body.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.id).toBe(admin.id);
      });
  });
  it('deve responder igualmente para conta inexistente e senha incorreta', async () => {
    const missing = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'missing@ligahub.test', password: 'senha-errada' })
      .expect(401);
    const incorrect = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: admin.email, password: 'senha-errada' })
      .expect(401);
    expect(missing.body.message).toBe('E-mail ou senha inválidos.');
    expect(missing.body.message).toBe(incorrect.body.message);
  });
  it('deve recusar acesso sem token ou com token inválido', async () => {
    await request(app.getHttpServer()).get('/auth/me').expect(401);
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', 'Bearer invalido')
      .expect(401);
  });
  it('deve permitir a listagem ao administrador e recusar ao organizador', async () => {
    const adminToken = await token();
    const organizerToken = await token(organizer.email);
    await request(app.getHttpServer())
      .get('/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body[0]).not.toHaveProperty('passwordHash');
      });
    await request(app.getHttpServer())
      .get('/users')
      .set('Authorization', `Bearer ${organizerToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({})
      .expect(403);
  });
  it.each([
    { sub: admin.id, version: 0 },
    {
      sub: '------------------------------------',
      version: 0,
      exp: Math.floor(Date.now() / 1000) + 100,
    },
    { sub: admin.id, version: -1, exp: Math.floor(Date.now() / 1000) + 100 },
    { sub: admin.id, version: 0, exp: Math.floor(Date.now() / 1000) + 3600 },
  ])(
    'deve recusar token assinado com dados de sessão inválidos: %j',
    async (payload) => {
      const accessToken = await new JwtService().signAsync(payload, {
        secret: process.env.JWT_SECRET,
        algorithm: 'HS256',
        issuer: 'ligahub-api',
        audience: 'ligahub',
      });
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', 'Bearer ' + accessToken)
        .expect(401);
    },
  );

  it('deve normalizar o e-mail de cadastro antes de validar', async () => {
    const accessToken = await token();
    await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', 'Bearer ' + accessToken)
      .send({
        name: ' Nome ',
        email: ' NOVO@LigaHub.test ',
        password: '123456',
        role: 'organizer',
      })
      .expect(201);
  });

  it('deve rejeitar cadastro com senha curta e campos de privilégio adicionais', async () => {
    const accessToken = await token();
    await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', 'Bearer ' + accessToken)
      .send({
        name: 'Nome',
        email: 'novo@ligahub.test',
        password: '12345',
        role: 'organizer',
      })
      .expect(400);
    await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', 'Bearer ' + accessToken)
      .send({
        name: 'Nome',
        email: 'novo@ligahub.test',
        password: '123456',
        role: 'organizer',
        active: true,
        tokenVersion: 0,
      })
      .expect(400);
  });

  it('deve rejeitar login com valores que não são texto', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: ['admin@ligahub.test'],
        password: { value: 'senha-correta' },
      })
      .expect(400);
  });

  it('deve revogar os tokens após o logout', async () => {
    const accessToken = await token();
    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(204);
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(401);
  });
  it('deve bloquear sessão de uma conta suspensa e login novo', async () => {
    const accessToken = await token();
    accounts[0].active = false;
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(401);
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: admin.email, password: 'senha-correta' })
      .expect(401);
  });
  it('deve usar o papel atual da conta em vez de permissões antigas', async () => {
    const accessToken = await token();
    accounts[0].role = 'organizer';
    await request(app.getHttpServer())
      .get('/users')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);
  });
  it('deve impedir a suspensão da própria conta', async () => {
    const accessToken = await token();
    await request(app.getHttpServer())
      .patch(`/users/${admin.id}/status`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ active: false })
      .expect(400);
  });
});
