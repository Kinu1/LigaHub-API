import 'reflect-metadata';
import { ConflictException } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import type { Context } from 'aws-lambda';
import { initializeLambdaRuntime } from '../config/runtime.config.js';
import type { JobName } from '../modules/jobs/jobs.runner.js';

let application: Promise<INestApplicationContext> | undefined;

async function createContext() {
  await initializeLambdaRuntime();
  const { AppModule } = await import('../app.module.js');
  return NestFactory.createApplicationContext(AppModule, {
    abortOnError: false,
  });
}

export async function runScheduledJob(name: JobName, context: Context) {
  context.callbackWaitsForEmptyEventLoop = false;
  application ??= createContext().catch((error: unknown) => {
    application = undefined;
    throw error;
  });
  const app = await application;
  const remaining = context.getRemainingTimeInMillis();
  if (remaining < 60_000)
    throw new Error('Insufficient time to start scheduled job.');
  const { JobsRunner } = await import('../modules/jobs/jobs.runner.js');
  try {
    return await app.get(JobsRunner).run(name, {
      source: 'scheduler',
      deadline: Date.now() + Math.min(120_000, remaining - 30_000),
    });
  } catch (error) {
    if (error instanceof ConflictException)
      return { routine: name, status: 'skipped', errorCode: 'BUSY' };
    // Rejected execution activates Lambda retries and the execution DLQ.
    throw new Error(`Scheduled ${name} job failed.`);
  }
}
