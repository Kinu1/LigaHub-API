import { Module } from '@nestjs/common';
import { EventsController } from './events.controller.js';

@Module({
  controllers: [EventsController],
  // Registrar EventsService junto com a implementação de EventsRepository.
  providers: [],
})
export class EventsModule {}
