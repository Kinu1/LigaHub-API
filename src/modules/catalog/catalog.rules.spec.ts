import { describe, expect, it } from 'vitest';
import { assertOwnership, validateEventDates } from './catalog.service.js';
import type { AuthenticatedUser } from '../auth/auth.decorators.js';

describe('Regras de gestão dos eventos', () => {
  const actor: AuthenticatedUser = {
    id: 'organizador',
    name: 'Organizador',
    email: 'organizador@teste.com',
    role: 'organizer',
  };
  it('deve permitir que o organizador gerencie seu evento', () => {
    expect(() => assertOwnership({ ownerId: actor.id }, actor)).not.toThrow();
  });
  it('deve rejeitar a gestão de eventos de outro responsável', () => {
    expect(() => assertOwnership({ ownerId: 'outro' }, actor)).toThrow(
      'Você não tem permissão',
    );
  });
  it('deve permitir que o administrador gerencie qualquer evento', () => {
    expect(() =>
      assertOwnership({ ownerId: 'outro' }, { ...actor, role: 'admin' }),
    ).not.toThrow();
  });
  it('deve rejeitar término anterior ao início', () => {
    expect(() =>
      validateEventDates({
        startsAt: new Date('2030-01-02'),
        endsAt: new Date('2030-01-01'),
        registrationDeadline: null,
      }),
    ).toThrow('A data final');
  });
  it('deve rejeitar prazo de inscrição posterior ao início', () => {
    expect(() =>
      validateEventDates({
        startsAt: new Date('2030-01-02'),
        endsAt: null,
        registrationDeadline: new Date('2030-01-03'),
      }),
    ).toThrow('O prazo de inscrição');
  });
});
