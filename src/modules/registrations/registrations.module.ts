import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma.module.js';
import { RegistrationsService } from './registrations.service.js';
import { RegistrationsController } from './registrations.controller.js';

@Module({
  imports: [PrismaModule],
  providers: [RegistrationsService],
  controllers: [RegistrationsController],
  exports: [RegistrationsService],
})
export class RegistrationsModule {}
