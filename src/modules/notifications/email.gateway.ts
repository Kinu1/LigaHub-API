import { Injectable } from '@nestjs/common';
import type { EmailMessage } from './confirmation-email.js';

export abstract class EmailGateway {
  abstract send(message: EmailMessage, idempotencyKey: string): Promise<string>;
}
@Injectable()
export class ResendEmailGateway extends EmailGateway {
  async send(message: EmailMessage, idempotencyKey: string): Promise<string> {
    if (!process.env.RESEND_API_KEY)
      throw new Error('Configure RESEND_API_KEY.');
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error('O provedor não aceitou o e-mail.');
    const result = (await response.json()) as { id?: unknown };
    if (typeof result.id !== 'string' || !result.id)
      throw new Error('O provedor retornou uma resposta inválida.');
    return result.id;
  }
}
