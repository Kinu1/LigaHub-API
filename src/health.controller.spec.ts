import { describe, expect, it, vi } from 'vitest';
import { HealthController } from './health.controller.js';
import type { PrismaService } from './prisma.service.js';

describe('readiness', () => {
  it('does not query the database for liveness and returns 503 without connection details', async () => {
    const transaction = vi
      .fn()
      .mockRejectedValue(new Error('postgres://secret'));
    const controller = new HealthController({
      $transaction: transaction,
    } as unknown as PrismaService);
    expect(controller.health()).toEqual({ status: 'ok' });
    expect(transaction).not.toHaveBeenCalled();
    await expect(controller.ready()).rejects.toMatchObject({
      status: 503,
      message: 'Service unavailable.',
    });
  });

  it('bounds transaction acquisition and statement execution', async () => {
    const execute = vi.fn();
    const query = vi.fn();
    const transaction = vi.fn(async (fn: (tx: unknown) => Promise<void>) =>
      fn({ $executeRawUnsafe: execute, $queryRaw: query }),
    );
    const controller = new HealthController({
      $transaction: transaction,
    } as unknown as PrismaService);
    expect(await controller.ready()).toEqual({ status: 'ready' });
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 2000,
      timeout: 3000,
    });
    expect(execute).toHaveBeenCalledWith(
      "SET LOCAL statement_timeout = '2000ms'",
    );
    expect(query).toHaveBeenCalledTimes(1);
  });
});
