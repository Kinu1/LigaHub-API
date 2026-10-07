import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import type { CreateUserDto } from './dto/create-user.dto.js';
import { User } from './entities/user.entity.js';
import { EmailAlreadyInUseError } from './errors/email-already-in-use.error.js';
import { PasswordHasher } from './password-hasher.js';
import { UserRepository } from './users.repository.js';

@Injectable()
export class UsersService {
  constructor(
    @Inject(UserRepository)
    private readonly usersRepository: UserRepository,

    @Inject(PasswordHasher)
    private readonly passwordHasher: PasswordHasher,
  ) {}

  async create(input: CreateUserDto): Promise<User> {
    const user = User.create({
      id: randomUUID(),
      name: input.name,
      email: input.email,
      role: input.role,
    });

    const passwordLength = Array.from(input.password).length;

    if (passwordLength < 6 || passwordLength > 128) {
      throw new Error('A senha deve ter entre 6 e 128 caracteres.');
    }

    const existingAccount = await this.usersRepository.findByEmail(
      user.email,
    );

    if (existingAccount) {
      throw new EmailAlreadyInUseError();
    }

    const passwordHash = await this.passwordHasher.hash(input.password);

    await this.usersRepository.create(user, passwordHash);

    return user;
  }
}
