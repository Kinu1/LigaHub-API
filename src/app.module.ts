import { Module } from '@nestjs/common';

import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { EventsModule } from './modules/events/events.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { APP_GUARD, APP_FILTER } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './modules/auth/auth.module.js';
import { JwtAuthGuard, RolesGuard } from './modules/auth/auth.guards.js';
import { ApiExceptionFilter } from './common/http.js';

@Module({
  imports: [EventsModule, UsersModule, AuthModule, ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }])],
  controllers: [AppController],
  providers: [AppService,
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useExisting: JwtAuthGuard },
    { provide: APP_GUARD, useExisting: RolesGuard },
  ],
})
export class AppModule {}
