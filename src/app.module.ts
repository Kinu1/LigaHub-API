import { Module } from '@nestjs/common';

import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { EventsModule } from './modules/events/events.module.js';
import { UsersModule } from './modules/users/users.module.js';

@Module({
  imports: [EventsModule, UsersModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}