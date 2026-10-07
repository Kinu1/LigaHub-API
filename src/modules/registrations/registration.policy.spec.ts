import { describe, expect, it } from 'vitest';
import { assertAvailableCapacity, assertRegistrationOpen } from './registration.policy.js';

describe('Política de reserva de vagas', () => {
  const now = new Date('2030-01-01');
  it('deve rejeitar eventos suspensos mesmo com vagas', () => {
    expect(() => assertRegistrationOpen({ status: 'suspended', startsAt: new Date('2030-02-01'), registrationDeadline: null }, now)).toThrow('indisponíveis');
  });
  it('deve encerrar inscrições exatamente no prazo', () => {
    expect(() => assertRegistrationOpen({ status: 'published', startsAt: now, registrationDeadline: null }, now)).toThrow('encerrado');
  });
  it('deve rejeitar ocupação igual à capacidade', () => expect(() => assertAvailableCapacity(1, 1)).toThrow('ocupadas'));
  it('deve permitir reserva quando há vaga', () => expect(() => assertAvailableCapacity(2, 1)).not.toThrow());
});
