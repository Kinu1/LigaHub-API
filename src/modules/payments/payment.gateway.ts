import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { ProviderPayment } from './payment-security.js';

export type OAuthToken = { access_token: string; refresh_token?: string; expires_in: number; user_id: number; public_key: string; live_mode?: boolean };
export class PaymentRejectedByProvider extends ServiceUnavailableException {
  constructor() { super('O Mercado Pago recusou os dados de pagamento. Confira os dados e gere um novo token para outra tentativa.'); }
}
export abstract class PaymentGateway {
  abstract exchangeOAuth(input: Record<string, string>): Promise<OAuthToken>;
  abstract merchant(accessToken: string): Promise<{ id: number | string }>;
  abstract createPayment(accessToken: string, idempotencyKey: string, body: Record<string, unknown>): Promise<ProviderPayment>;
  abstract getPayment(accessToken: string, id: string): Promise<ProviderPayment>;
  abstract searchPayment(accessToken: string, reference: string): Promise<ProviderPayment | null>;
}

@Injectable()
export class MercadoPagoGateway extends PaymentGateway {
  private async request<T>(path: string, accessToken?: string, body?: Record<string, unknown>, idempotencyKey?: string): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`https://api.mercadopago.com${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...(idempotencyKey ? { 'X-Idempotency-Key': idempotencyKey } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(12_000),
      });
    } catch {
      throw new ServiceUnavailableException('Não foi possível consultar o Mercado Pago. Consulte a inscrição antes de tentar novamente.');
    }
    if (!response.ok) {
      if (path === '/v1/payments' && [400, 422].includes(response.status)) throw new PaymentRejectedByProvider();
      throw new ServiceUnavailableException(`O Mercado Pago não concluiu a operação (HTTP ${response.status}). Consulte a inscrição antes de tentar novamente.`);
    }
    try { return await response.json() as T; } catch { throw new ServiceUnavailableException('O Mercado Pago retornou uma resposta inválida.'); }
  }
  async exchangeOAuth(input: Record<string, string>): Promise<OAuthToken> {
    const configuredMode = process.env.MERCADO_PAGO_TEST_MODE ?? 'true';
    if (configuredMode !== 'true' && configuredMode !== 'false') throw new ServiceUnavailableException('Configure MERCADO_PAGO_TEST_MODE como true ou false.');
    const testMode = configuredMode === 'true';
    const token = await this.request<OAuthToken>('/oauth/token', undefined, { ...input, test_token: String(testMode) });
    if (!token.access_token || !token.public_key || !token.user_id || !Number.isFinite(token.expires_in) || token.expires_in <= 0) throw new ServiceUnavailableException('As credenciais retornadas pelo Mercado Pago são inválidas.');
    if (token.live_mode !== undefined && (typeof token.live_mode !== 'boolean' || token.live_mode === testMode)) throw new ServiceUnavailableException('As credenciais retornadas não correspondem ao ambiente de pagamento configurado.');
    return token;
  }
  merchant(accessToken: string): Promise<{ id: number | string }> { return this.request('/users/me', accessToken); }
  createPayment(accessToken: string, key: string, body: Record<string, unknown>): Promise<ProviderPayment> { return this.request('/v1/payments', accessToken, body, key); }
  getPayment(accessToken: string, id: string): Promise<ProviderPayment> { return this.request(`/v1/payments/${encodeURIComponent(id)}`, accessToken); }
  async searchPayment(accessToken: string, reference: string): Promise<ProviderPayment | null> {
    const result = await this.request<{ results: ProviderPayment[] }>(`/v1/payments/search?external_reference=${encodeURIComponent(reference)}&sort=date_created&criteria=desc&limit=2`, accessToken);
    if (!Array.isArray(result.results) || result.results.length > 1) throw new ServiceUnavailableException('Não foi possível reconciliar a tentativa de pagamento com segurança.');
    return result.results[0] ?? null;
  }
}
