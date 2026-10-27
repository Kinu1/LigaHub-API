import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { JobsRunner } from './jobs.runner.js';

@Injectable()
export class JobsSchedule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobsSchedule.name);
  private emailsTimer?: ReturnType<typeof setInterval>;
  private paymentsTimer?: ReturnType<typeof setInterval>;

  constructor(@Inject(JobsRunner) private readonly runner: JobsRunner) {}

  onModuleInit(): void {
    if (process.env.BACKGROUND_TIMERS_ENABLED === 'false') return;

    // A fila de e-mails roda a cada 15 segundos quando habilitada.
    if (process.env.EMAIL_DELIVERY_ENABLED === 'true') {
      this.emailsTimer = setInterval(() => {
        void this.runner.run('emails', { source: 'timer' }).catch((err) => {
          if (err?.status !== 409) {
            this.logger.warn('Falha na execução periódica da fila de e-mails.');
          }
        });
      }, 15_000);
      this.emailsTimer.unref();
    }

    // Preserva a reconciliação a cada minuto, exceto quando desabilitada.
    if (process.env.PAYMENT_RECONCILIATION_ENABLED !== 'false') {
      this.paymentsTimer = setInterval(() => {
        void this.runner.run('payments', { source: 'timer' }).catch((err) => {
          if (err?.status !== 409) {
            this.logger.warn(
              'Falha na execução periódica da reconciliação de pagamentos.',
            );
          }
        });
      }, 60_000);
      this.paymentsTimer.unref();
    }
  }

  onModuleDestroy(): void {
    if (this.emailsTimer) clearInterval(this.emailsTimer);
    if (this.paymentsTimer) clearInterval(this.paymentsTimer);
  }
}
