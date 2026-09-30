import { describe, expect, it } from 'vitest';

import {
  User,
  type CreateUserInput,
  type UserRole,
} from './user.entity.js';

describe('User', () => {
  const validInput: CreateUserInput = {
    id: 'user-001',
    name: 'Pedro',
    email: 'pedro@ligahub.com',
    role: 'organizer',
  };

  it.each<UserRole>(['admin', 'organizer'])(
    'deve criar um usuário com o papel %s',
    (role) => {
      const user = User.create({
        ...validInput,
        role,
      });

      expect(user.id).toBe('user-001');
      expect(user.name).toBe('Pedro');
      expect(user.email).toBe('pedro@ligahub.com');
      expect(user.role).toBe(role);
    },
  );

  it('deve remover espaços das extremidades e normalizar o e-mail', () => {
    const user = User.create({
      ...validInput,
      id: '  user-001  ',
      name: '  Pedro Silva  ',
      email: '  PEDRO@LigaHub.com  ',
    });

    expect(user.id).toBe('user-001');
    expect(user.name).toBe('Pedro Silva');
    expect(user.email).toBe('pedro@ligahub.com');
  });

  it.each(['', '   '])('deve rejeitar um ID vazio: %j', (id) => {
    expect(() =>
      User.create({
        ...validInput,
        id,
      }),
    ).toThrow('O ID do usuário é obrigatório.');
  });

  it.each(['', '   '])('deve rejeitar um nome vazio: %j', (name) => {
    expect(() =>
      User.create({
        ...validInput,
        name,
      }),
    ).toThrow('O nome do usuário é obrigatório.');
  });

  it.each([
    '',
    '   ',
    'pedro',
    'pedro@',
    '@ligahub.com',
    'pedro @ligahub.com',
  ])('deve rejeitar um e-mail inválido: %j', (email) => {
    expect(() =>
      User.create({
        ...validInput,
        email,
      }),
    ).toThrow('O e-mail do usuário é inválido.');
  });

  it('deve rejeitar um papel que não existe na plataforma', () => {
    expect(() =>
      User.create({
        ...validInput,
        role: 'participant' as UserRole,
      }),
    ).toThrow('O papel do usuário é inválido.');
  });
});