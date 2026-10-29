// Servidor exclusivo dos testes de navegador; não é importado pela aplicação.
import 'reflect-metadata';
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';

if (
  process.env.LIGAHUB_BROWSER_TEST !== 'true' ||
  process.env.NODE_ENV !== 'test'
)
  throw new Error('Servidor permitido somente no teste de navegador.');
const database = new URL(process.env.DATABASE_URL ?? '');
if (!['localhost', '127.0.0.1', '[::1]'].includes(database.hostname))
  throw new Error(
    'Os testes de navegador exigem PostgreSQL local ou do job de CI.',
  );
Object.assign(process.env, {
  JWT_SECRET: 'segredo-exclusivo-do-navegador-nao-usar-em-producao',
  CREDENTIALS_ENCRYPTION_KEY: Buffer.alloc(32, 2).toString('base64'),
  PAYMENT_RECONCILIATION_ENABLED: 'false',
  EMAIL_DELIVERY_ENABLED: 'false',
  EMAIL_PROVIDER: 'resend',
  RESEND_API_KEY: 'chave-simulada-do-navegador',
  EMAIL_FROM: 'LigaHub <teste@example.com>',
  FRONTEND_URL: 'http://localhost:3101',
  CORS_ORIGINS: 'http://localhost:3101',
  MERCADO_PAGO_TEST_MODE: 'true',
  MERCADO_PAGO_NOTIFICATION_URL: 'https://browser.invalid/payments/webhook',
});
globalThis.fetch = async () => {
  throw new Error('Chamadas externas proibidas neste servidor de teste.');
};
const [
  { Test },
  { AppModule },
  { PrismaService },
  { PaymentGateway },
  { EmailGateway },
  { PaymentsService },
  { PaymentAccountsService },
  { EmailOutboxService },
  { Argon2PasswordHasher },
  { browserSecurity },
  { validationPipe },
  { encryptCredential, digest },
] = await Promise.all([
  import('@nestjs/testing'),
  import('../dist/app.module.js'),
  import('../dist/prisma.service.js'),
  import('../dist/modules/payments/payment.gateway.js'),
  import('../dist/modules/notifications/email.gateway.js'),
  import('../dist/modules/payments/payments.service.js'),
  import('../dist/modules/payments/payment-accounts.service.js'),
  import('../dist/modules/notifications/email-outbox.service.js'),
  import('../dist/modules/users/argon2-password-hasher.js'),
  import('../dist/common/browser-security.js'),
  import('../dist/common/http.js'),
  import('../dist/modules/payments/payment-security.js'),
]);
const messages = [],
  remote = new Map(),
  keys = new Map();
let fixture,
  loseNextResponse = false,
  rejectNextPayment = false,
  createdCharges = 0;
const gateway = {
  async createPayment(_token, key, body) {
    if (keys.has(key)) return remote.get(keys.get(key));
    const payment = {
      id: `ORDTSTE2E${randomUUID().replaceAll('-', '')}`,
      external_reference: body.external_reference,
      collector_id: '900000000',
      currency_id: 'BRL',
      transaction_amount: body.transaction_amount,
      status: rejectNextPayment ? 'rejected' : 'pending',
      status_detail: rejectNextPayment
        ? 'cc_rejected_other_reason'
        : 'waiting_payment',
      date_last_updated: new Date().toISOString(),
      payment_method_id: body.payment_method_id,
      payment_type_id:
        body.payment_method_id === 'pix' ? 'bank_transfer' : 'credit_card',
      installments: body.installments,
      point_of_interaction:
        body.payment_method_id === 'pix'
          ? {
              transaction_data: { qr_code: 'pix-ficticio-sem-cobranca' },
            }
          : undefined,
    };
    rejectNextPayment = false;
    remote.set(payment.id, payment);
    keys.set(key, payment.id);
    createdCharges++;
    if (loseNextResponse) {
      loseNextResponse = false;
      throw new Error('Resposta simulada perdida.');
    }
    return payment;
  },
  async getPayment(_token, id) {
    return remote.get(id);
  },
  async searchPayment(_token, reference) {
    return (
      [...remote.values()].find((p) => p.external_reference === reference) ??
      null
    );
  },
};
const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
  .overrideProvider(PaymentGateway)
  .useValue(gateway)
  .overrideProvider(EmailGateway)
  .useValue({
    async send(message) {
      messages.push(message);
      return `email-ficticio-${messages.length}`;
    },
  })
  .compile();
