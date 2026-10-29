import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { PrismaModule } from '../../prisma.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { JobsController } from './jobs.controller.js';
import { JobsGuard } from './jobs.guard.js';
import { JobsRunner } from './jobs.runner.js';
import { JobsSchedule } from './jobs.schedule.js';

@Module({
  imports: [PrismaModule, NotificationsModule, PaymentsModule],
  controllers: [JobsController],
  providers: [JobsGuard, JobsRunner, JobsSchedule],
  exports: [JobsRunner, JobsSchedule],
})
export class JobsModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Antes dos guards globais, inclusive em respostas de limitação de acesso.
    consumer
      .apply((_req: Request, res: Response, next: NextFunction) => {
        res.setHeader('Cache-Control', 'no-store');
        next();
      })
      .forRoutes(JobsController);
  }
}
