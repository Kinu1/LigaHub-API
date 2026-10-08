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
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { RegistrationsModule } from './modules/registrations/registrations.module.js';
import { PaymentsModule } from './modules/payments/payments.module.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';

@Module({
  imports: [
    EventsModule,
    UsersModule,
    AuthModule,
    CatalogModule,
    RegistrationsModule,
    PaymentsModule,
    AdminModule,
    NotificationsModule,
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useExisting: JwtAuthGuard },
    { provide: APP_GUARD, useExisting: RolesGuard },
  ],
})
export class AppModule {}
