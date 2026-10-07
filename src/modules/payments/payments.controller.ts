import { Body, Controller, Get, Headers, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentUser, Public, Roles, type AuthenticatedUser } from '../auth/auth.decorators.js';
import { PaymentAccountsService } from './payment-accounts.service.js';
import { AuthorizeAccountDto, CreatePaymentDto } from './payment.dto.js';
import { PaymentsService } from './payments.service.js';
import { BadRequestException } from '@nestjs/common';

const registrationIdPipe = new ParseUUIDPipe({ exceptionFactory: () => new BadRequestException('O identificador da inscrição é inválido.') });

@Controller()
export class PaymentsController {
  constructor(@Inject(PaymentsService) private readonly payments: PaymentsService, @Inject(PaymentAccountsService) private readonly accounts: PaymentAccountsService) {}

  @Post('payments/accounts/authorize') @Roles('admin', 'organizer')
  authorize(@CurrentUser() actor: AuthenticatedUser, @Body() input: AuthorizeAccountDto) { return this.accounts.authorize(actor, input.ownerId); }

  @Get('payments/accounts/callback') @Public()
  callback(@Query('state') state: string, @Query('code') code: string) { return this.accounts.callback(state, code); }

  @Get('payments/accounts') @Roles('admin', 'organizer')
  account(@CurrentUser() actor: AuthenticatedUser, @Query('ownerId') ownerId?: string) { return this.accounts.status(actor, ownerId); }

  @Get('public/registrations/:id/checkout') @Public()
  checkout(@Param('id', registrationIdPipe) id: string, @Headers('x-registration-token') token?: string) { return this.payments.checkoutConfig(id, token); }

  @Post('public/registrations/:id/payments') @Public()
  create(@Param('id', registrationIdPipe) id: string, @Headers('x-registration-token') token: string | undefined, @Headers('idempotency-key') key: string | undefined, @Body() input: CreatePaymentDto) { return this.payments.create(id, token, key, input); }

  @Get('public/registrations/:id/payments') @Public()
  participantPayments(@Param('id', registrationIdPipe) id: string, @Headers('x-registration-token') token?: string) { return this.payments.participantPayments(id, token); }

  @Post('payments/webhook') @Public()
  webhook(@Headers('x-signature') signature: string | undefined, @Headers('x-request-id') requestId: string | undefined, @Query('data.id') dataId: string | undefined, @Body() body: unknown) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('O conteúdo da notificação é inválido.');
    const notification = body as { type?: unknown; data?: unknown };
    if (notification.type !== undefined && typeof notification.type !== 'string') throw new BadRequestException('O tipo da notificação é inválido.');
    let bodyId: string | undefined;
    if (notification.data !== undefined) {
      if (!notification.data || typeof notification.data !== 'object' || Array.isArray(notification.data)) throw new BadRequestException('Os dados da notificação são inválidos.');
      const id = (notification.data as { id?: unknown }).id;
      if (id !== undefined) {
        if (typeof id !== 'string' && (typeof id !== 'number' || !Number.isSafeInteger(id))) throw new BadRequestException('O identificador da notificação é inválido.');
        bodyId = String(id);
      }
    }
    return this.payments.webhook(signature, requestId, dataId, bodyId, notification.type);
  }

  @Get('payments') @Roles('admin', 'organizer')
  history(@CurrentUser() actor: AuthenticatedUser, @Query('page') page?: string) {
    if (page !== undefined && (typeof page !== 'string' || !/^\d+$/.test(page))) throw new BadRequestException('A página informada é inválida.');
    const parsed = Number(page ?? 1);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100_000) throw new BadRequestException('A página informada é inválida.');
    return this.payments.history(actor, parsed);
  }
}
