import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CreateUserDto } from './dto/create-user.dto.js';
import { User } from './entities/user.entity.js';
import type { PasswordHasher } from './password-hasher.js';
import type { UserRepository } from './users.repository.js';
import { UsersService } from './users.service.js';

function createRepositoryMock() {
  return {
    findByEmail: vi
      .fn<UserRepository['findByEmail']>()
      .mockResolvedValue(null),

    create: vi
      .fn<UserRepository['create']>()
      .mockResolvedValue(undefined),
  };
}

function createPasswordHasherMock() {
  return {
    hash: vi
      .fn<PasswordHasher['hash']>()
      .mockResolvedValue('hash-de-teste'),

    verify: vi
      .fn<PasswordHasher['verify']>()
      .mockResolvedValue(false),
  };
}

describe('UsersService', () => {
  let repository: ReturnType<typeof createRepositoryMock>;
  let hasher: ReturnType<typeof createPasswordHasherMock>;
  let service: UsersService;

  const validInput: CreateUserDto = {
    name: '  Pedro  ',
    email: '  PEDRO@LigaHub.com  ',
    password: '  Uma senha longa para o teste  ',
    role: 'organizer',
  };

  beforeEach(() => {
    repository = createRepositoryMock();
    hasher = createPasswordHasherMock();

    service = new UsersService(repository, hasher);
  });

  it('deve cadastrar uma conta utilizando o hash da senha', async () => {
    const user = await service.create(validInput);

    expect(user.id).not.toBe('');
    expect(user.name).toBe('Pedro');
    expect(user.email).toBe('pedro@ligahub.com');
    expect(user.role).toBe('organizer');

    expect(repository.findByEmail).toHaveBeenCalledWith(
      'pedro@ligahub.com',
    );

    expect(hasher.hash).toHaveBeenCalledWith(validInput.password);

    expect(repository.create).toHaveBeenCalledWith(
      user,
      'hash-de-teste',
    );

    expect(user).not.toHaveProperty('password');
    expect(user).not.toHaveProperty('passwordHash');
  });

  it('deve rejeitar um e-mail já cadastrado antes de gerar o hash', async () => {
    const existingUser = User.create({
      id: 'user-existing',
      name: 'Pedro',
      email: 'pedro@ligahub.com',
      role: 'organizer',
    });

    repository.findByEmail.mockResolvedValue({
      user: existingUser,
      passwordHash: 'hash-existente',
    });

    await expect(service.create(validInput)).rejects.toThrow(
      'Já existe uma conta com este e-mail.',
    );

    expect(hasher.hash).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
  });

  it.each([
    '',
    'a'.repeat(5),
    'a'.repeat(129),
    '🔐'.repeat(5),
  ])(
    'deve rejeitar uma senha com tamanho inválido: %j',
    async (password) => {
      await expect(
        service.create({
          ...validInput,
          password,
        }),
      ).rejects.toThrow('A senha deve ter entre 6 e 128 caracteres.');

      expect(repository.findByEmail).not.toHaveBeenCalled();
      expect(hasher.hash).not.toHaveBeenCalled();
      expect(repository.create).not.toHaveBeenCalled();
    },
  );

  it.each([6, 128])(
    'deve aceitar uma senha com %s caracteres',
    async (length) => {
      await service.create({
        ...validInput,
        password: 'a'.repeat(length),
      });

      expect(repository.create).toHaveBeenCalledTimes(1);
    },
  );

  it('deve rejeitar uma conta inválida antes de consultar o repositório', async () => {
    await expect(
      service.create({
        ...validInput,
        name: '   ',
      }),
    ).rejects.toThrow('O nome do usuário é obrigatório.');

    expect(repository.findByEmail).not.toHaveBeenCalled();
    expect(hasher.hash).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('não deve gravar a conta quando a geração do hash falhar', async () => {
    const error = new Error('Não foi possível proteger a senha.');

    hasher.hash.mockRejectedValue(error);

    await expect(service.create(validInput)).rejects.toBe(error);

    expect(repository.create).not.toHaveBeenCalled();
  });

  it('deve propagar uma falha ao gravar a conta', async () => {
    const error = new Error('Não foi possível salvar a conta.');

    repository.create.mockRejectedValue(error);

    await expect(service.create(validInput)).rejects.toBe(error);
  });
});