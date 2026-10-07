import { describe, expect, it, vi } from 'vitest';
import { ensureBootstrapAdmin } from './bootstrap-admin.service.js';

describe('Inicialização da conta administradora', () => {
  const input = {
    name: 'Pedro',
    email: ' ADMIN@test.com ',
    password: 'senha-do-teste',
  };
  it('deve criar a conta inicial utilizando o serviço de cadastro', async () => {
    const store = { user: { findUnique: vi.fn().mockResolvedValue(null) } };
    const creator = { create: vi.fn().mockResolvedValue({}) };
    expect(await ensureBootstrapAdmin(store, creator, input)).toBe('created');
    expect(creator.create).toHaveBeenCalledWith({
      ...input,
      email: 'admin@test.com',
      role: 'admin',
    });
  });
  it('deve preservar a conta e a senha já existentes', async () => {
    const store = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ role: 'admin', active: true }),
      },
    };
    const creator = { create: vi.fn() };
    expect(await ensureBootstrapAdmin(store, creator, input)).toBe('existing');
    expect(creator.create).not.toHaveBeenCalled();
  });
  it('não deve promover uma conta organizadora existente', async () => {
    const store = {
      user: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ role: 'organizer', active: true }),
      },
    };
    const creator = { create: vi.fn() };
    await expect(ensureBootstrapAdmin(store, creator, input)).rejects.toThrow(
      'O e-mail informado já pertence a uma conta que não é administradora.',
    );
    expect(creator.create).not.toHaveBeenCalled();
  });
  it('não deve reativar silenciosamente uma conta suspensa', async () => {
    const store = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ role: 'admin', active: false }),
      },
    };
    const creator = { create: vi.fn() };
    await expect(ensureBootstrapAdmin(store, creator, input)).rejects.toThrow(
      'A conta administradora já existe e está suspensa. Não foi alterada.',
    );
    expect(creator.create).not.toHaveBeenCalled();
  });
});
