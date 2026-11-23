import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { JwtService } from '@nestjs/jwt';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { CommunicationsController } from './communications.controller.js';
import { CommunicationsService } from './communications.service.js';
import { AttachmentsService } from './attachments.service.js';
import { JwtAuthGuard, RolesGuard } from '../auth/auth.guards.js';
import { PrismaService } from '../../prisma.service.js';
import { communicationsNoStore } from './communications.middleware.js';
import { validationPipe, ApiExceptionFilter } from '../../common/http.js';

describe('communications HTTP boundary', () => {
  let app: NestExpressApplication;
  const id = randomUUID(),
    campaign = randomUUID(),
    file = randomUUID(),
    user = randomUUID();
  const jwt = new JwtService(),
    secret = 'communications-test-secret-at-least-32-characters';
  const service = {
    listCampaigns: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  };
  const route = `/events/${id}/communications`;
  beforeAll(async () => {
    vi.stubEnv('JWT_SECRET', secret);
    const module = await Test.createTestingModule({
      controllers: [CommunicationsController],
      providers: [
        { provide: CommunicationsService, useValue: service },
        { provide: AttachmentsService, useValue: {} },
        {
          provide: PrismaService,
          useValue: {
            user: {
              findUnique: vi.fn().mockResolvedValue({
                id: user,
                name: 'Owner',
                email: 'owner@example.com',
                role: 'organizer',
                active: true,
                tokenVersion: 0,
              }),
            },
          },
        },
        { provide: JwtService, useValue: jwt },
        JwtAuthGuard,
        RolesGuard,
        { provide: APP_GUARD, useExisting: JwtAuthGuard },
        { provide: APP_GUARD, useExisting: RolesGuard },
      ],
    }).compile();
    app = module.createNestApplication<NestExpressApplication>({
      rawBody: true,
    });
    app.use(communicationsNoStore);
    app.useBodyParser('json', { limit: '1mb' });
    app.useGlobalPipes(validationPipe());
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
    vi.unstubAllEnvs();
  });
  function auth() {
    return jwt.sign(
      { sub: user, version: 0 },
      { secret, expiresIn: 900, issuer: 'ligahub-api', audience: 'ligahub' },
    );
  }
  it.each([
    ['get', ''],
    ['post', ''],
    ['get', `/${campaign}`],
    ['put', `/${campaign}`],
    ['get', `/${campaign}/preview`],
    ['post', `/${campaign}/test`],
    ['post', `/${campaign}/send`],
    ['get', `/${campaign}/recipients`],
    ['post', `/${campaign}/attachments/initiate`],
    ['post', `/${campaign}/attachments/${file}/chunks`],
    ['post', `/${campaign}/attachments/finalize`],
    ['delete', `/${campaign}/attachments/${file}`],
    ['get', `/${campaign}/attachments/${file}/download`],
  ])('requires JWT and no-store on %s %s', async (method, suffix) => {
    const r = await request(app.getHttpServer())[method as 'get'](
      route + suffix,
    );
    expect(r.status).toBe(401);
    expect(r.headers['cache-control']).toBe('no-store');
  });
  it('returns no-store on success, UUID validation, invalid DTO and parser size error', async () => {
    const token = auth();
    let r = await request(app.getHttpServer())
      .get(route)
      .set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    r = await request(app.getHttpServer())
      .get('/events/not-uuid/communications')
      .set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(400);
    expect(r.headers['cache-control']).toBe('no-store');
    r = await request(app.getHttpServer())
      .post(route)
      .set('Authorization', `Bearer ${token}`)
      .send({
        subject: 'bad',
        htmlContent: 'x',
        textContent: 'x',
        audienceType: 'all_active',
        audienceCategoryIds: [],
        confirmedOnly: 'true',
      });
    expect(r.status).toBe(400);
    expect(r.headers['cache-control']).toBe('no-store');
    r = await request(app.getHttpServer())
      .post(route)
      .send({ htmlContent: 'x'.repeat(1024 * 1024) });
    expect(r.status).toBe(413);
    expect(r.headers['cache-control']).toBe('no-store');
  });
});
