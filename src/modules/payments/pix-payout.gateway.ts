import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createPrivateKey, sign } from 'node:crypto';
import type { PixDestination } from './pix-payout.policy.js';

export type PayoutTransaction = {
  id: string;
  external_reference: string;
  status: string;
  status_detail?: string;
  amount: { currency: string; value: number };
};
export type PayoutCreated = { id: string; transactions: PayoutTransaction[] };

export function payoutsTestMode(): boolean {
  const value = process.env.MERCADO_PAGO_TEST_MODE ?? 'true';
  if (!['true', 'false'].includes(value))
    throw new ServiceUnavailableException('Ambiente de pagamentos inválido.');
  return value === 'true';
}

export function payoutSigningKey() {
  try {
    const key = createPrivateKey(
      Buffer.from(
        process.env.MERCADO_PAGO_PAYOUTS_PRIVATE_KEY_BASE64 ?? '',
        'base64',
      ),
    );
    if (key.asymmetricKeyType !== 'ed25519') throw new Error();
    return key;
  } catch {
    throw new ServiceUnavailableException(
      'Configure a chave privada Ed25519 de Payouts.',
    );
  }
}

@Injectable()
export class PixPayoutGateway {
  preflight(): void {
    if (process.env.MERCADO_PAGO_PAYOUTS_ENABLED !== 'true')
      throw new ServiceUnavailableException(
        'Os repasses automáticos ainda não estão habilitados.',
      );
    if (!payoutsTestMode()) payoutSigningKey();
  }

  body(id: string, amountInCents: number, destination: PixDestination) {
    if (!Number.isSafeInteger(amountInCents) || amountInCents < 100)
      throw new ServiceUnavailableException(
        'O valor não atende ao mínimo de repasse do Mercado Pago.',
      );
    return {
      external_reference: id,
      description: 'Repasse de inscricao LigaHub',
      transactions: [
        {
          type: 'pix',
          pix: { type: destination.keyType, chave: destination.key },
          amount: { currency: 'BRL', value: amountInCents / 100 },
          external_reference: id,
        },
      ],
    };
  }

  async create(
    accessToken: string,
    id: string,
    amountInCents: number,
    destination: PixDestination,
  ): Promise<PayoutCreated> {
    this.preflight();
    const body = JSON.stringify(this.body(id, amountInCents, destination));
    const testMode = payoutsTestMode();
    return this.request('/v1/payouts', accessToken, {
      method: 'POST',
      body,
      headers: {
        'X-Idempotency-Key': id,
        'X-enforce-signature': String(!testMode),
        'X-signature': testMode
          ? 'true'
          : sign(null, Buffer.from(body, 'utf8'), payoutSigningKey()).toString(
              'base64',
            ),
      },
    });
  }

  async transaction(
    accessToken: string,
    payoutId: string,
    transactionId: string,
  ): Promise<PayoutTransaction> {
    if (
      !/^POP[A-Z0-9]+$/.test(payoutId) ||
      !/^TOP[A-Z0-9]+$/.test(transactionId)
    )
      throw new ServiceUnavailableException(
        'Identificadores de repasse inválidos.',
      );
    return this.request(
      `/v1/payouts/${payoutId}/transactions/${transactionId}`,
      accessToken,
    );
  }

  private async request<T>(
    path: string,
    token: string,
    init: {
      method?: string;
      body?: string;
      headers?: Record<string, string>;
    } = {},
  ): Promise<T> {
    try {
      const response = await fetch(`https://api.mercadopago.com${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'X-test-token': String(payoutsTestMode()),
          ...init.headers,
        },
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) throw new Error();
      return (await response.json()) as T;
    } catch {
      // Nunca incorporar o corpo do provedor: pode conter chave Pix ou credenciais.
      throw new ServiceUnavailableException(
        'Não foi possível confirmar a operação de repasse no Mercado Pago.',
      );
    }
  }
}
