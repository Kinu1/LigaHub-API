import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';

import { PrismaService } from '../../prisma.service.js';
import { User } from './entities/user.entity.js';
import { EmailAlreadyInUseError } from './errors/email-already-in-use.error.js';
import {
  UserRepository,
  type UserWithCredentials,
} from './users.repository.js';

@Injectable()
export class PrismaUsersRepository extends UserRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async create(user: User, passwordHash: string, actorId?: string): Promise<void> {
    try {
    await this.prisma.$transaction(async (tx) => {
    await tx.user.create({
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        passwordHash,
      },
    });
    await tx.auditLog.create({ data: { actorId, entityType: 'user', entityId: user.id, action: 'user.created', metadata: { role: user.role } } });
    });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = error.meta?.target;
        if (Array.isArray(target) && target.length === 1 && target[0] === 'email') {
          throw new EmailAlreadyInUseError({ cause: error });
        }
      }
      throw error;
    }
  }

  async findByEmail(email: string): Promise<UserWithCredentials | null> {
    const normalizedEmail = email.trim().toLowerCase();

    const record = await this.prisma.user.findUnique({
      where: {
        email: normalizedEmail,
      },
    });

    if (!record) {
      return null;
    }

    const user = User.create({
      id: record.id,
      name: record.name,
      email: record.email,
      role: record.role,
    });

    return {
      user,
      passwordHash: record.passwordHash,
    };
  }
}
