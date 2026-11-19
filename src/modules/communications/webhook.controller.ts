import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Post,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { Webhook } from 'svix';
import { Public } from '../auth/auth.decorators.js';
import { PrismaService } from '../../prisma.service.js';
import { CommunicationsProcessor } from './communications.processor.js';
const supported = new Set([
  'email.sent',
  'email.delivered',
  'email.delivery_delayed',
  'email.bounced',
  'email.complained',
  'email.failed',
  'email.suppressed',
]);
@Controller('notifications/resend')
export class ResendWebhookController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CommunicationsProcessor)
    private readonly processor: CommunicationsProcessor,
  ) {}
  @Post('webhook')
  @Public()
  @HttpCode(200)
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Headers() headers: Record<string, string>,
  ) {
    const secret = process.env.RESEND_WEBHOOK_SECRET;
    if (!secret) throw new ServiceUnavailableException('Webhook indisponível.');
    if (!req.rawBody || req.rawBody.length > 1024 * 1024)
      throw new BadRequestException('Corpo original obrigatório.');
    const id = headers['svix-id'];
    if (!id || id.length > 255) throw new BadRequestException('ID inválido.');
    let payload: {
      type?: string;
      created_at?: string;
      data?: { email_id?: string };
    };
    try {
      payload = new Webhook(secret).verify(
        req.rawBody.toString('utf8'),
        headers,
      ) as typeof payload;
    } catch {
      throw new BadRequestException('Assinatura inválida.');
    }
    if (!payload || typeof payload !== 'object')
      throw new BadRequestException('Payload inválido.');
    // Opens and clicks are intentionally neither stored nor processed.
    if (!payload.type || !supported.has(payload.type))
      return { received: true, ignored: true };
    const providerId = payload.data?.email_id;
    if (
      typeof providerId !== 'string' ||
      !providerId ||
      providerId.length > 255
    )
      throw new BadRequestException('Email ID inválido.');
    const time = new Date(payload.created_at ?? '');
    if (!Number.isFinite(time.getTime()))
      throw new BadRequestException('Data inválida.');
    // Unique svixId and native upsert safely absorb concurrent deliveries.
    const persisted = await this.prisma.communicationWebhookEvent.createMany({
      data: [
        {
          svixId: id,
          eventType: payload.type,
          providerId,
          receivedAt: time,
          payloadJson: {
            type: payload.type,
            created_at: time.toISOString(),
            data: { email_id: providerId },
          },
        },
      ],
      skipDuplicates: true,
    });
    await this.processor.reconcileWebhooks();
    return { received: true, duplicate: persisted.count === 0 };
  }
}
