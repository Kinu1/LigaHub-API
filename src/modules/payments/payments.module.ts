import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma.module.js';
import { PaymentAccountsService } from './payment-accounts.service.js';
import { MercadoPagoGateway, PaymentGateway } from './payment.gateway.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';
import { PixPayoutGateway } from './pix-payout.gateway.js';
import { PixPayoutsService } from './pix-payouts.service.js';
import { PixDestinationsService } from './pix-destinations.service.js';
import { PixPayoutsController } from './pix-payouts.controller.js';
import { ManualPayoutsService } from './manual-payouts.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [PaymentsController, PixPayoutsController],
  providers: [
    PaymentAccountsService,
    PaymentsService,
    PixPayoutGateway,
    PixPayoutsService,
    PixDestinationsService,
    ManualPayoutsService,
    { provide: PaymentGateway, useClass: MercadoPagoGateway },
  ],
  exports: [PaymentsService, PixPayoutsService],
})
export class PaymentsModule {}
