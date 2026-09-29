import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EventsModule } from '../src/modules/events/events.module.js';
import { EventsService } from '../src/modules/events/events.service.js';
import { PrismaService } from '../src/prisma.service.js';

describe('Persistência de eventos', () => {
  let moduleRef: TestingModule;
  let eventsService: EventsService;
  let prisma: PrismaService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [EventsModule],
    }).compile();

    eventsService = moduleRef.get(EventsService);
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('deve salvar um evento em rascunho no PostgreSQL', async () => {
    const event = await eventsService.create({
      title: '  Jornada Acadêmica  ',
      priceInCents: 3000,
      capacity: 100,
    });

    try {
      const saved = await prisma.academicEvent.findUnique({
        where: { id: event.id },
      });

      expect(saved).toMatchObject({
        id: event.id,
        title: 'Jornada Acadêmica',
        priceInCents: 3000,
        capacity: 100,
        status: 'draft',
      });
    } finally {
      await prisma.academicEvent.delete({
        where: { id: event.id },
      });
    }
  });
});
