import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma.service.js';
import { User } from './entities/user.entity.js';
import {
  UserRepository,
  type UserWithCredentials,
} from './users.repository.js';

@Injectable()
export class PrismaUsersRepository extends UserRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async create(user: User, passwordHash: string): Promise<void> {
    await this.prisma.user.create({
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        passwordHash,
      },
    });
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