const app = moduleRef.createNestApplication({ logger: ['error'] });
const prisma = app.get(PrismaService);
// O histórico do navegador nunca lê pagamentos de usuários do banco compartilhado.
const payments = app.get(PaymentsService);
const fixtureHistory = payments.history.bind(payments);
payments.history = (actor, ...args) => {
  if (!fixture)
    throw new Error('Crie uma fixture antes de consultar o histórico.');
  return fixtureHistory(
    { ...actor, id: fixture.ownerId, role: 'organizer' },
    ...args,
  );
};
const express = app.getHttpAdapter().getInstance();
const control = (method, path, handler) =>
  express[method](path, async (req, res) => {
    if (req.headers['x-browser-test'] !== 'controle-local-de-testes')
      return res.sendStatus(403);
    try {
      res.json(await handler(req));
    } catch (error) {
      console.error(
        'Falha na fixture:',
        error.name,
        error.code ?? '',
        error.message,
      );
      res
        .status(500)
        .json({ message: 'Falha no controle da fixture de navegador.' });
    }
  });
async function cleanup() {
  if (!fixture) return;
  const owner = await prisma.user.findUnique({
    where: { id: fixture.ownerId },
  });
  if (
    owner &&
    (owner.email !== `browser-${owner.id}@ligahub.test` ||
      owner.name !== 'Admin de teste')
  )
    throw new Error('A limpeza está limitada aos registros de teste.');
  const event = await prisma.academicEvent.findUnique({
    where: { id: fixture.eventId },
  });
  if (event && event.ownerId !== fixture.ownerId)
    throw new Error('Evento fora da fixture.');
  const registrations = await prisma.registration.findMany({
    where: { eventId: fixture.eventId },
    select: { id: true },
  });
  const payments = await prisma.paymentAttempt.findMany({
    where: { registration: { eventId: fixture.eventId } },
    select: { id: true },
  });
  const tasks = await prisma.emailOutbox.findMany({
    where: { registrationId: { in: registrations.map((r) => r.id) } },
    select: { id: true },
  });
  await prisma.auditLog.deleteMany({
    where: {
      entityId: {
        in: [
          fixture.ownerId,
          fixture.eventId,
          fixture.accountId,
          ...registrations.map((r) => r.id),
          ...payments.map((p) => p.id),
          ...tasks.map((t) => t.id),
        ],
      },
    },
  });
  await prisma.paymentAttempt.deleteMany({
    where: { registration: { eventId: fixture.eventId } },
  });
  await prisma.registration.deleteMany({ where: { eventId: fixture.eventId } });
  await prisma.paymentAccount.deleteMany({
    where: { ownerId: fixture.ownerId },
  });
  await prisma.academicEvent.deleteMany({ where: { id: fixture.eventId } });
  await prisma.browserSession.deleteMany({
    where: { userId: fixture.ownerId },
  });
  await prisma.user.deleteMany({ where: { id: fixture.ownerId } });
  fixture = undefined;
  messages.length = 0;
  remote.clear();
  keys.clear();
  createdCharges = 0;
  rejectNextPayment = false;
  await unlink('.test-temp/browser-fixture.json').catch(() => undefined);
}
await mkdir('.test-temp', { recursive: true });
try {
  fixture = JSON.parse(
    await readFile('.test-temp/browser-fixture.json', 'utf8'),
  );
  if (
    !/^[0-9a-f-]{36}$/.test(fixture.ownerId) ||
    !/^[0-9a-f-]{36}$/.test(fixture.eventId)
  )
    throw new Error('Arquivo de fixture inválido.');
  await cleanup();
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
control('post', '/__browser/fixture', async () => {
  await cleanup();
  const ownerId = randomUUID(),
    email = `browser-${ownerId}@ligahub.test`;
  fixture = { ownerId, email, accountId: randomUUID(), eventId: randomUUID() };
  await writeFile('.test-temp/browser-fixture.json', JSON.stringify(fixture));
  await prisma.user.create({
    data: {
      id: ownerId,
      email,
      name: 'Admin de teste',
      role: 'admin',
      passwordHash: await new Argon2PasswordHasher().hash(
        'Senha-exclusiva-do-teste',
      ),
    },
  });
  const account = await prisma.paymentAccount.create({
    data: {
      id: fixture.accountId,
      ownerId,
      merchantId: '900000000',
      isTest: true,
      publicKey: 'TEST-simulado',
      accessTokenEncrypted: encryptCredential('token-ficticio'),
    },
  });
  const event = await prisma.academicEvent.create({
    data: {
      id: fixture.eventId,
      ownerId,
      title: 'Jornada de teste no navegador',
      status: 'published',
      capacity: 1,
      priceInCents: 2500,
      startsAt: new Date(Date.now() + 7 * 86400000),
      location: 'Ambiente de testes',
    },
  });
  fixture = {
    ownerId,
    email,
    accountId: account.id,
    eventId: event.id,
    publicId: event.publicId,
  };
  loseNextResponse = false;
  return fixture;
});
control('post', '/__browser/cleanup', async () => {
  await cleanup();
  return { cleaned: true };
});
control('get', '/__browser/messages', async () => messages);
control('post', '/__browser/failed-email', async () => {
  const row = await prisma.registration.create({
    data: {
      eventId: fixture.eventId,
      name: 'Participante da fila',
      email: 'fila@example.com',
      answers: {},
      formSnapshot: [],
      priceInCents: 2500,
      status: 'confirmed',
      reservationExpiresAt: new Date(Date.now() + 3600000),
      manageTokenHash: digest('m'.repeat(43)),
      statusTokenHash: digest('s'.repeat(43)),
      statusTokenExpiresAt: new Date(Date.now() + 86400000),
    },
  });
  return prisma.emailOutbox.create({
    data: {
      registrationId: row.id,
      status: 'failed',
      attempts: 8,
      firstAttemptAt: new Date(),
      payloadEncrypted: encryptCredential(
        JSON.stringify({
          message: {
            from: process.env.EMAIL_FROM,
            to: ['fila@example.com'],
            subject: 'Confirmação de teste',
            text: 'Confirmação fictícia sem envio externo.',
          },
        }),
      ),
    },
    select: { id: true, registrationId: true },
  });
});
control('get', '/__browser/charges', async () => ({
  createdCharges,
  payments: [...remote.values()].map((payment) => ({
    method: payment.payment_type_id === 'bank_transfer' ? 'pix' : 'card',
    installments: payment.installments,
    amount: payment.transaction_amount,
    status: payment.status,
  })),
}));
control('post', '/__browser/reject-payment', async () => {
  rejectNextPayment = true;
  return { configured: true };
});
control('post', '/__browser/lose-response', async () => {
  loseNextResponse = true;
  return { configured: true };
});
async function registration(id) {
  const row = await prisma.registration.findUniqueOrThrow({ where: { id } });
  if (row.eventId !== fixture?.eventId)
    throw new Error('Fixture não pertence ao teste.');
  return row;
}
control('post', '/__browser/payments/:id/:status', async (req) => {
  const row = await registration(req.params.id);
  if (!['approved', 'refunded'].includes(req.params.status))
    throw new Error('Estado de teste inválido.');
  const attempt = await prisma.paymentAttempt.findFirstOrThrow({
    where: { registrationId: row.id },
  });
  const payment = remote.get(attempt.providerPaymentId);
  if (!payment) throw new Error('Pagamento fictício não encontrado.');
  payment.status = req.params.status;
  payment.status_detail =
    payment.status === 'approved' ? 'accredited' : 'refunded';
  payment.date_last_updated = new Date(
    Math.max(Date.now(), Date.parse(payment.date_last_updated) + 1),
  ).toISOString();
  await app.get(PaymentsService).applyPayment(attempt.id, payment);
  if (payment.status === 'approved')
    await app.get(EmailOutboxService).processBatch(row.id);
  return { updated: true };
});
control('post', '/__browser/interrupted/:id', async (req) => {
  const row = await registration(req.params.id);
  await prisma.registration.update({
    where: { id: row.id },
    data: { reservationExpiresAt: new Date(Date.now() - 1000) },
  });
  await prisma.paymentAttempt.create({
    data: {
      registrationId: row.id,
      accountId: fixture.accountId,
      idempotencyKey: randomUUID(),
      requestHash: 'fixture-interrompida',
      method: 'pix',
      installments: 1,
      amountInCents: 2500,
      providerApi: 'orders',
      submissionStarted: false,
    },
  });
  const scoped = new Proxy(prisma, {
    get(target, property) {
      if (property === 'paymentAttempt')
        return new Proxy(target.paymentAttempt, {
          get(model, method) {
            if (method === 'findMany')
              return (args) =>
                model.findMany({
                  ...args,
                  where: {
                    AND: [args.where ?? {}, { registrationId: row.id }],
                  },
                });
            const value = Reflect.get(model, method);
            return typeof value === 'function' ? value.bind(model) : value;
          },
        });
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  await new PaymentsService(
    scoped,
    gateway,
    app.get(PaymentAccountsService),
  ).reconcile();
  return { recovered: true };
});
app.use(browserSecurity);
app.useGlobalPipes(validationPipe());
await app.listen(3100, '127.0.0.1');
// Os timers foram desativados durante a inicialização; o envio é simulado e controlado por fixture.
process.env.EMAIL_DELIVERY_ENABLED = 'true';
