import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma.service.js';
import type { AcademicEvent } from './entities/academic-event.entity.js';
import { EventsRepository } from './events.repository.js';

@Injectable()
export class PrismaEventsRepository extends EventsRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async create(event: AcademicEvent): Promise<void> {
    await this.prisma.academicEvent.create({
      data: {
        id: event.id,
        title: event.title,
        priceInCents: event.priceInCents,
        capacity: event.capacity,
        status: event.status,
      },
    });
  }
}
