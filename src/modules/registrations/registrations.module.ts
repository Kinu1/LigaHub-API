import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma.module.js';
import { RegistrationsService } from './registrations.service.js';
import { RegistrationsController } from './registrations.controller.js';
import { RegistrationAccessController } from './access.controller.js';
import { RegistrationAccessService } from './access.service.js';
import { NotificationsModule } from '../notifications/notifications.module.js';

@Module({
  imports: [PrismaModule, NotificationsModule],
  providers: [RegistrationsService, RegistrationAccessService],
  controllers: [RegistrationsController, RegistrationAccessController],
  exports: [RegistrationsService],
})
export class RegistrationsModule {}
