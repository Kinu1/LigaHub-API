import { describe, expect, it } from 'vitest';

import type { AcademicEvent } from './entities/academic-event.entity.js';
import { EventsRepository } from './events.repository.js';
import { EventsService } from './events.service.js';

class InMemoryEventsRepository extends EventsRepository {
  readonly events: AcademicEvent[] = [];

  create(event: AcademicEvent): Promise<void> {
    this.events.push(event);

    return Promise.resolve();
  }
}

describe('EventsService', () => {
  it('deve criar e armazenar um evento em rascunho', async () => {
    const repository = new InMemoryEventsRepository();
    const service = new EventsService(repository);

    const event = await service.create({
      title: '  Jornada Acadêmica  ',
      priceInCents: 3000,
      capacity: 100,
    });

    expect(event.id).not.toBe('');
    expect(event.title).toBe('Jornada Acadêmica');
    expect(event.status).toBe('draft');

    expect(repository.events).toHaveLength(1);
    expect(repository.events[0]).toBe(event);
  });

  it('não deve armazenar um evento com dados inválidos', async () => {
    const repository = new InMemoryEventsRepository();
    const service = new EventsService(repository);

    await expect(
      service.create({
        title: '   ',
        priceInCents: 3000,
        capacity: 100,
      }),
    ).rejects.toThrow('O título do evento é obrigatório.');

    expect(repository.events).toHaveLength(0);
  });

  it('deve propagar uma falha ao armazenar o evento', async () => {
    const persistenceError = new Error(
      'Não foi possível salvar o evento.',
    );

    const repository: EventsRepository = {
      create() {
        return Promise.reject(persistenceError);
      },
    };

    const service = new EventsService(repository);

    await expect(
      service.create({
        title: 'Jornada Acadêmica',
        priceInCents: 3000,
        capacity: 100,
      }),
    ).rejects.toBe(persistenceError);
  });
});
