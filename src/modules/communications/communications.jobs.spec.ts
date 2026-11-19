import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JobsRunner } from '../jobs/jobs.runner.js';
import { EmailOutboxService } from '../notifications/email-outbox.service.js';
import { CommunicationsProcessor } from './communications.processor.js';
import { CommunicationsGateway } from './communications.gateway.js';
import type { AttachmentsService } from './attachments.service.js';
import type { PrismaService } from '../../prisma.service.js';
import type { PaymentsService } from '../payments/payments.service.js';
import type { EmailGateway } from '../notifications/email.gateway.js';
import type { AccessEmailProcessor } from '../notifications/access-email.processor.js';

describe('communications append to existing email job', () => {
  beforeEach(() => {
    vi.stubEnv('BACKGROUND_JOBS_ENABLED', 'true');
    vi.stubEnv('EMAIL_DELIVERY_ENABLED', 'true');
    vi.stubEnv('EMAIL_PROVIDER', 'smtp');
    vi.stubEnv('SMTP_HOST', 'fake-smtp');
    vi.stubEnv('RESEND_API_KEY', '');
    vi.stubEnv('EMAIL_FROM', 'verified@example.com');
    vi.stubEnv('FRONTEND_URL', 'https://example.com');
    vi.stubEnv(
      'CREDENTIALS_ENCRYPTION_KEY',
      Buffer.alloc(32, 1).toString('base64'),
    );
  });
  afterEach(() => vi.unstubAllEnvs());
  it('processes access then confirmation then communications and propagates the same deadline', async () => {
    const calls: string[] = [],
      deadline = Date.now() + 90000;
    const tx = {
      $queryRaw: vi.fn().mockImplementation(async () => {
        calls.push('confirmation');
        return [];
      }),
    };
    const db = {
      $queryRaw: vi.fn().mockResolvedValue([{ name: 'emails' }]),
      backgroundJob: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      $transaction: vi.fn().mockImplementation(async (fn) => fn(tx)),
    } as unknown as PrismaService;
    const access = {
      processBatch: vi.fn().mockImplementation(async () => {
        calls.push('access');
        return { processed: 0, succeeded: 0, failed: 0, skipped: 0 };
      }),
    } as unknown as AccessEmailProcessor;
    const emails = new EmailOutboxService(db, {} as EmailGateway, access);
    const comms = {
      processBatch: vi.fn().mockImplementation(async () => {
        calls.push('communications');
        return {
          status: 'completed',
          processed: 0,
          succeeded: 0,
          failed: 0,
          skipped: 0,
        };
      }),
    } as unknown as CommunicationsProcessor;
    const runner = new JobsRunner(
      db,
      emails,
      {} as PaymentsService,
      undefined,
      comms,
    );
    await expect(runner.run('emails', { deadline })).resolves.toMatchObject({
      status: 'completed',
    });
    expect(calls).toEqual(['access', 'confirmation', 'communications']);
    expect(comms.processBatch).toHaveBeenCalledWith(deadline);
  });
  it('keeps SMTP jobs working with communications installed and no Resend configured', async () => {
    const db = {
      $queryRaw: vi.fn().mockResolvedValue([{ name: 'emails' }]),
      backgroundJob: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    } as unknown as PrismaService;
    const emails = {
      processBatch: vi.fn().mockResolvedValue({
        status: 'completed',
        processed: 0,
        succeeded: 0,
        failed: 0,
        skipped: 0,
      }),
    } as unknown as EmailOutboxService;
    const maintenanceDb = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      communicationRecipient: { updateMany: vi.fn() },
      communicationCampaign: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaService;
    const attachments = {
      cleanup: vi.fn().mockResolvedValue(undefined),
    } as unknown as AttachmentsService;
    const comms = new CommunicationsProcessor(
      maintenanceDb,
      new CommunicationsGateway(),
      attachments,
    );
    await expect(
      new JobsRunner(db, emails, {} as PaymentsService, undefined, comms).run(
        'emails',
      ),
    ).resolves.toMatchObject({ status: 'completed' });
    expect(attachments.cleanup).toHaveBeenCalled();
  });
});
