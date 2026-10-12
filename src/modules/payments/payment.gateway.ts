import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { ProviderPayment } from './payment-security.js';
import {
  normalizeOrder,
  orderRequest,
  type PaymentLookup,
  type ProviderApi,
  type ProviderOrder,
} from './payment-orders.js';

export type OAuthToken = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  user_id: number;
  public_key: string;
  live_mode?: boolean;
};
export class PaymentRejectedByProvider extends ServiceUnavailableException {
  constructor(readonly reason = 'invalid_payment_data') {
    super(
      reason === 'invalid_transaction_amount'
        ? 'O Mercado Pago não aceita este valor para o meio de pagamento ou parcelamento escolhido. Escolha outra opção.'
        : 'O Mercado Pago recusou os dados de pagamento. Confira os dados e gere um novo token para outra tentativa.',
    );
  }
}
export abstract class PaymentGateway {
  abstract exchangeOAuth(input: Record<string, string>): Promise<OAuthToken>;
  abstract merchant(
    accessToken: string,
  ): Promise<{ id: number | string; tags?: string[]; site_id?: string }>;
  abstract createPayment(
    accessToken: string,
    idempotencyKey: string,
    body: Record<string, unknown>,
    api?: ProviderApi,
  ): Promise<ProviderPayment>;
  abstract getPayment(
    accessToken: string,
    id: string,
    api?: ProviderApi,
  ): Promise<ProviderPayment>;
  abstract searchPayment(
    accessToken: string,
    reference: string,
    lookup?: PaymentLookup,
  ): Promise<ProviderPayment | null>;
}

@Injectable()
export class MercadoPagoGateway extends PaymentGateway {
  private async request<T>(
    path: string,
    accessToken?: string,
    body?: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`https://api.mercadopago.com${path}`, {
        method: body ? 'POST' : 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          ...(idempotencyKey ? { 'X-Idempotency-Key': idempotencyKey } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(12_000),
      });
    } catch {
      throw new ServiceUnavailableException(
        'Não foi possível consultar o Mercado Pago. Consulte a inscrição antes de tentar novamente.',
      );
    }
    if (!response.ok) {
      if (path === '/v1/payments' && [400, 422].includes(response.status))
        throw new PaymentRejectedByProvider();
      if (path === '/v1/orders' && [400, 422].includes(response.status)) {
        const result = (await response.json().catch(() => null)) as {
          errors?: { code?: string }[];
        } | null;
        // Erros não reconhecidos conservam o resultado incerto e bloqueiam outra cobrança.
        const validationCodes = [
          'invalid_transaction_amount',
          'invalid_payment_method',
          'invalid_card_token',
          'required_properties',
          'property_value',
        ];
        if (
          Array.isArray(result?.errors) &&
          result.errors.length > 0 &&
          result.errors.every((error) =>
            validationCodes.includes(error.code ?? ''),
          )
        )
          throw new PaymentRejectedByProvider(result.errors[0]?.code);
      }
      throw new ServiceUnavailableException(
        `O Mercado Pago não concluiu a operação (HTTP ${response.status}). Consulte a inscrição antes de tentar novamente.`,
      );
    }
    try {
      return (await response.json()) as T;
    } catch {
      throw new ServiceUnavailableException(
        'O Mercado Pago retornou uma resposta inválida.',
      );
    }
  }
  async exchangeOAuth(input: Record<string, string>): Promise<OAuthToken> {
    const configuredMode = process.env.MERCADO_PAGO_TEST_MODE ?? 'true';
    if (configuredMode !== 'true' && configuredMode !== 'false')
      throw new ServiceUnavailableException(
        'Configure MERCADO_PAGO_TEST_MODE como true ou false.',
      );
    const testMode = configuredMode === 'true';
    const token = await this.request<OAuthToken>('/oauth/token', undefined, {
      ...input,
      test_token: String(testMode),
    });
    if (
      !token.access_token ||
      !token.public_key ||
      !token.user_id ||
      !Number.isFinite(token.expires_in) ||
      token.expires_in <= 0
    )
      throw new ServiceUnavailableException(
        'As credenciais retornadas pelo Mercado Pago são inválidas.',
      );
    if (
      token.live_mode !== undefined &&
      (typeof token.live_mode !== 'boolean' || token.live_mode === testMode)
    )
      throw new ServiceUnavailableException(
        'As credenciais retornadas não correspondem ao ambiente de pagamento configurado.',
      );
    return token;
  }
  merchant(
    accessToken: string,
  ): Promise<{ id: number | string; tags?: string[]; site_id?: string }> {
    return this.request('/users/me', accessToken);
  }
  async createPayment(
    accessToken: string,
    key: string,
    body: Record<string, unknown>,
    api: ProviderApi = 'payments',
  ): Promise<ProviderPayment> {
    if (api === 'orders')
      return normalizeOrder(
        await this.request<ProviderOrder>(
          '/v1/orders',
          accessToken,
          orderRequest(body),
          key,
        ),
      );
    return this.request('/v1/payments', accessToken, body, key);
  }
  async getPayment(
    accessToken: string,
    id: string,
    api: ProviderApi = 'payments',
  ): Promise<ProviderPayment> {
    if (api === 'orders')
      return normalizeOrder(
        await this.request<ProviderOrder>(
          `/v1/orders/${encodeURIComponent(id)}`,
          accessToken,
        ),
      );
    return this.request(`/v1/payments/${encodeURIComponent(id)}`, accessToken);
  }
  async searchPayment(
    accessToken: string,
    reference: string,
    lookup?: PaymentLookup,
  ): Promise<ProviderPayment | null> {
    if (lookup?.api === 'orders') {
      const query = new URLSearchParams({
        external_reference: reference,
        type: 'online',
        page_size: '2',
        begin_date: new Date(
          lookup.createdAt.getTime() - 300_000,
        ).toISOString(),
        end_date: new Date().toISOString(),
      });
      const result = await this.request<{
        data: ProviderOrder[];
        paging: { total: string | number };
      }>(`/v1/orders?${query}`, accessToken);
      if (
        !Array.isArray(result.data) ||
        !result.paging ||
        !Number.isSafeInteger(Number(result.paging.total)) ||
        Number(result.paging.total) !== result.data.length ||
        result.data.length > 1
      )
        throw new ServiceUnavailableException(
          'Não foi possível reconciliar a tentativa de pagamento com segurança.',
        );
      if (!result.data.length) return null;
      const payment = normalizeOrder(result.data[0]!);
      if (payment.external_reference !== reference)
        throw new ServiceUnavailableException(
          'A referência da order não corresponde à tentativa.',
        );
      return payment;
    }
    const result = await this.request<{ results: ProviderPayment[] }>(
      `/v1/payments/search?external_reference=${encodeURIComponent(reference)}&sort=date_created&criteria=desc&limit=2`,
      accessToken,
    );
    if (!Array.isArray(result.results) || result.results.length > 1)
      throw new ServiceUnavailableException(
        'Não foi possível reconciliar a tentativa de pagamento com segurança.',
      );
    return result.results[0] ?? null;
  }
}
