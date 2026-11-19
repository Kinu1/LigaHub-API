import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import { Webhook } from 'svix';
import request from 'supertest';
import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { PrismaService } from '../src/prisma.service.js';
import { JwtAuthGuard } from '../src/modules/auth/auth.guards.js';
import { ResendWebhookController } from '../src/modules/communications/webhook.controller.js';
import { CommunicationsProcessor } from '../src/modules/communications/communications.processor.js';
import { CommunicationsGateway } from '../src/modules/communications/communications.gateway.js';
import { AttachmentsService } from '../src/modules/communications/attachments.service.js';
import { communicationsNoStore } from '../src/modules/communications/communications.middleware.js';

describe('Resend public webhook / official Svix / original raw JSON', () => {
  let app: NestExpressApplication,
    db: PrismaService,
    processor: CommunicationsProcessor;
  const secret = `whsec_${Buffer.alloc(32, 7).toString('base64')}`,
    providerId = `webhook-fixture-${randomUUID()}`,
    path = '/notifications/resend/webhook',
    prefix = `webhook-fixture-${randomUUID()}`;
  beforeAll(async () => {
    vi.stubEnv('RESEND_WEBHOOK_SECRET', secret);
    db = new PrismaService();
    await db.$connect();
    const gateway = { configured: () => false } as CommunicationsGateway;
    processor = new CommunicationsProcessor(
      db,
      gateway,
      new AttachmentsService(db),
    );
    const module = await Test.createTestingModule({
      controllers: [ResendWebhookController],
      providers: [
        { provide: PrismaService, useValue: db },
        { provide: CommunicationsProcessor, useValue: processor },
        JwtAuthGuard,
        { provide: JwtService, useValue: new JwtService() },
        { provide: APP_GUARD, useExisting: JwtAuthGuard },
      ],
    }).compile();
    app = module.createNestApplication<NestExpressApplication>({
      rawBody: true,
    });
    app.use(communicationsNoStore);
    app.useBodyParser('json', { limit: '1mb' });
    await app.init();
  });
  beforeEach(async () => {
    await db.communicationWebhookEvent.deleteMany({
      where: { svixId: { startsWith: prefix } },
    });
  });
  afterAll(async () => {
    await app?.close();
    if (db) {
      await db.communicationWebhookEvent.deleteMany({
        where: { svixId: { startsWith: prefix } },
      });
      await db.$disconnect();
    }
    vi.unstubAllEnvs();
  });
  function payload(type = 'email.delivered') {
    return `{  "type" : "${type}",\n"created_at":"${new Date().toISOString()}", "data": {"email_id":"${providerId}", "to":["private@example.com"]} }`;
  }
  function headers(
    body: string,
    id = `${prefix}-${randomUUID()}`,
    time = new Date(),
  ) {
    return {
      'svix-id': id,
      'svix-timestamp': Math.floor(time.getTime() / 1000).toString(),
      'svix-signature': new Webhook(secret).sign(id, time, body),
    };
  }
  it('is public, verifies original whitespace and stores unmatched without private email content', async () => {
    const body = payload(),
      h = headers(body);
    const r = await request(app.getHttpServer())
      .post(path)
      .set(h)
      .set('Content-Type', 'application/json')
      .send(body);
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    const e = await db.communicationWebhookEvent.findUniqueOrThrow({
      where: { svixId: h['svix-id'] },
    });
    expect(e.processedAt).toBeNull();
    expect(e.reconciliationStatus).toBe('unmatched');
    expect(JSON.stringify(e.payloadJson)).not.toContain('private@example.com');
  });
  it('rejects changed body, missing headers, old and future timestamps', async () => {
    const body = payload();
    for (const [b, h] of [
      [JSON.stringify(JSON.parse(body)), headers(body)],
      [body, {}],
      [body, headers(body, undefined, new Date(Date.now() - 3600000))],
      [body, headers(body, undefined, new Date(Date.now() + 3600000))],
    ] as const) {
      const r = await request(app.getHttpServer())
        .post(path)
        .set(h)
        .set('Content-Type', 'application/json')
        .send(b);
      expect(r.status).toBe(400);
      expect(r.headers['cache-control']).toBe('no-store');
    }
    expect(
      await db.communicationWebhookEvent.count({
        where: { svixId: { startsWith: prefix } },
      }),
    ).toBe(0);
  });
  it('deduplicates concurrent authenticated events and ignores opens/clicks entirely', async () => {
    const body = payload(),
      h = headers(body);
    const r = await Promise.all(
      Array.from({ length: 8 }, () =>
        request(app.getHttpServer())
          .post(path)
          .set(h)
          .set('Content-Type', 'application/json')
          .send(body),
      ),
    );
    expect(r.every((x) => x.status === 200)).toBe(true);
    expect(
      await db.communicationWebhookEvent.count({
        where: { svixId: h['svix-id'] },
      }),
    ).toBe(1);
    for (const type of ['email.opened', 'email.clicked']) {
      const b = payload(type);
      expect(
        (
          await request(app.getHttpServer())
            .post(path)
            .set(headers(b))
            .set('Content-Type', 'application/json')
            .send(b)
        ).status,
      ).toBe(200);
    }
    expect(
      await db.communicationWebhookEvent.count({
        where: { svixId: { startsWith: prefix } },
      }),
    ).toBe(1);
  });
  it('rejects signed invalid payload and parser size overflow', async () => {
    const body = 'null';
    expect(
      (
        await request(app.getHttpServer())
          .post(path)
          .set(headers(body))
          .set('Content-Type', 'application/json')
          .send(body)
      ).status,
    ).toBe(400);
    const huge = JSON.stringify({ data: 'x'.repeat(1024 * 1024) });
    const r = await request(app.getHttpServer())
      .post(path)
      .set(headers(huge))
      .set('Content-Type', 'application/json')
      .send(huge);
    expect(r.status).toBe(413);
    expect(r.headers['cache-control']).toBe('no-store');
  });
});
