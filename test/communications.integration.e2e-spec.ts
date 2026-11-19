import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  it,
  expect,
  vi,
} from 'vitest';
import { PrismaService } from '../src/prisma.service.js';
import { CommunicationsService } from '../src/modules/communications/communications.service.js';
import { CommunicationsProcessor } from '../src/modules/communications/communications.processor.js';
import {
  CommunicationsGateway,
  DeliveryError,
} from '../src/modules/communications/communications.gateway.js';
import { AttachmentsService } from '../src/modules/communications/attachments.service.js';
import { calculateChecksum } from '../src/modules/communications/attachment-validator.js';
import { CommunicationAudience } from '../src/modules/communications/communications.enums.js';
import {
  encryptCredential,
  decryptCredential,
} from '../src/modules/payments/payment-security.js';

describe('communications PostgreSQL transactions and delivery', () => {
  let db: PrismaService,
    service: CommunicationsService,
    files: AttachmentsService,
    worker: CommunicationsProcessor;
  const owner = randomUUID(),
    admin = randomUUID(),
    eventId = randomUUID(),
    otherEvent = randomUUID();
  const send = vi.fn();
  const gateway = {
    configured: () => true,
    send,
  } as unknown as CommunicationsGateway;
  const base = {
    subject: 'Aviso',
    htmlContent: '<p>Conteúdo <strong>seguro</strong></p>',
    textContent: 'Conteúdo seguro',
    audienceType: CommunicationAudience.all_active,
    audienceCategoryIds: [],
  };
  async function draft(overrides = {}) {
    return service.createCampaign(eventId, admin, 'admin', {
      ...base,
      ...overrides,
    });
  }
  async function registration(
    status = 'confirmed',
    category = 'a',
    extra = {},
  ) {
    return db.registration.create({
      data: {
        eventId,
        name: 'Participante',
        email: `${randomUUID()}@example.com`,
        answers: {},
        formSnapshot: [],
        priceInCents: 1000,
        reservationExpiresAt: new Date(Date.now() + 3600000),
        manageTokenHash: 'fake-hash',
        status,
        registrationTypeId: category,
        ...extra,
      },
    });
  }
  async function queue() {
    await registration();
    const c = await draft();
    await service.finalizeSend(eventId, c.id, owner, 'organizer', randomUUID());
    return c;
  }
  async function recipient(campaignId: string) {
    return db.communicationRecipient.findFirstOrThrow({
      where: { campaignId },
    });
  }
  async function event(providerId: string, type: string, age = 0) {
    return db.communicationWebhookEvent.create({
      data: {
        svixId: randomUUID(),
        providerId,
        eventType: type,
        payloadJson: { type },
        receivedAt: new Date(Date.now() + age),
      },
    });
  }
  beforeAll(async () => {
    db = new PrismaService();
    await db.$connect();
    vi.stubEnv('EMAIL_FROM', 'verified@example.com');
    vi.stubEnv('EMAIL_DELIVERY_ENABLED', 'true');
    await db.user.createMany({
      data: [
        {
          id: owner,
          name: 'Owner <unsafe>',
          email: `${owner}@example.com`,
          role: 'organizer',
          passwordHash: 'fake',
        },
        {
          id: admin,
          name: 'Admin',
          email: `${admin}@example.com`,
          role: 'admin',
          passwordHash: 'fake',
        },
      ],
    });
    await db.academicEvent.createMany({
      data: [
        {
          id: eventId,
          ownerId: owner,
          title: 'Evento <script>x</script>',
          priceInCents: 1000,
          capacity: 100,
          registrationTypes: [
            { id: 'a', name: 'A' },
            { id: 'b', name: 'B' },
          ],
        },
        {
          id: otherEvent,
          ownerId: admin,
          title: 'Outro',
          priceInCents: 1000,
          capacity: 10,
        },
      ],
    });
    service = new CommunicationsService(db, gateway);
    files = new AttachmentsService(db);
    worker = new CommunicationsProcessor(db, gateway, files);
  });
  beforeEach(async () => {
    await db.communicationCampaign.deleteMany({ where: { eventId } });
    await db.registration.deleteMany({ where: { eventId } });
    await db.communicationWebhookEvent.deleteMany({
      where: { svixId: { startsWith: 'unused-test-' } },
    });
    send.mockReset().mockImplementation(async () => `provider-${randomUUID()}`);
  });
  afterAll(async () => {
    if (db) {
      await db.communicationWebhookEvent.deleteMany({
        where: {
          OR: [
            { providerId: { startsWith: 'provider-' } },
            { providerId: { startsWith: 'test-' } },
          ],
        },
      });
      await db.communicationCampaign.deleteMany({ where: { eventId } });
      await db.registration.deleteMany({ where: { eventId } });
      await db.academicEvent.deleteMany({
        where: { id: { in: [eventId, otherEvent] } },
      });
      await db.user.deleteMany({ where: { id: { in: [owner, admin] } } });
      await db.$disconnect();
    }
    vi.unstubAllEnvs();
  });
  it('authorizes current event owner even campaign created by admin; rejects event crossing and non-owner on every service action', async () => {
    const c = await draft();
    expect(
      (await service.getCampaign(eventId, c.id, owner, 'organizer')).id,
    ).toBe(c.id);
    await service.updateCampaign(eventId, c.id, owner, 'organizer', {
      subject: 'Owner edit',
    });
    await expect(
      service.getCampaign(otherEvent, c.id, admin, 'admin'),
    ).rejects.toMatchObject({ status: 404 });
    const operations = [
      () => service.listCampaigns(eventId, admin, 'organizer', {}),
      () => service.getCampaign(eventId, c.id, admin, 'organizer'),
      () => service.updateCampaign(eventId, c.id, admin, 'organizer', {}),
      () => service.previewAudience(eventId, c.id, admin, 'organizer'),
      () => service.listRecipients(eventId, c.id, admin, 'organizer', {}),
      () =>
        service.finalizeSend(eventId, c.id, admin, 'organizer', randomUUID()),
      () => service.sendTestEmail(eventId, c.id, admin, 'organizer'),
      () =>
        files.initiateUpload(eventId, c.id, admin, 'organizer', {
          filename: 'x.txt',
          mimeType: 'text/plain',
          sizeBytes: 1,
          checksum: calculateChecksum(Buffer.from('x')),
          totalChunks: 1,
        }),
      () =>
        files.uploadChunk(eventId, c.id, admin, 'organizer', randomUUID(), {
          dataBase64: 'eA==',
          chunkIndex: 0,
          checksum: calculateChecksum(Buffer.from('x')),
        }),
      () =>
        files.finalizeUpload(eventId, c.id, admin, 'organizer', randomUUID()),
      () =>
        files.deleteAttachment(eventId, c.id, admin, 'organizer', randomUUID()),
      () =>
        files.downloadAttachment(
          eventId,
          c.id,
          admin,
          'organizer',
          randomUUID(),
        ),
    ];
    for (const op of operations)
      await expect(op()).rejects.toMatchObject({ status: 403 });
  });
  it('validates categories, composes confirmedOnly, includes payment review and excludes expired/cancelled/suspended', async () => {
    await registration('confirmed', 'a', {
      cancellationRequestedAt: new Date(),
    });
    await registration('payment_review', 'a', {
      reservationExpiresAt: new Date(0),
    });
    await registration('reserved', 'a');
    await registration('reserved', 'a', { reservationExpiresAt: new Date(0) });
    await registration('cancelled', 'a');
    await registration('confirmed', 'a', { suspendedAt: new Date() });
    await registration('confirmed', 'b');
    await expect(
      draft({
        audienceType: CommunicationAudience.categories,
        audienceCategoryIds: ['alien'],
      }),
    ).rejects.toThrow();
    const c = await draft({
      audienceType: CommunicationAudience.categories,
      audienceCategoryIds: ['a'],
    });
    expect(
      (await service.previewAudience(eventId, c.id, owner, 'organizer')).total,
    ).toBe(3);
    await service.updateCampaign(eventId, c.id, owner, 'organizer', {
      confirmedOnly: true,
    });
    expect(
      (await service.previewAudience(eventId, c.id, owner, 'organizer')).total,
    ).toBe(1);
  });
  it('freezes one snapshot under concurrent repeat sends and permanently rejects key reuse/mutations', async () => {
    await registration();
    await registration('payment_review', 'b', {
      reservationExpiresAt: new Date(0),
    });
    const c = await draft(),
      key = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        service.finalizeSend(eventId, c.id, owner, 'organizer', key),
      ),
    );
    expect(new Set(results.map((r) => r.campaignId))).toEqual(new Set([c.id]));
    expect(
      await db.communicationRecipient.count({ where: { campaignId: c.id } }),
    ).toBe(2);
    await registration();
    expect(
      (await service.finalizeSend(eventId, c.id, owner, 'organizer', key))
        .recipientCount,
    ).toBe(2);
    await expect(
      service.updateCampaign(eventId, c.id, owner, 'organizer', {
        subject: 'changed',
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      service.finalizeSend(eventId, c.id, owner, 'organizer', randomUUID()),
    ).rejects.toMatchObject({ status: 409 });
    const other = await draft();
    await expect(
      service.finalizeSend(eventId, other.id, owner, 'organizer', key),
    ).rejects.toMatchObject({ status: 409 });
    const stored = await db.communicationCampaign.findUniqueOrThrow({
      where: { id: c.id },
    });
    expect(stored.htmlContent).toBe('');
    expect(stored.contentEncrypted).not.toContain('Conteúdo');
    expect(stored.envelopeEncrypted).not.toContain('<p>');
  });
  it('serializes edit/upload with final send, making snapshot immutable', async () => {
    await registration();
    const c = await draft();
    const result = await Promise.allSettled([
      service.finalizeSend(eventId, c.id, owner, 'organizer', randomUUID()),
      service.updateCampaign(eventId, c.id, owner, 'organizer', {
        subject: 'changed',
      }),
    ]);
    expect(result[0].status).toBe('fulfilled');
    const saved = await db.communicationCampaign.findUniqueOrThrow({
      where: { id: c.id },
    });
    const envelope = JSON.parse(decryptCredential(saved.envelopeEncrypted!));
    expect(envelope.subject).toBe(saved.subject);
    await expect(
      files.initiateUpload(eventId, c.id, owner, 'organizer', {
        filename: 'a.txt',
        mimeType: 'text/plain',
        sizeBytes: 1,
        checksum: '0'.repeat(64),
        totalChunks: 1,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('encrypts chunks once, validates final upload and sends only to authenticated DB email with native attachments', async () => {
    const c = await draft();
    const b = Buffer.from('sensitive fixture');
    const checksum = calculateChecksum(b);
    const f = await files.initiateUpload(eventId, c.id, owner, 'organizer', {
      filename: 'ação.txt',
      mimeType: 'text/plain',
      sizeBytes: b.length,
      checksum,
      totalChunks: 1,
    });
    const dto = { dataBase64: b.toString('base64'), chunkIndex: 0, checksum };
    await Promise.all([
      files.uploadChunk(eventId, c.id, owner, 'organizer', f.attachmentId, dto),
      files.uploadChunk(eventId, c.id, owner, 'organizer', f.attachmentId, dto),
    ]);
    const chunk = await db.communicationAttachmentChunk.findFirstOrThrow({
      where: { attachmentId: f.attachmentId },
    });
    expect(chunk.dataBase64).not.toBe(dto.dataBase64);
    await expect(
      files.uploadChunk(eventId, c.id, owner, 'organizer', f.attachmentId, {
        ...dto,
        dataBase64: Buffer.from('different fixture').toString('base64'),
        checksum: calculateChecksum(Buffer.from('different fixture')),
      }),
    ).rejects.toThrow();
    await files.finalizeUpload(
      eventId,
      c.id,
      owner,
      'organizer',
      f.attachmentId,
    );
    expect(
      await db.communicationAttachmentChunk.count({
        where: { attachmentId: f.attachmentId },
      }),
    ).toBe(0);
    expect(
      (
        await files.downloadAttachment(
          eventId,
          c.id,
          owner,
          'organizer',
          f.attachmentId,
        )
      ).buffer,
    ).toEqual(b);
    const detail = await service.getCampaign(eventId, c.id, owner, 'organizer');
    expect(() => JSON.stringify(detail)).not.toThrow();
    expect(JSON.stringify(detail)).not.toContain('encryptedPayload');
    await expect(
      service.sendTestEmail(
        eventId,
        c.id,
        owner,
        'organizer',
        'other@example.com',
      ),
    ).rejects.toMatchObject({ status: 403 });
    await service.sendTestEmail(eventId, c.id, owner, 'organizer');
    const m = send.mock.calls[0][0];
    expect(m.to).toEqual([`${owner}@example.com`]);
    expect(m.reply_to).toBe(`${owner}@example.com`);
    expect(m.attachments).toHaveLength(2);
    expect(m.attachments[1].content).toBe(b.toString('base64'));
    expect(m.html).toContain('&lt;script&gt;');
  });
  it('serializes concurrent aggregate upload limits and validates chunk sizing', async () => {
    const c = await draft();
    const make = () =>
      files.initiateUpload(eventId, c.id, owner, 'organizer', {
        filename: 'x.txt',
        mimeType: 'text/plain',
        sizeBytes: 6 * 1024 * 1024,
        checksum: 'a'.repeat(64),
        totalChunks: 12,
      });
    const r = await Promise.allSettled([make(), make()]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const f = await db.communicationAttachment.findFirstOrThrow({
      where: { campaignId: c.id },
    });
    await expect(
      files.uploadChunk(eventId, c.id, owner, 'organizer', f.id, {
        dataBase64: 'YQ==',
        chunkIndex: 0,
        checksum: calculateChecksum(Buffer.from('a')),
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      files.finalizeUpload(eventId, c.id, owner, 'organizer', f.id),
    ).rejects.toMatchObject({ status: 400 });
  });
  it('claims each recipient once concurrently and fences stale acceptance after lease loss', async () => {
    const c = await queue();
    const claims = await Promise.all([worker.claim(), worker.claim()]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const r = claims.find(Boolean)!;
    await db.communicationRecipient.update({
      where: { id: r.id },
      data: { leaseExpiresAt: new Date(0) },
    });
    const next = await worker.claim();
    expect(next?.leaseId).not.toBe(r.leaseId);
    expect(
      (
        await db.communicationRecipient.updateMany({
          where: { id: r.id, leaseId: r.leaseId, status: 'processing' },
          data: { providerId: 'stale' },
        })
      ).count,
    ).toBe(0);
    expect((await recipient(c.id)).attempts).toBe(2);
  });
  it('respects deadline, missing Resend and current eligibility without transport', async () => {
    const c = await queue();
    await worker.processBatch(Date.now() + 1000);
    expect(send).not.toHaveBeenCalled();
    expect((await recipient(c.id)).attempts).toBe(0);
    const disabled = new CommunicationsProcessor(
      db,
      { configured: () => false } as CommunicationsGateway,
      files,
    );
    await disabled.processBatch();
    expect((await recipient(c.id)).status).toBe('queued');
    const r = await recipient(c.id);
    await db.registration.update({
      where: { id: r.registrationId },
      data: { status: 'cancelled' },
    });
    await worker.processBatch();
    expect(send).not.toHaveBeenCalled();
    expect((await recipient(c.id)).status).toBe('skipped');
    expect(
      (await service.getCampaign(eventId, c.id, owner, 'organizer'))
        .allDelivered,
    ).toBe(false);
  });
  it('uses stable recipient key across temporary failures, backoff, and max five attempts', async () => {
    const c = await queue();
    send.mockRejectedValue(new DeliveryError(true, 'HTTP_503'));
    await worker.processBatch();
    const r = await recipient(c.id);
    expect(r.attempts).toBe(1);
    expect(r.status).toBe('queued');
    expect(r.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 50000);
    await worker.processBatch();
    expect(send).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 4; i++) {
      await db.communicationRecipient.update({
        where: { id: r.id },
        data: { nextAttemptAt: new Date(0) },
      });
      await worker.processBatch();
    }
    expect(send).toHaveBeenCalledTimes(5);
    expect(new Set(send.mock.calls.map((c) => c[1])).size).toBe(1);
    expect((await recipient(c.id)).status).toBe('failed');
  });
  it('fails permanent HTTP errors immediately and never retries uncertain expired submissions', async () => {
    let c = await queue();
    send.mockRejectedValueOnce(new DeliveryError(false, 'HTTP_422'));
    await worker.processBatch();
    expect((await recipient(c.id)).status).toBe('failed');
    expect((await recipient(c.id)).attempts).toBe(1);
    c = await queue();
    await db.communicationRecipient.updateMany({
      where: { campaignId: c.id },
      data: {
        status: 'processing',
        attempts: 1,
        firstAttemptAt: new Date(Date.now() - 24 * 3600000),
        leaseExpiresAt: new Date(0),
      },
    });
    send.mockClear();
    await worker.processBatch();
    expect(send).not.toHaveBeenCalled();
    expect((await recipient(c.id)).status).toBe('failed');
  });
  it('persists early webhook and reconciles acceptance without losing delivery; out-of-order events do not downgrade', async () => {
    const c = await queue();
    const providerId = `provider-${randomUUID()}`;
    send.mockImplementationOnce(async () => {
      await event(providerId, 'email.delivered');
      await worker.reconcileWebhooks();
      return providerId;
    });
    await worker.processBatch();
    expect((await recipient(c.id)).status).toBe('delivered');
    await event(providerId, 'email.sent', -10000);
    await event(providerId, 'email.delivery_delayed', -5000);
    await event(providerId, 'email.bounced', 1000);
    await event(providerId, 'email.complained', 2000);
    await Promise.all([worker.reconcileWebhooks(), worker.reconcileWebhooks()]);
    expect((await recipient(c.id)).status).toBe('delivered');
    expect(
      await db.communicationWebhookEvent.count({
        where: { providerId, processedAt: { not: null } },
      }),
    ).toBe(5);
    expect(
      (await service.getCampaign(eventId, c.id, owner, 'organizer'))
        .allDelivered,
    ).toBe(true);
  });
  it('does not resend accepted or delayed, marks no-confirmation at24h and accepts late correction', async () => {
    const c = await queue();
    await worker.processBatch();
    const r = await recipient(c.id);
    await event(r.providerId!, 'email.delivery_delayed');
    await worker.reconcileWebhooks();
    expect((await recipient(c.id)).status).toBe('delayed');
    send.mockClear();
    await worker.processBatch();
    expect(send).not.toHaveBeenCalled();
    await db.communicationRecipient.update({
      where: { id: r.id },
      data: {
        firstAttemptAt: new Date(Date.now() - 25 * 3600000),
        acceptedAt: new Date(Date.now() - 25 * 3600000),
      },
    });
    await worker.expire();
    expect((await recipient(c.id)).status).toBe('unconfirmed_after24h');
    await event(r.providerId!, 'email.delivered');
    await worker.reconcileWebhooks();
    expect((await recipient(c.id)).status).toBe('delivered');
  });
  it('allDelivered requires every original snapshot recipient including skipped ones', async () => {
    await registration();
    await registration();
    const c = await draft();
    await service.finalizeSend(eventId, c.id, owner, 'organizer', randomUUID());
    const rows = await db.communicationRecipient.findMany({
      where: { campaignId: c.id },
    });
    await db.communicationRecipient.update({
      where: { id: rows[0].id },
      data: { status: 'delivered' },
    });
    await db.communicationRecipient.update({
      where: { id: rows[1].id },
      data: { status: 'skipped' },
    });
    await worker.refreshCampaign(c.id);
    expect(
      (await service.getCampaign(eventId, c.id, owner, 'organizer'))
        .allDelivered,
    ).toBe(false);
  });
  it('cleans abandoned uploads and only terminal retained attachments without pending recipients', async () => {
    const c = await draft(),
      old = new Date(Date.now() - 31 * 24 * 3600000);
    const create = (status: 'ready' | 'uploading') =>
      db.communicationAttachment.create({
        data: {
          campaignId: c.id,
          filename: 'x.txt',
          mimeType: 'text/plain',
          sizeBytes: 1,
          checksum: 'a'.repeat(64),
          totalChunks: 1,
          status,
          expiresAt: new Date(0),
          uploadedAt: old,
          encryptedPayload: encryptCredential('eA=='),
        },
      });
    const upload = await create('uploading');
    await files.cleanup();
    expect(
      await db.communicationAttachment.findUnique({ where: { id: upload.id } }),
    ).toBeNull();
    const ready = await create('ready');
    await registration();
    await service.finalizeSend(eventId, c.id, owner, 'organizer', randomUUID());
    await files.cleanup();
    expect(
      await db.communicationAttachment.findUnique({ where: { id: ready.id } }),
    ).not.toBeNull();
    await db.communicationRecipient.updateMany({
      where: { campaignId: c.id },
      data: { status: 'failed' },
    });
    await worker.refreshCampaign(c.id);
    await db.communicationCampaign.update({
      where: { id: c.id },
      data: { sentAt: old },
    });
    await files.cleanup();
    expect(
      await db.communicationAttachment.findUnique({ where: { id: ready.id } }),
    ).not.toBeNull();
    await db.communicationCampaign.update({
      where: { id: c.id },
      data: { completedAt: old },
    });
    await files.cleanup();
    expect(
      await db.communicationAttachment.findUnique({ where: { id: ready.id } }),
    ).toBeNull();
  });
  it('fences actual worker acceptance after lease loss and reuses identical provider key on recovery', async () => {
    const c = await queue();
    send.mockImplementationOnce(async () => {
      const r = await recipient(c.id);
      await db.communicationRecipient.update({
        where: { id: r.id },
        data: {
          leaseId: randomUUID(),
          leaseExpiresAt: new Date(Date.now() + 90000),
        },
      });
      return 'provider-fenced-test';
    });
    await worker.processBatch();
    let r = await recipient(c.id);
    expect(r.providerId).toBeNull();
    expect(r.status).toBe('processing');
    await db.communicationRecipient.update({
      where: { id: r.id },
      data: { leaseExpiresAt: new Date(0) },
    });
    send.mockResolvedValueOnce('provider-fenced-test');
    await worker.processBatch();
    r = await recipient(c.id);
    expect(r.status).toBe('accepted');
    expect(send.mock.calls[0][1]).toBe(send.mock.calls[1][1]);
  });
  it('preserves original snapshots against hard deletion and preserves confirmedOnly on partial edit', async () => {
    const reg = await registration();
    const c = await draft({ confirmedOnly: true });
    await service.updateCampaign(eventId, c.id, owner, 'organizer', {
      subject: 'Updated',
    });
    expect(
      (await service.getCampaign(eventId, c.id, owner, 'organizer'))
        .confirmedOnly,
    ).toBe(true);
    await service.finalizeSend(eventId, c.id, owner, 'organizer', randomUUID());
    await expect(
      db.registration.delete({ where: { id: reg.id } }),
    ).rejects.toMatchObject({ code: 'P2003' });
    expect(
      await db.communicationRecipient.count({ where: { campaignId: c.id } }),
    ).toBe(1);
  });
  it('serializes the five attachment count limit and rejects altered checksum and MIME mismatch', async () => {
    const c = await draft(),
      b = Buffer.from('a'),
      checksum = calculateChecksum(b);
    const make = () =>
      files.initiateUpload(eventId, c.id, owner, 'organizer', {
        filename: 'x.txt',
        mimeType: 'text/plain',
        sizeBytes: 1,
        checksum,
        totalChunks: 1,
      });
    const results = await Promise.allSettled(Array.from({ length: 6 }, make));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
    await expect(
      files.initiateUpload(eventId, c.id, owner, 'organizer', {
        filename: 'x.png',
        mimeType: 'application/pdf',
        sizeBytes: 1,
        checksum,
        totalChunks: 1,
      }),
    ).rejects.toMatchObject({ status: 400 });
    const f = await db.communicationAttachment.findFirstOrThrow({
      where: { campaignId: c.id },
    });
    await expect(
      files.uploadChunk(eventId, c.id, owner, 'organizer', f.id, {
        chunkIndex: 0,
        dataBase64: b.toString('base64'),
        checksum: '0'.repeat(64),
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
  it('retries a transport acceptance whose database commit fails using the identical key', async () => {
    const c = await queue();
    const transaction = db.$transaction.bind(db);
    // The first transaction claims the recipient; the next persists provider acceptance.
    const spy = vi
      .spyOn(db, '$transaction')
      .mockImplementation(transaction)
      .mockImplementationOnce(transaction)
      .mockRejectedValueOnce(new Error('temporary database outage'));
    try {
      send.mockResolvedValue('provider-commit-recovery');
      await worker.processBatch();
      let r = await recipient(c.id);
      expect(r.status).toBe('queued');
      expect(r.providerId).toBeNull();
      await db.communicationRecipient.update({
        where: { id: r.id },
        data: { nextAttemptAt: new Date(0) },
      });
      await worker.processBatch();
      r = await recipient(c.id);
      expect(r.status).toBe('accepted');
      expect(r.providerId).toBe('provider-commit-recovery');
      expect(send.mock.calls[0][1]).toBe(send.mock.calls[1][1]);
    } finally {
      spy.mockRestore();
    }
  });
  it('selects historical registrations without a category as the general ticket', async () => {
    await db.academicEvent.update({
      where: { id: eventId },
      data: { registrationTypes: [] },
    });
    try {
      const r = await registration('confirmed', 'a', {
        registrationTypeId: null,
      });
      const c = await draft({
        audienceType: CommunicationAudience.categories,
        audienceCategoryIds: ['geral'],
      });
      expect(
        (await service.previewAudience(eventId, c.id, owner, 'organizer'))
          .total,
      ).toBe(1);
      await service.finalizeSend(
        eventId,
        c.id,
        owner,
        'organizer',
        randomUUID(),
      );
      await worker.processBatch();
      expect((await recipient(c.id)).registrationId).toBe(r.id);
      expect(send).toHaveBeenCalledTimes(1);
    } finally {
      await db.academicEvent.update({
        where: { id: eventId },
        data: {
          registrationTypes: [
            { id: 'a', name: 'A', priceInCents: 0 },
            { id: 'b', name: 'B', priceInCents: 0 },
          ],
        },
      });
    }
  });
});
