import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma.module.js';
import { PaymentAccountsService } from './payment-accounts.service.js';
import { MercadoPagoGateway, PaymentGateway } from './payment.gateway.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [PaymentsController],
  providers: [
    PaymentAccountsService,
    PaymentsService,
    { provide: PaymentGateway, useClass: MercadoPagoGateway },
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
