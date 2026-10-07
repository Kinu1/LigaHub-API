import { describe, expect, it, vi } from 'vitest';
import { CatalogService } from './catalog.service.js';
import type { PrismaService } from '../../prisma.service.js';

describe('Disponibilidade pública do evento', () => {
  const event = {
    id: 'evento',
    publicId: 'link-publico',
    ownerId: 'organizador',
    title: 'Evento de teste',
    status: 'published',
    capacity: 10,
    startsAt: new Date(Date.now() + 86_400_000),
    registrationDeadline: null,
    description: '',
    location: '',
    endsAt: null,
    priceInCents: 2500,
    form: [],
    reservationMinutes: 15,
    owner: { active: true },
  };
  function setup(
    owner: { active: boolean } | null,
    status = 'published',
    occupied = 0,
  ) {
    const prisma = {
      academicEvent: {
        findUnique: vi.fn().mockResolvedValue({ ...event, owner, status }),
      },
      registration: { count: vi.fn().mockResolvedValue(occupied) },
      paymentAccount: {
        findFirst: vi.fn().mockResolvedValue({ publicKey: 'TEST-publica' }),
      },
    };
    return new CatalogService(prisma as unknown as PrismaService);
  }
  it('deve aceitar inscrições quando o responsável estiver ativo', async () => {
    expect(
      (await setup({ active: true }).publicEvent(event.publicId))
        .acceptingRegistrations,
    ).toBe(true);
  });
  it('deve bloquear inscrições públicas para um responsável inativo mesmo com conta de pagamento ativa', async () => {
    const result = await setup({ active: false }).publicEvent(event.publicId);
    expect(result.publicKey).toBe('TEST-publica');
    expect(result.acceptingRegistrations).toBe(false);
    expect(result).not.toHaveProperty('owner');
  });
  it('deve bloquear inscrições quando não houver responsável', async () => {
    expect(
      (await setup(null).publicEvent(event.publicId)).acceptingRegistrations,
    ).toBe(false);
  });
  it('deve bloquear novas inscrições em eventos suspensos', async () => {
    expect(
      (await setup({ active: true }, 'suspended').publicEvent(event.publicId))
        .acceptingRegistrations,
    ).toBe(false);
  });
  it('deve bloquear novas inscrições quando todas as vagas estiverem ocupadas', async () => {
    const result = await setup({ active: true }, 'published', 10).publicEvent(
      event.publicId,
    );
    expect(result.availableSpots).toBe(0);
    expect(result.acceptingRegistrations).toBe(false);
  });
});
