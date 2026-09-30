import { describe, expect, it } from 'vitest';

import { Argon2PasswordHasher } from './argon2-password-hasher.js';

describe('Argon2PasswordHasher', () => {
  const hasher = new Argon2PasswordHasher();

  it('deve aceitar a senha que originou o hash', async () => {
    const password = 'Uma senha longa usada no teste';
    const passwordHash = await hasher.hash(password);

    const matches = await hasher.verify(password, passwordHash);

    expect(matches).toBe(true);
  });

  it('deve rejeitar uma senha diferente', async () => {
    const passwordHash = await hasher.hash(
      'Uma senha longa usada no teste',
    );

    const matches = await hasher.verify(
      'Outra senha diferente usada no teste',
      passwordHash,
    );

    expect(matches).toBe(false);
  });

  it('deve gerar hashes diferentes para a mesma senha', async () => {
    const password = 'Uma senha longa usada no teste';

    const firstHash = await hasher.hash(password);
    const secondHash = await hasher.hash(password);

    expect(firstHash).not.toBe(secondHash);
    expect(await hasher.verify(password, firstHash)).toBe(true);
    expect(await hasher.verify(password, secondHash)).toBe(true);
  });

  it('deve preservar os espaços da senha', async () => {
    const password = '  Uma senha com espaços  ';
    const passwordHash = await hasher.hash(password);

    expect(await hasher.verify(password, passwordHash)).toBe(true);
    expect(
      await hasher.verify(password.trim(), passwordHash),
    ).toBe(false);
  });
});