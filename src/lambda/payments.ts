import type { Context } from 'aws-lambda';
import { runScheduledJob } from './jobs.js';

export const handler = (_event: unknown, context: Context) =>
  runScheduledJob('payments', context);
