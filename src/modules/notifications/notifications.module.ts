import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma.module.js';
import { EmailGateway, ResendEmailGateway } from './email.gateway.js';
import { EmailOutboxService } from './email-outbox.service.js';

@Module({
  imports: [PrismaModule],
  providers: [
    EmailOutboxService,
    { provide: EmailGateway, useClass: ResendEmailGateway },
  ],
})
export class NotificationsModule {}
