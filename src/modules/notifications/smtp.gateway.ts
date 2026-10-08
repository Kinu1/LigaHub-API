import { Injectable } from '@nestjs/common';
import nodemailer from 'nodemailer';
import { EmailGateway, ResendEmailGateway } from './email.gateway.js';
import type { EmailMessage } from './confirmation-email.js';
@Injectable()
export class ConfigurableEmailGateway extends EmailGateway {
  async send(message: EmailMessage, idempotencyKey: string): Promise<string> {
    if (process.env.EMAIL_PROVIDER === 'resend' || (!process.env.EMAIL_PROVIDER && !process.env.SMTP_HOST))
      return new ResendEmailGateway().send(message, idempotencyKey);
    if (!process.env.SMTP_HOST) throw new Error('Configure SMTP_HOST.');
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
        : undefined,
      connectionTimeout: 10_000,
      socketTimeout: 15_000,
    });
    try {
      const result = await transport.sendMail({
        ...message,
        messageId: `<${idempotencyKey.replace(/[^a-zA-Z0-9_-]/g, '-')}@ligahub.local>`,
      });
      return String(result.messageId);
    } finally {
      transport.close();
    }
  }
}
