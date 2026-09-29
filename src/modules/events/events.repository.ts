import type { AcademicEvent } from './entities/academic-event.entity.js';

export abstract class EventsRepository {
  abstract create(event: AcademicEvent): Promise<void>;
}
