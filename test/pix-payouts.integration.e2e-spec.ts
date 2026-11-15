import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../src/prisma.service.js';
import { PaymentsService } from '../src/modules/payments/payments.service.js';
import { PixDestinationsService } from '../src/modules/payments/pix-destinations.service.js';
import { PixPayoutsService } from '../src/modules/payments/pix-payouts.service.js';
import { pixRouting } from '../src/modules/payments/pix-routing.js';
import type { PaymentAccountsService } from '../src/modules/payments/payment-accounts.service.js';
import { PaymentGateway } from '../src/modules/payments/payment.gateway.js';
import { PixPayoutGateway } from '../src/modules/payments/pix-payout.gateway.js';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { validationPipe, ApiExceptionFilter } from '../src/common/http.js';
import {
  digest,
  type ProviderPayment,
} from '../src/modules/payments/payment-security.js';

describe('Pix na plataforma e repasse integral com PostgreSQL', () => {
  let prisma: PrismaService;
  let ownerId: string,
    adminId: string,
    eventId: string,
    registrationId: string,
    accountId: string;
  let payments: PaymentsService,
    destinations: PixDestinationsService,
    payouts: PixPayoutsService;
  const accounts = {
    accessToken: vi.fn().mockResolvedValue('token-apenas-de-teste'),
  };
  const paymentGateway = {
    getPayment: vi.fn(),
    searchPayment: vi.fn(),
    createPayment: vi.fn(),
  };
  const payoutGateway = {
    preflight: vi.fn(),
    body: vi.fn(),
    create: vi.fn(),
    transaction: vi.fn(),
  };
  const actor = () => ({
    id: ownerId,
    role: 'organizer' as const,
    email: 'org@example.test',
    name: 'Organizador fictício',
  });
  const admin = () => ({ ...actor(), id: adminId, role: 'admin' as const });
  const key = 'recebedor@example.test';
  const future = () => Date.now() + 120_000;
  const provider = (
    attemptId: string,
    status = 'approved',
  ): ProviderPayment => ({
    id: `ORD${attemptId.replaceAll('-', '').toUpperCase()}`,
    external_reference: attemptId,
    collector_id: '456',
    currency_id: 'BRL',
    transaction_amount: 10.55,
    status,
    status_detail:
      status === 'approved' ? 'accredited' : 'pending_waiting_transfer',
    date_last_updated: new Date().toISOString(),
    payment_method_id: 'pix',
    payment_type_id: 'bank_transfer',
    installments: 1,
  });
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv('MERCADO_PAGO_PAYOUTS_ENABLED', 'true');
    vi.stubEnv('MERCADO_PAGO_TEST_MODE', 'true');
    vi.stubEnv(
      'MERCADO_PAGO_NOTIFICATION_URL',
      'https://api.example.test/payments/webhook',
    );
    prisma = new PrismaService();
    ownerId = randomUUID();
    adminId = randomUUID();
    eventId = randomUUID();
    await prisma.user.createMany({
      data: [ownerId, adminId].map((id) => ({
        id,
        email: `${id}@example.test`,
        name: 'Usuário fictício',
        role: id === adminId ? 'admin' : 'organizer',
        passwordHash: 'hash-ficticio',
      })),
    });
    await prisma.academicEvent.create({
      data: {
        id: eventId,
        ownerId,
        title: 'Evento fictício',
        priceInCents: 1055,
        capacity: 10,
        status: 'published',
        startsAt: new Date(Date.now() + 86_400_000),
      },
    });
    const account = await prisma.paymentAccount.create({
      data: {
        ownerId: adminId,
        merchantId: '456',
        publicKey: 'TEST-ficticia',
        isTest: true,
        accessTokenEncrypted: 'nao-real',
      },
    });
    accountId = account.id;
    vi.stubEnv('MERCADO_PAGO_PIX_PLATFORM_ACCOUNT_ID', accountId);
    const registration = await prisma.registration.create({
      data: {
        eventId,
        name: 'Pessoa fictícia',
        email: 'participante@example.test',
        answers: {},
        formSnapshot: [],
        priceInCents: 1055,
        reservationExpiresAt: new Date(Date.now() + 3_600_000),
        manageTokenHash: digest('acesso-ficticio'),
      },
    });
    registrationId = registration.id;
    payments = new PaymentsService(
      prisma,
      paymentGateway as unknown as PaymentGateway,
      accounts as unknown as PaymentAccountsService,
    );
    destinations = new PixDestinationsService(prisma);
    payouts = new PixPayoutsService(
      prisma,
      accounts as unknown as PaymentAccountsService,
      paymentGateway as unknown as PaymentGateway,
      payoutGateway as unknown as PixPayoutGateway,
    );
    await destinations.save(actor(), 'EMAIL', key);
    const saved = await destinations.status(actor());
    await destinations.approve(admin(), ownerId, saved.destination!.id);
    paymentGateway.searchPayment.mockResolvedValue(null);
    paymentGateway.createPayment.mockImplementation(
      async (_token: string, _key: string, body: Record<string, unknown>) =>
        provider(String(body.external_reference), 'pending'),
    );
    paymentGateway.getPayment.mockImplementation(
      async (_token: string, id: string) => {
        const attempt = await prisma.paymentAttempt.findUniqueOrThrow({
          where: { providerPaymentId: id },
        });
        return provider(attempt.id);
      },
    );
    payoutGateway.create.mockImplementation(
      async (_token: string, id: string) => ({
        id: 'POPTEST',
        transactions: [
          {
            id: 'TOPTEST',
            external_reference: id,
            amount: { currency: 'BRL', value: 10.55 },
          },
        ],
      }),
    );
    payoutGateway.transaction.mockImplementation(async () => {
      const payout = await prisma.pixPayout.findFirstOrThrow({
        where: { ownerId },
      });
      return {
        id: 'TOPTEST',
        external_reference: payout.id,
        amount: { currency: 'BRL', value: 10.55 },
        status: 'success',
        status_detail: 'accredited',
      };
    });
  });
  afterEach(async () => {
    const rows = await prisma.pixPayout.findMany({
      where: { ownerId },
      select: { id: true },
    });
    const attempts = await prisma.paymentAttempt.findMany({
      where: { registrationId },
      select: { id: true },
    });
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { actorId: { in: [ownerId, adminId] } },
          {
            entityId: {
              in: [
                ownerId,
                registrationId,
                ...rows.map((r) => r.id),
                ...attempts.map((r) => r.id),
              ],
            },
          },
        ],
      },
    });
    await prisma.pixPayout.deleteMany({ where: { ownerId } });
    await prisma.paymentAttempt.deleteMany({ where: { registrationId } });
    await prisma.registration.deleteMany({ where: { id: registrationId } });
    await prisma.organizerPixDestination.deleteMany({ where: { ownerId } });
    await prisma.paymentAccount.deleteMany({ where: { ownerId: adminId } });
    await prisma.academicEvent.deleteMany({ where: { id: eventId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, adminId] } } });
    await prisma.$disconnect();
    vi.unstubAllEnvs();
  });
  async function approved() {
    const response = await payments.create(
      registrationId,
      'acesso-ficticio',
      randomUUID(),
      { method: 'pix', installments: 1, cpf: '12345678909' },
    );
    await payments.applyPayment(response.id, provider(response.id));
    return response.id;
  }
  async function due() {
    await prisma.pixPayout.updateMany({
      where: { ownerId },
      data: { nextAttemptAt: new Date(0) },
    });
  }

  it('recebe na conta da plataforma sem conta MP do organizador, registra uma fila e repassa o valor integral uma vez', async () => {
    expect(
      await payments.checkoutConfig(registrationId, 'acesso-ficticio'),
    ).toMatchObject({ allowedMethods: ['pix'] });
    const id = await approved();
    const attempt = await prisma.paymentAttempt.findUniqueOrThrow({
      where: { id },
    });
    expect(attempt.accountId).toBe(accountId);
    expect(attempt.payoutOwnerId).toBe(ownerId);
    expect(attempt.payoutDestinationEncrypted).not.toContain(key);
    await payments.applyPayment(id, provider(id));
    expect(await prisma.pixPayout.count({ where: { ownerId } })).toBe(1);
    await Promise.all([payouts.process(future()), payouts.process(future())]);
    expect(payoutGateway.create).toHaveBeenCalledTimes(1);
    expect(payoutGateway.create).toHaveBeenCalledWith(
      'token-apenas-de-teste',
      expect.any(String),
      1055,
      expect.objectContaining({ key }),
    );
    expect(
      (await prisma.pixPayout.findFirstOrThrow({ where: { ownerId } })).status,
    ).toBe('processing');
    await due();
    await payouts.process(future());
    await due();
    await payouts.process(future());
    expect(
      (await prisma.pixPayout.findFirstOrThrow({ where: { ownerId } })).status,
    ).toBe('paid');
    expect(payoutGateway.create).toHaveBeenCalledTimes(1);
    const history = await payouts.history(actor());
    expect(JSON.stringify(history)).not.toContain(key);
    expect(JSON.stringify(history)).not.toContain('destinationEncrypted');
    expect((await payouts.history({ ...actor(), id: adminId })).items).toEqual(
      [],
    );
  });
  it('não transfere após timeout de envio e não reenvia no próximo processamento', async () => {
    await approved();
    payoutGateway.create.mockRejectedValue(new Error('timeout'));
    await payouts.process(future());
    await due();
    await payouts.process(future());
    expect(payoutGateway.create).toHaveBeenCalledTimes(1);
    expect(
      (await prisma.pixPayout.findFirstOrThrow({ where: { ownerId } })).status,
    ).toBe('unknown');
  });
  it('recupera a consulta quando o POST foi aceito e a consulta posterior falha', async () => {
    await approved();
    await payouts.process(future());
    await due();
    payoutGateway.transaction.mockRejectedValueOnce(new Error('timeout'));
    await payouts.process(future());
    await due();
    await payouts.process(future());
    expect(payoutGateway.create).toHaveBeenCalledTimes(1);
    expect(
      (await prisma.pixPayout.findFirstOrThrow({ where: { ownerId } })).status,
    ).toBe('paid');
  });
  it('não considera success/in_progress como dinheiro creditado', async () => {
    await approved();
    await payouts.process(future());
    await due();
    const row = await prisma.pixPayout.findFirstOrThrow({ where: { ownerId } });
    payoutGateway.transaction.mockResolvedValueOnce({
      id: 'TOPTEST',
      external_reference: row.id,
      amount: { currency: 'BRL', value: 10.55 },
      status: 'success',
      status_detail: 'in_progress',
    });
    await payouts.process(future());
    expect(
      (await prisma.pixPayout.findUniqueOrThrow({ where: { id: row.id } }))
        .status,
    ).toBe('processing');
  });
  it.each(['canceled', 'payment_review'])(
    'retém a inscrição %s',
    async (status) => {
      await approved();
      await prisma.registration.update({
        where: { id: registrationId },
        data: { status },
      });
      await payouts.process(future());
      expect(payoutGateway.create).not.toHaveBeenCalled();
      expect(
        (await prisma.pixPayout.findFirstOrThrow({ where: { ownerId } }))
          .status,
      ).toBe('held');
    },
  );
  it('retém estorno ou contestação retornada pela consulta autenticada', async () => {
    const id = await approved();
    paymentGateway.getPayment.mockResolvedValueOnce({
      ...provider(id),
      status: 'refunded',
    });
    await payouts.process(future());
    expect(payoutGateway.create).not.toHaveBeenCalled();
  });
  it('recusa divergências de conta, valor e referência do pagamento antes de enviar', async () => {
    const id = await approved();
    paymentGateway.getPayment.mockResolvedValueOnce({
      ...provider(id),
      collector_id: '999',
    });
    await payouts.process(future());
    expect(payoutGateway.create).not.toHaveBeenCalled();
  });
  it('retém múltiplas aprovações e mantém somente um repasse para a inscrição', async () => {
    const id = await approved();
    const previous = await prisma.paymentAttempt.findUniqueOrThrow({
      where: { id },
    });
    const second = await prisma.paymentAttempt.create({
      data: {
        registrationId,
        accountId,
        idempotencyKey: randomUUID(),
        requestHash: 'segunda-ficticia',
        method: 'pix',
        installments: 1,
        amountInCents: 1055,
        payoutOwnerId: ownerId,
        payoutDestinationEncrypted: previous.payoutDestinationEncrypted,
      },
    });
    await payments.applyPayment(second.id, provider(second.id));
    await payouts.process(future());
    expect(await prisma.pixPayout.count({ where: { ownerId } })).toBe(1);
    expect(payoutGateway.create).not.toHaveBeenCalled();
  });
  it('trocar a chave revoga aprovação e não redireciona repasses anteriores', async () => {
    await approved();
    const old = await destinations.status(actor());
    await destinations.save(actor(), 'EMAIL', 'novo@example.test');
    await expect(
      destinations.approve(admin(), ownerId, old.destination!.id),
    ).rejects.toMatchObject({ status: 409 });
    const current = await destinations.status(actor());
    expect(current.destination?.approved).toBe(false);
    await destinations.approve(admin(), ownerId, current.destination!.id);
    await payouts.process(future());
    expect(payoutGateway.create).not.toHaveBeenCalled();
  });
  it('exige aprovação, respeita isolamento e deixa cobranças anteriores sem repasse retroativo', async () => {
    await expect(
      destinations.status({ ...actor(), id: adminId }, ownerId),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      destinations.approve(actor(), ownerId, randomUUID()),
    ).rejects.toMatchObject({ status: 403 });
    await destinations.save(actor(), 'EMAIL', 'novo@example.test');
    await expect(pixRouting(prisma, ownerId)).rejects.toMatchObject({
      status: 503,
    });
    vi.stubEnv('MERCADO_PAGO_PIX_PLATFORM_ACCOUNT_ID', '');
    expect(await pixRouting(prisma, ownerId)).toBeNull();
    const attempt = await prisma.paymentAttempt.create({
      data: {
        registrationId,
        accountId,
        idempotencyKey: randomUUID(),
        requestHash: 'legado',
        method: 'pix',
        installments: 1,
        amountInCents: 1055,
      },
    });
    await payments.applyPayment(attempt.id, provider(attempt.id));
    expect(await prisma.pixPayout.count({ where: { ownerId } })).toBe(0);
    vi.stubEnv('MERCADO_PAGO_PAYOUTS_ENABLED', 'false');
    await payouts.process(future());
    expect(payoutGateway.create).not.toHaveBeenCalled();
  });
  it('protege as rotas HTTP e valida campos antes de persistir chaves ou aprovar destinos', async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(PaymentGateway)
      .useValue(paymentGateway)
      .overrideProvider(PixPayoutGateway)
      .useValue(payoutGateway)
      .compile();
    const app = module.createNestApplication({ logger: false });
    app.useGlobalPipes(validationPipe());
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
    const jwt = new JwtService();
    const token = (id: string) =>
      jwt.sign(
        { sub: id, version: 0 },
        {
          secret: process.env.JWT_SECRET,
          issuer: 'ligahub-api',
          audience: 'ligahub',
          expiresIn: '15m',
        },
      );
    try {
      await request(app.getHttpServer())
        .get('/payments/pix-destination')
        .expect(401);
      await request(app.getHttpServer()).get('/payments/payouts').expect(401);
      await request(app.getHttpServer())
        .get('/payments/pix-destination')
        .query({ ownerId: adminId })
        .auth(token(ownerId), { type: 'bearer' })
        .expect(403);
      await request(app.getHttpServer())
        .get('/payments/pix-destination')
        .query({ ownerId: 'invalid' })
        .auth(token(adminId), { type: 'bearer' })
        .expect(400);
      const status = await request(app.getHttpServer())
        .get('/payments/pix-destination')
        .auth(token(ownerId), { type: 'bearer' })
        .expect(200);
      expect(status.headers['cache-control']).toBe('no-store');
      expect(status.body.destination.key).toBe(key);
      expect(status.body.destination).not.toHaveProperty('keyEncrypted');
      await request(app.getHttpServer())
        .put('/payments/pix-destination')
        .auth(token(ownerId), { type: 'bearer' })
        .send({ keyType: 'EMAIL', key, approved: true })
        .expect(400);
      await request(app.getHttpServer())
        .post('/payments/pix-destination/approval')
        .auth(token(ownerId), { type: 'bearer' })
        .send({ ownerId, destinationId: status.body.destination.id })
        .expect(403);
      await request(app.getHttpServer())
        .get('/payments/payouts')
        .query({ page: -1 })
        .auth(token(ownerId), { type: 'bearer' })
        .expect(400);
    } finally {
      await app.close();
    }
  });
});
