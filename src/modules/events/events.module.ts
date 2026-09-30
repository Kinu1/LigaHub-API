import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma.module.js';
import { EventsController } from './events.controller.js';
import { EventsRepository } from './events.repository.js';
import { EventsService } from './events.service.js';
import { PrismaEventsRepository } from './prisma-events.repository.js';

@Module({
  imports: [PrismaModule],
  controllers: [EventsController],
  providers: [
    EventsService,
    { provide: EventsRepository, useClass: PrismaEventsRepository },
  ],
})
export class EventsModule {}