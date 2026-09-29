import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service.js';
import { EventsController } from './events.controller.js';
import { EventsRepository } from './events.repository.js';
import { EventsService } from './events.service.js';
import { PrismaEventsRepository } from './prisma-events.repository.js';

@Module({
  controllers: [EventsController],
  providers: [
    PrismaService,
    EventsService,
    { provide: EventsRepository, useClass: PrismaEventsRepository },
  ],
})
export class EventsModule {}
