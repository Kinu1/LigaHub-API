import { Injectable, ServiceUnavailableException } from '@nestjs/common';
export interface CommunicationsMessage {
  from: string;
  to: string[];
  reply_to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: {
    filename: string;
    content: string;
    content_type: string;
    content_id?: string;
  }[];
}
export class DeliveryError extends Error {
  constructor(
    readonly temporary: boolean,
    readonly code: string,
  ) {
    super(code);
  }
}
@Injectable()
export class CommunicationsGateway {
  configured() {
    return (
      process.env.EMAIL_DELIVERY_ENABLED === 'true' &&
      !!process.env.RESEND_API_KEY &&
      !!process.env.EMAIL_FROM
    );
  }
  async send(message: CommunicationsMessage, key: string): Promise<string> {
    if (!this.configured())
      throw new ServiceUnavailableException(
        'Comunicações Resend indisponíveis.',
      );
    let response: Response;
    try {
      response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': key,
        },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(12000),
      });
    } catch {
      throw new DeliveryError(true, 'NETWORK_UNCERTAIN');
    }
    if (!response.ok) {
      let concurrent = false;
      if (response.status === 409) {
        try {
          const body = (await response.json()) as { name?: string };
          concurrent = body.name === 'concurrent_idempotent_requests';
        } catch {
          /* HTTP status remains authoritative. */
        }
      }
      throw new DeliveryError(
        concurrent ||
          [408, 425, 429].includes(response.status) ||
          response.status >= 500,
        concurrent ? 'HTTP_409_CONCURRENT' : `HTTP_${response.status}`,
      );
    }
    try {
      const body = (await response.json()) as { id?: unknown };
      if (typeof body.id !== 'string' || !body.id) throw new Error();
      return body.id;
    } catch {
      throw new DeliveryError(true, 'INVALID_ACCEPTANCE_UNCERTAIN');
    }
  }
}
