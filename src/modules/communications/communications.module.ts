import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { PrismaModule } from '../../prisma.module.js';
import { CommunicationsController } from './communications.controller.js';
import { CommunicationsService } from './communications.service.js';
import { AttachmentsService } from './attachments.service.js';
import { CommunicationsProcessor } from './communications.processor.js';
import { ResendWebhookController } from './webhook.controller.js';
import { CommunicationsGateway } from './communications.gateway.js';
@Module({
  imports: [PrismaModule],
  controllers: [CommunicationsController, ResendWebhookController],
  providers: [
    CommunicationsService,
    AttachmentsService,
    CommunicationsProcessor,
    CommunicationsGateway,
  ],
  exports: [CommunicationsService, AttachmentsService, CommunicationsProcessor],
})
export class CommunicationsModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply((_req: Request, res: Response, next: NextFunction) => {
        res.setHeader('Cache-Control', 'no-store');
        next();
      })
      .forRoutes(CommunicationsController, ResendWebhookController);
  }
}
