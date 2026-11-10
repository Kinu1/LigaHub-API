import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import type { Context } from 'aws-lambda';

const { initialize, create, run, get } = vi.hoisted(() => ({
  initialize: vi.fn(),
  create: vi.fn(),
  run: vi.fn(),
  get: vi.fn(),
}));
vi.mock('../config/runtime.config.js', () => ({
  initializeLambdaRuntime: initialize,
}));
vi.mock('@nestjs/core', () => ({
  NestFactory: { createApplicationContext: create },
}));
vi.mock('../app.module.js', () => ({ AppModule: class {} }));
vi.mock('../modules/jobs/jobs.runner.js', () => ({ JobsRunner: class {} }));
const context = {
  getRemainingTimeInMillis: () => 240_000,
  callbackWaitsForEmptyEventLoop: true,
} as Context;

beforeEach(() => {
  vi.resetModules();
  initialize.mockReset();
  create.mockReset();
  run.mockReset();
  get.mockReset();
  create.mockResolvedValue({ get });
  get.mockReturnValue({ run });
  run.mockResolvedValue({ status: 'completed' });
});
afterEach(() => vi.restoreAllMocks());

describe('native scheduled jobs', () => {
  it('uses the shared runner with a bounded deadline and caches the app', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    const { runScheduledJob } = await import('./jobs.js');
    await runScheduledJob('emails', context);
    await runScheduledJob('payments', context);
    expect(run).toHaveBeenCalledWith('emails', {
      source: 'scheduler',
      deadline: 121_000,
    });
    expect(run).toHaveBeenCalledWith('payments', {
      source: 'scheduler',
      deadline: 121_000,
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('retries a rejected initialization', async () => {
    initialize
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValue(undefined);
    const { runScheduledJob } = await import('./jobs.js');
    await expect(runScheduledJob('emails', context)).rejects.toThrow(
      'unavailable',
    );
    await expect(runScheduledJob('emails', context)).resolves.toEqual({
      status: 'completed',
    });
    expect(initialize).toHaveBeenCalledTimes(2);
  });

  it('treats lease conflicts as BUSY and rejects real failures for retry/DLQ', async () => {
    run
      .mockRejectedValueOnce(new ConflictException())
      .mockRejectedValueOnce(new Error('secret details'));
    const { runScheduledJob } = await import('./jobs.js');
    await expect(runScheduledJob('emails', context)).resolves.toMatchObject({
      status: 'skipped',
      errorCode: 'BUSY',
    });
    await expect(runScheduledJob('emails', context)).rejects.toThrow(
      'Scheduled emails job failed.',
    );
  });

  it('does not claim a batch when the invocation is almost out of time', async () => {
    const { runScheduledJob } = await import('./jobs.js');
    await expect(
      runScheduledJob('emails', {
        ...context,
        getRemainingTimeInMillis: () => 10_000,
      }),
    ).rejects.toThrow('Insufficient time');
    expect(run).not.toHaveBeenCalled();
  });
});
