import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma.service.js';
import { PaymentGateway } from '../src/modules/payments/payment.gateway.js';
import { PasswordHasher } from '../src/modules/users/password-hasher.js';

describe('Retorno OAuth ao site e consulta protegida da conta', () => {
  let moduleRef: TestingModule;
  let app: ReturnType<TestingModule['createNestApplication']>;
  let prisma: PrismaService;
  const ownerId = randomUUID(),
    outsiderId = randomUUID();
  const gateway = {
    exchangeOAuth: vi.fn().mockResolvedValue({
      access_token: 'segredo-access-token-ficticio',
      refresh_token: 'segredo-refresh-ficticio',
      user_id: 900000001,
      public_key: 'APP_USR-publica-ficticia',
      expires_in: 3600,
      live_mode: true,
    }),
    merchant: vi
      .fn()
      .mockResolvedValue({ id: 900000001, site_id: 'MLB', tags: [] }),
  };
  beforeAll(async () => {
    vi.stubEnv('FRONTEND_URL', 'https://ligahub.example');
    vi.stubEnv('MERCADO_PAGO_CLIENT_ID', 'aplicacao-ficticia');
    vi.stubEnv('MERCADO_PAGO_CLIENT_SECRET', 'segredo-client-ficticio');
    vi.stubEnv(
      'MERCADO_PAGO_REDIRECT_URI',
      'https://api.example/payments/accounts/callback',
    );
    vi.stubEnv('MERCADO_PAGO_TEST_MODE', 'false');
    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PaymentGateway)
      .useValue(gateway)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    prisma = app.get(PrismaService);
    const passwordHash = await app
      .get(PasswordHasher)
      .hash('senha-exclusiva-teste');
    await prisma.user.createMany({
      data: [ownerId, outsiderId].map((id) => ({
        id,
        name: 'Organizador de teste',
        email: `${id}@ligahub.test`,
        role: id === ownerId ? 'admin' : 'organizer',
        passwordHash,
      })),
    });
  });
  afterAll(async () => {
    if (prisma) {
      await prisma.auditLog.deleteMany({
        where: { actorId: { in: [ownerId, outsiderId] } },
      });
      await prisma.oAuthState.deleteMany({
        where: { ownerId: { in: [ownerId, outsiderId] } },
      });
      await prisma.paymentAccount.deleteMany({
        where: { ownerId: { in: [ownerId, outsiderId] } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: [ownerId, outsiderId] } },
      });
    }
    await app?.close();
    vi.unstubAllEnvs();
  });
  async function login(id: string) {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: `${id}@ligahub.test`, password: 'senha-exclusiva-teste' })
      .expect(200);
    return response.body.accessToken as string;
  }
  it('redireciona sem segredos, mantém credenciais criptografadas e restringe sua consulta ao dono', async () => {
    const token = await login(ownerId);
    const authorization = await request(app.getHttpServer())
      .post('/payments/accounts/authorize')
      .auth(token, { type: 'bearer' })
      .send({})
      .expect(201);
    const state = new URL(authorization.body.authorizationUrl).searchParams.get(
      'state',
    );
    const callback = await request(app.getHttpServer())
      .get('/payments/accounts/callback')
      .query({ state, code: 'codigo-ficticio' })
      .expect(303);
    expect(callback.headers.location).toBe(
      `https://ligahub.example/painel/financeiro?mercadoPago=connected&ownerId=${ownerId}`,
    );
    expect(callback.headers['cache-control']).toBe('no-store');
    expect(callback.headers['referrer-policy']).toBe('no-referrer');
    expect(callback.text).not.toContain('codigo-ficticio');
    const stored = await prisma.paymentAccount.findFirstOrThrow({
      where: { ownerId, active: true },
    });
    expect(stored.accessTokenEncrypted).not.toContain(
      'segredo-access-token-ficticio',
    );
    expect(stored.refreshTokenEncrypted).not.toContain(
      'segredo-refresh-ficticio',
    );
    expect(stored.isTest).toBe(false);
    const status = await request(app.getHttpServer())
      .get('/payments/accounts')
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(status.headers['cache-control']).toBe('no-store');
    expect(status.body).toMatchObject({
      connected: true,
      merchantId: '900000001',
      publicKey: 'APP_USR-publica-ficticia',
      isTest: false,
    });
    expect(Object.keys(status.body).sort()).toEqual(
      [
        'connected',
        'createdAt',
        'id',
        'isTest',
        'merchantId',
        'ownerId',
        'publicKey',
        'tokenExpiresAt',
      ].sort(),
    );
    await request(app.getHttpServer()).get('/payments/accounts').expect(401);
    const outsiderToken = await login(outsiderId);
    await request(app.getHttpServer())
      .get('/payments/accounts')
      .query({ ownerId })
      .auth(outsiderToken, { type: 'bearer' })
      .expect(403);
    const replay = await request(app.getHttpServer())
      .get('/payments/accounts/callback')
      .query({ state, code: 'codigo-ficticio' })
      .expect(303);
    expect(replay.headers.location).toBe(
      'https://ligahub.example/painel/financeiro?mercadoPago=error',
    );
    expect(gateway.exchangeOAuth).toHaveBeenCalledTimes(1);
    expect(
      await prisma.paymentAccount.count({ where: { ownerId, active: true } }),
    ).toBe(1);
  });
  it('redireciona a recusa sem chamar o provedor nem alterar a conexão existente', async () => {
    const calls = gateway.exchangeOAuth.mock.calls.length;
    const response = await request(app.getHttpServer())
      .get('/payments/accounts/callback')
      .query({ error: 'access_denied' })
      .expect(303);
    expect(response.headers.location).toBe(
      'https://ligahub.example/painel/financeiro?mercadoPago=canceled',
    );
    expect(gateway.exchangeOAuth).toHaveBeenCalledTimes(calls);
  });
});
