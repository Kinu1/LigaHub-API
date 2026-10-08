import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma.module.js';
import { EmailGateway } from './email.gateway.js';
import { ConfigurableEmailGateway } from './smtp.gateway.js';
import { EmailOutboxService } from './email-outbox.service.js';

@Module({
  imports: [PrismaModule],
  providers: [
    EmailOutboxService,
    { provide: EmailGateway, useClass: ConfigurableEmailGateway },
  ],
  exports: [EmailGateway],
})
export class NotificationsModule {}
