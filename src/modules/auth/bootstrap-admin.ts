import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { UsersModule } from '../users/users.module.js';
import { UsersService } from '../users/users.service.js';
import { PrismaService } from '../../prisma.service.js';
import { ensureBootstrapAdmin } from './bootstrap-admin.service.js';

async function bootstrapAdmin(): Promise<void> {
  const name = process.env.BOOTSTRAP_ADMIN_NAME;
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!name || !email || !password)
    throw new Error(
      'Configure BOOTSTRAP_ADMIN_NAME, BOOTSTRAP_ADMIN_EMAIL e BOOTSTRAP_ADMIN_PASSWORD.',
    );
  const app = await NestFactory.createApplicationContext(UsersModule, {
    logger: ['error', 'warn'],
  });
  try {
    const result = await ensureBootstrapAdmin(
      app.get(PrismaService),
      app.get(UsersService),
      { name, email, password },
    );
    console.info(
      result === 'created'
        ? 'Conta administradora criada com sucesso.'
        : 'A conta administradora já existe. Nenhuma credencial foi alterada.',
    );
  } finally {
    await app.close();
  }
}

bootstrapAdmin().catch((error: unknown) => {
  console.error(
    error instanceof Error
      ? error.message
      : 'Não foi possível criar a conta administradora.',
  );
  process.exitCode = 1;
});
