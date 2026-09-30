import { Module } from '@nestjs/common';
import { UsersService } from './users.service.js';
import { PrismaModule } from '../../prisma.module.js';
import { Argon2PasswordHasher } from './argon2-password-hasher.js';
import { PasswordHasher } from './password-hasher.js';
import { PrismaUsersRepository } from './prisma-users.repository.js';
import { UserRepository } from './users.repository.js';

@Module({
  imports: [PrismaModule],
  providers: [
    {
      provide: UserRepository,
      useClass: PrismaUsersRepository,
    },
    {
      provide: PasswordHasher,
      useClass: Argon2PasswordHasher,
    },
  ],
  exports: [UsersService, UserRepository, PasswordHasher],
})
export class UsersModule {}