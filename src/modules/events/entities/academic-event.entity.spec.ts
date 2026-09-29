import { describe, expect, it } from 'vitest';

import {
  AcademicEvent,
  type CreateAcademicEventInput,
} from './academic-event.entity.js';

describe('AcademicEvent', () => {
  const validInput: CreateAcademicEventInput = {
    id: 'event-001',
    title: 'Jornada Acadêmica',
    priceInCents: 3000,
    capacity: 100,
  };

  it('deve criar um evento acadêmico com dados válidos', () => {
    const event = AcademicEvent.create({ ...validInput });

    expect(event.id).toBe('event-001');
    expect(event.title).toBe('Jornada Acadêmica');
    expect(event.priceInCents).toBe(3000);
    expect(event.capacity).toBe(100);
    expect(event.status).toBe('draft');
  });

  it('deve remover espaços em branco do título', () => {
    const event = AcademicEvent.create({
      ...validInput,
      title: '  Jornada Acadêmica  ',
    });

    expect(event.title).toBe('Jornada Acadêmica');
  });

  it('deve aceitar um preço de um centavo e uma capacidade de um participante', () => {
    const event = AcademicEvent.create({
      ...validInput,
      priceInCents: 1,
      capacity: 1,
    });

    expect(event.priceInCents).toBe(1);
    expect(event.capacity).toBe(1);
  });

  it.each(['', '   '])('deve rejeitar um ID vazio: %j', (id) => {
    expect(() =>
      AcademicEvent.create({
        ...validInput,
        id,
      }),
    ).toThrow('o ID do evento é obrigatório.');
  });

  it.each(['', '   '])('deve rejeitar um título vazio: %j', (title) => {
    expect(() =>
      AcademicEvent.create({
        ...validInput,
        title,
      }),
    ).toThrow('O título do evento é obrigatório.');
  });

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'deve rejeitar um preço inválido: %s',
    (priceInCents) => {
      expect(() =>
        AcademicEvent.create({
          ...validInput,
          priceInCents,
        }),
      ).toThrow(
        'O preço do evento deve ser um número inteiro positivo em centavos.',
      );
    },
  );

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'deve rejeitar uma capacidade inválida: %s',
    (capacity) => {
      expect(() =>
        AcademicEvent.create({
          ...validInput,
          capacity,
        }),
      ).toThrow('A capacidade do evento deve ser um número inteiro positivo.');
    },
  );
});
