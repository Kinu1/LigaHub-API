import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { CreateEventDto } from './dto/create-event.dto.js';
import { AcademicEvent } from './entities/academic-event.entity.js';
import { EventsRepository } from './events.repository.js';

@Injectable()
export class EventsService {
  constructor(
    @Inject(EventsRepository)
    private readonly eventsRepository: EventsRepository,
  ) {}

  async create(input: CreateEventDto): Promise<AcademicEvent> {
    const event = AcademicEvent.create({
      id: randomUUID(),
      title: input.title,
      priceInCents: input.priceInCents,
      capacity: input.capacity,
    });
    await this.eventsRepository.create(event);
    return event;
  }
}
