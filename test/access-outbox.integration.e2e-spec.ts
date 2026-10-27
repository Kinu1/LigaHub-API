import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { PrismaService } from '../src/prisma.service.js';
import { EmailOutboxService } from '../src/modules/notifications/email-outbox.service.js';
import { AccessEmailProcessor } from '../src/modules/notifications/access-email.processor.js';
import { RegistrationAccessService } from '../src/modules/registrations/access.service.js';
import { readMessage } from '../src/modules/notifications/outbox-payload.js';

describe('Fila durável de acesso (PostgreSQL local)', () => {
  let prisma: PrismaService;
  let processor: AccessEmailProcessor;
  let access: RegistrationAccessService;
  const eventId = randomUUID();
  const gateway = { send: vi.fn().mockResolvedValue('simulado') };
  async function fixture() {
    return prisma.registration.create({
      data: {
        eventId,
        name: 'Participante',
        email: `${randomUUID()}@example.com`,
        answers: {},
        formSnapshot: [],
        priceInCents: 100,
        reservationExpiresAt: new Date(Date.now() + 3600000),
        manageTokenHash: 'legado',
      },
    });
  }
  async function enqueue() {
    const r = await fixture();
    gateway.send.mockRejectedValueOnce(new Error('timeout simulado'));
    await access.safeSend(r.id);
    const row = await prisma.accessEmailOutbox.findFirstOrThrow({
      where: { link: { registrationId: r.id } },
    });
    return { r, row };
  }
  async function due(id: string) {
    await prisma.accessEmailOutbox.update({
      where: { id },
      data: { nextAttemptAt: new Date(0) },
    });
  }
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? '');
    if (url.hostname !== '127.0.0.1' || url.port !== '5433')
      throw new Error('Banco não permitido.');
    vi.stubEnv('EMAIL_DELIVERY_ENABLED', 'true');
    vi.stubEnv('EMAIL_PROVIDER', 'resend');
    vi.stubEnv('RESEND_API_KEY', 'simulado');
    vi.stubEnv('EMAIL_FROM', 'LigaHub <teste@example.com>');
    vi.stubEnv('FRONTEND_URL', 'https://example.com');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('Rede externa proibida');
      }),
    );
    prisma = new PrismaService();
    processor = new AccessEmailProcessor(prisma, gateway);
    access = new RegistrationAccessService(prisma, processor);
    await prisma.academicEvent.create({
      data: {
        id: eventId,
        title: 'Teste acesso',
        capacity: 10,
        priceInCents: 100,
      },
    });
  });
  beforeEach(() => {
    gateway.send.mockReset();
    gateway.send.mockResolvedValue('simulado');
  });
  afterAll(async () => {
    if (prisma) {
      await prisma.registration.deleteMany({ where: { eventId } });
      await prisma.academicEvent.deleteMany({ where: { id: eventId } });
      await prisma.$disconnect();
    }
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  it('timeout preserva mensagem/chave/primeira tentativa; duas instâncias enviam uma vez e limpam payload', async () => {
    const { r, row } = await enqueue();
    expect(row).toMatchObject({ status: 'pending', attempts: 1 });
    const message = readMessage(row.payloadEncrypted!);
    expect(row.payloadEncrypted).not.toContain('access=');
    expect(gateway.send).toHaveBeenCalledExactlyOnceWith(
      message,
      `access/${row.id}`,
    );
    await due(row.id);
    gateway.send.mockClear();
    await Promise.all([
      processor.processBatch(r.id),
      new EmailOutboxService(
        prisma,
        gateway,
        new AccessEmailProcessor(prisma, gateway),
      ).processBatch(r.id),
    ]);
    expect(gateway.send).toHaveBeenCalledExactlyOnceWith(
      message,
      `access/${row.id}`,
    );
    const saved = await prisma.accessEmailOutbox.findUniqueOrThrow({
      where: { id: row.id },
    });
    expect(saved).toMatchObject({
      status: 'sent',
      attempts: 2,
      firstAttemptAt: row.firstAttemptAt,
      payloadEncrypted: null,
      leaseId: null,
      providerId: 'simulado',
    });
    expect(saved.sentAt).toBeInstanceOf(Date);
    const token = new URLSearchParams(
      new URL(message.text.match(/https:\/\/\S+/)![0]).hash.slice(1),
    ).get('access')!;
    expect(await access.exchange(r.id, token)).toBeTruthy();
    await expect(access.exchange(r.id, token)).rejects.toThrow();
  });
  it('vencido ou usado não envia e limpa payload mesmo antes da próxima tentativa', async () => {
    for (const data of [{ expiresAt: new Date(0) }, { usedAt: new Date() }]) {
      const { r, row } = await enqueue();
      await prisma.registrationAccessLink.update({
        where: { id: row.linkId },
        data,
      });
      // Força vencimento da fila junto com o link para representar o prazo original.
      if ('expiresAt' in data)
        await prisma.accessEmailOutbox.update({
          where: { id: row.id },
          data: { expiresAt: new Date(0) },
        });
      gateway.send.mockClear();
      await processor.processBatch(r.id);
      expect(gateway.send).not.toHaveBeenCalled();
      expect(
        await prisma.accessEmailOutbox.findUniqueOrThrow({
          where: { id: row.id },
        }),
      ).toMatchObject({ status: 'skipped', payloadEncrypted: null });
    }
  });
  it('disabled impede enqueue/claim e preserva tentativas', async () => {
    const { r, row } = await enqueue();
    await due(row.id);
    vi.stubEnv('EMAIL_DELIVERY_ENABLED', 'false');
    try {
      gateway.send.mockClear();
      await access.safeSend(r.id);
      await processor.processBatch(r.id);
      expect(gateway.send).not.toHaveBeenCalled();
      expect(
        await prisma.accessEmailOutbox.count({
          where: { link: { registrationId: r.id } },
        }),
      ).toBe(1);
      expect(
        await prisma.accessEmailOutbox.findUniqueOrThrow({
          where: { id: row.id },
        }),
      ).toMatchObject({ attempts: 1, status: 'pending' });
    } finally {
      vi.stubEnv('EMAIL_DELIVERY_ENABLED', 'true');
    }
  });
  it('configuração inválida não deixa link/fila nem credencial legada incompleta', async () => {
    const r = await fixture();
    for (const [key, value] of [
      ['FRONTEND_URL', 'javascript:alert(1)'],
      ['EMAIL_FROM', 'x\r\ny'],
      ['RESEND_API_KEY', ''],
      ['CREDENTIALS_ENCRYPTION_KEY', 'inválida'],
    ]) {
      const previous = process.env[key];
      vi.stubEnv(key, value);
      try {
        await expect(access.sendLink(r.id)).rejects.toThrow();
      } finally {
        vi.stubEnv(key, previous);
      }
    }
    expect(
      await prisma.registrationAccessLink.count({
        where: { registrationId: r.id },
      }),
    ).toBe(0);
    expect(
      (await prisma.registration.findUniqueOrThrow({ where: { id: r.id } }))
        .manageTokenEncrypted,
    ).toBeNull();
  });
  it('cinco falhas encerram sem payload e invalidam o link; nova solicitação é independente', async () => {
    const { r, row } = await enqueue();
    gateway.send.mockRejectedValue(new Error('timeout'));
    for (let i = 0; i < 4; i++) {
      await due(row.id);
      await processor.processBatch(r.id);
    }
    expect(
      await prisma.accessEmailOutbox.findUniqueOrThrow({
        where: { id: row.id },
      }),
    ).toMatchObject({
      status: 'failed',
      attempts: 5,
      payloadEncrypted: null,
      firstAttemptAt: row.firstAttemptAt,
    });
    expect(
      (
        await prisma.registrationAccessLink.findUniqueOrThrow({
          where: { id: row.linkId },
        })
      ).expiresAt.getTime(),
    ).toBeLessThanOrEqual(Date.now());
    gateway.send.mockClear();
    await processor.processBatch(r.id);
    expect(gateway.send).not.toHaveBeenCalled();
    gateway.send.mockResolvedValue('novo');
    await access.safeSend(r.id);
    const rows = await prisma.accessEmailOutbox.findMany({
      where: { link: { registrationId: r.id } },
    });
    expect(rows).toHaveLength(2);
    expect(gateway.send.mock.calls[0][1]).not.toBe(`access/${row.id}`);
  });
  it('recuperação mantém resposta genérica para ausente, presente e falha de envio', async () => {
    const r = await fixture();
    const event = await prisma.academicEvent.findUniqueOrThrow({
      where: { id: eventId },
    });
    const missing = await access.recover(event.publicId, 'ausente@example.com');
    gateway.send.mockRejectedValueOnce(new Error('timeout'));
    expect(await access.recover(event.publicId, r.email)).toEqual(missing);
    expect(
      await prisma.accessEmailOutbox.count({
        where: { link: { registrationId: r.id }, status: 'pending' },
      }),
    ).toBe(1);
  });
  it('lease perdido impede escrita antiga; lease vencido retoma corpo e primeira tentativa', async () => {
    const { r, row } = await enqueue();
    const message = readMessage(row.payloadEncrypted!);
    await due(row.id);
    const replacement = randomUUID();
    gateway.send.mockImplementationOnce(async () => {
      await prisma.accessEmailOutbox.update({
        where: { id: row.id },
        data: {
          leaseId: replacement,
          leaseExpiresAt: new Date(Date.now() + 90_000),
        },
      });
      return 'aceito-sem-finalizar';
    });
    await processor.processBatch(r.id);
    expect(
      await prisma.accessEmailOutbox.findUniqueOrThrow({
        where: { id: row.id },
      }),
    ).toMatchObject({
      status: 'processing',
      leaseId: replacement,
      attempts: 2,
      payloadEncrypted: row.payloadEncrypted,
      firstAttemptAt: row.firstAttemptAt,
      providerId: null,
    });
    gateway.send.mockClear();
    await processor.processBatch(r.id);
    expect(gateway.send).not.toHaveBeenCalled();
    await prisma.accessEmailOutbox.update({
      where: { id: row.id },
      data: { leaseExpiresAt: new Date(0) },
    });
    await new AccessEmailProcessor(prisma, gateway).processBatch(r.id);
    expect(gateway.send).toHaveBeenCalledExactlyOnceWith(
      message,
      `access/${row.id}`,
    );
    expect(
      await prisma.accessEmailOutbox.findUniqueOrThrow({
        where: { id: row.id },
      }),
    ).toMatchObject({
      status: 'sent',
      attempts: 3,
      firstAttemptAt: row.firstAttemptAt,
      payloadEncrypted: null,
    });
  });
  it('payload corrompido falha apenas seu item e permite processar o seguinte', async () => {
    const { r, row } = await enqueue();
    gateway.send.mockRejectedValueOnce(new Error('timeout'));
    await access.safeSend(r.id);
    const second = await prisma.accessEmailOutbox.findFirstOrThrow({
      where: {
        link: { registrationId: r.id },
        id: { not: row.id },
      },
    });
    await prisma.accessEmailOutbox.update({
      where: { id: row.id },
      data: { payloadEncrypted: 'corrompido' },
    });
    await due(row.id);
    await due(second.id);
    gateway.send.mockClear();
    await processor.processBatch(r.id);
    expect(
      await prisma.accessEmailOutbox.findUniqueOrThrow({
        where: { id: row.id },
      }),
    ).toMatchObject({
      status: 'failed',
      payloadEncrypted: null,
    });
    expect(
      await prisma.accessEmailOutbox.findUniqueOrThrow({
        where: { id: second.id },
      }),
    ).toMatchObject({
      status: 'sent',
      payloadEncrypted: null,
    });
    expect(gateway.send).toHaveBeenCalledExactlyOnceWith(
      readMessage(second.payloadEncrypted!),
      `access/${second.id}`,
    );
  });
});
