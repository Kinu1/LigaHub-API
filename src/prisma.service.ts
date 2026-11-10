import 'dotenv/config';

import { PrismaPg } from '@prisma/adapter-pg';
import { Injectable, type OnModuleDestroy } from '@nestjs/common';

import { PrismaClient } from './generated/prisma/client.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error('A URL de conexão com o banco não foi configurada.');
    }

    super({
      adapter: new PrismaPg({
        connectionString,
        max: databasePoolMax(),
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 5000,
      }),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

export function databasePoolMax(): number {
  const fallback = process.env.AWS_LAMBDA_FUNCTION_NAME ? 2 : 10;
  const value = Number(process.env.DATABASE_POOL_MAX ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > 20) {
    throw new Error('DATABASE_POOL_MAX must be an integer between 1 and 20.');
  }
  return value;
}
