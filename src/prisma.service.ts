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
      adapter: new PrismaPg({ connectionString }),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
