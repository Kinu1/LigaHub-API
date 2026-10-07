import { describe, expect, it, vi } from 'vitest';
import { CatalogService } from './catalog.service.js';
import type { PrismaService } from '../../prisma.service.js';
import type { AuthenticatedUser } from '../auth/auth.decorators.js';

describe('Proteção dos dados de eventos com inscrições', () => {
  const actor: AuthenticatedUser = {
    id: 'organizador',
    name: 'Organizador',
    email: 'organizador@teste.com',
    role: 'organizer',
  };
  function setup() {
    const event = {
      id: 'evento',
      ownerId: actor.id,
      title: 'Evento',
      priceInCents: 2500,
      capacity: 10,
      form: [],
      status: 'draft',
      startsAt: null,
      endsAt: null,
      registrationDeadline: null,
    };
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      academicEvent: {
        findUnique: vi.fn().mockResolvedValue(event),
        update: vi.fn().mockResolvedValue(event),
      },
      registration: {
        count: vi.fn().mockResolvedValueOnce(3).mockResolvedValueOnce(2),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: (callback: (transaction: typeof tx) => Promise<unknown>) =>
        callback(tx),
    };
    return {
      service: new CatalogService(prisma as unknown as PrismaService),
      tx,
    };
  }
  it('deve rejeitar mudança de preço após a primeira inscrição', async () => {
    const { service, tx } = setup();
    await expect(
      service.update('evento', { priceInCents: 2600 }, actor),
    ).rejects.toThrow('O preço não pode ser alterado');
    expect(tx.academicEvent.update).not.toHaveBeenCalled();
  });
  it('deve rejeitar mudança de formulário após a primeira inscrição', async () => {
    const { service, tx } = setup();
    await expect(
      service.update(
        'evento',
        {
          form: [{ id: 'curso', label: 'Curso', type: 'text', required: true }],
        },
        actor,
      ),
    ).rejects.toThrow('O formulário não pode ser alterado');
    expect(tx.academicEvent.update).not.toHaveBeenCalled();
  });
  it('deve rejeitar mudança de responsável após a primeira inscrição', async () => {
    const { service, tx } = setup();
    await expect(
      service.update(
        'evento',
        { ownerId: 'outro' },
        { ...actor, role: 'admin' },
      ),
    ).rejects.toThrow('O responsável não pode mudar');
    expect(tx.academicEvent.update).not.toHaveBeenCalled();
  });
  it('deve rejeitar capacidade inferior às vagas ocupadas', async () => {
    const { service, tx } = setup();
    await expect(
      service.update('evento', { capacity: 1 }, actor),
    ).rejects.toThrow('A capacidade não pode ser inferior');
    expect(tx.academicEvent.update).not.toHaveBeenCalled();
  });
  it('deve permitir alteração de título mantendo formulário e preço existentes', async () => {
    const { service, tx } = setup();
    await service.update(
      'evento',
      { title: 'Novo título', form: [], priceInCents: 2500, capacity: 2 },
      actor,
    );
    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    expect(tx.academicEvent.update).toHaveBeenCalledOnce();
    expect(tx.auditLog.create).toHaveBeenCalledOnce();
  });
});
