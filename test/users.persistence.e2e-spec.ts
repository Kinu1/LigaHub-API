import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { User } from '../src/modules/users/entities/user.entity.js';
import { UsersModule } from '../src/modules/users/users.module.js';
import { UserRepository } from '../src/modules/users/users.repository.js';
import { PrismaService } from '../src/prisma.service.js';

describe('Persistência de usuários', () => {
  let moduleRef: TestingModule;
  let repository: UserRepository;
  let prisma: PrismaService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [UsersModule],
    }).compile();

    repository = moduleRef.get(UserRepository);
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('deve salvar e consultar uma conta pelo e-mail normalizado', async () => {
    const id = randomUUID();

    const user = User.create({
      id,
      name: 'Pedro',
      email: `teste-${id}@ligahub.test`,
      role: 'organizer',
    });

    const passwordHash = 'hash-ficticio-usado-apenas-no-teste';

    try {
      await repository.create(user, passwordHash);

      const result = await repository.findByEmail(
        `  ${user.email.toUpperCase()}  `,
      );

      expect(result?.user).toBeInstanceOf(User);
      expect(result?.user).toMatchObject({
        id: user.id,
        name: 'Pedro',
        email: user.email,
        role: 'organizer',
      });
      expect(result?.passwordHash).toBe(passwordHash);
    } finally {
      await prisma.user.deleteMany({
        where: { id },
      });
    }
  });

  it('deve retornar null quando o e-mail não estiver cadastrado', async () => {
    const result = await repository.findByEmail(
      `inexistente-${randomUUID()}@ligahub.test`,
    );

    expect(result).toBeNull();
  });
});