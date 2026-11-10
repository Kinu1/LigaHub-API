import { afterEach, expect, it, vi } from 'vitest';
import { AccessEmailProcessor } from './access-email.processor.js';
import { EmailOutboxService } from './email-outbox.service.js';
import type { EmailGateway } from './email.gateway.js';
import type { PrismaService } from '../../prisma.service.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it('stops claiming both email queues when the deadline has insufficient margin', async () => {
  vi.stubEnv('EMAIL_DELIVERY_ENABLED', 'true');
  vi.stubEnv('EMAIL_PROVIDER', 'resend');
  vi.stubEnv('RESEND_API_KEY', 'test');
  vi.stubEnv('EMAIL_FROM', 'LigaHub <test@example.com>');
  vi.stubEnv('FRONTEND_URL', 'https://example.com');
  vi.stubEnv(
    'CREDENTIALS_ENCRYPTION_KEY',
    Buffer.alloc(32, 1).toString('base64'),
  );
  const query = vi.fn();
  const prisma = { $queryRaw: query } as unknown as PrismaService;
  const send = vi.fn();
  const gateway = { send } as unknown as EmailGateway;
  const access = new AccessEmailProcessor(prisma, gateway);
  const outbox = new EmailOutboxService(prisma, gateway, access);
  const result = await outbox.processBatch(undefined, Date.now() + 1000);
  expect(result.processed).toBe(0);
  expect(query).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});
