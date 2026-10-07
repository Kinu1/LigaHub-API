import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma.service.js';
import type { UsersService } from './users.service.js';
import { UsersController } from './users.controller.js';

function transactionMock() {
  return {
    $queryRaw: vi.fn().mockResolvedValue([]),
    user: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ id: 'target', role: 'admin', active: true }),
      count: vi.fn().mockResolvedValue(2),
      update: vi.fn().mockResolvedValue({ id: 'target', active: false }),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
}

describe('UsersController: suspensão de contas', () => {
  let tx: ReturnType<typeof transactionMock>;
  let controller: UsersController;
  const actor = {
    id: 'actor',
    name: 'Admin',
    email: 'admin@test.com',
    role: 'admin' as const,
  };
  beforeEach(() => {
    tx = transactionMock();
    const prisma = {
      $transaction: vi.fn(
        async (operation: (transaction: typeof tx) => unknown) => operation(tx),
      ),
    };
    controller = new UsersController(
      {} as UsersService,
      prisma as unknown as PrismaService,
    );
  });
  it('deve preservar o último administrador ativo', async () => {
    tx.user.count.mockResolvedValue(1);
    await expect(
      controller.status('target', { active: false }, actor),
    ).rejects.toThrow('Não é possível suspender o último administrador ativo.');
    expect(tx.user.update).not.toHaveBeenCalled();
  });
  it('deve revogar sessões e auditar a alteração de estado', async () => {
    await controller.status('target', { active: false }, actor);
    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { active: false, tokenVersion: { increment: 1 } },
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorId: 'actor',
        entityType: 'user',
        entityId: 'target',
        action: 'status_updated',
        metadata: { previousActive: true, active: false },
      },
    });
  });
  it('deve recusar a suspensão da própria conta', async () => {
    await expect(
      controller.status('actor', { active: false }, actor),
    ).rejects.toThrow('Você não pode suspender sua própria conta.');
    expect(tx.user.findUnique).not.toHaveBeenCalled();
  });
  it('deve rejeitar usuário inexistente sem gravar', async () => {
    tx.user.findUnique.mockResolvedValue(null);
    await expect(
      controller.status('target', { active: false }, actor),
    ).rejects.toThrow('Usuário não encontrado.');
    expect(tx.user.update).not.toHaveBeenCalled();
  });
});
