import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MercadoPagoGateway,
  PaymentRejectedByProvider,
} from './payment.gateway.js';

describe('MercadoPagoGateway', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  it('deve enviar credenciais do organizador e a chave de idempotência sem comissão da plataforma', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: 123 }), { status: 201 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const body = {
      transaction_amount: 10,
      payment_method_id: 'pix',
      external_reference: 'tentativa',
    };
    await new MercadoPagoGateway().createPayment(
      'token-organizador',
      'chave-estavel',
      body,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.mercadopago.com/v1/payments',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer token-organizador',
          'X-Idempotency-Key': 'chave-estavel',
        }),
        body: JSON.stringify(body),
      }),
    );
    expect(body).not.toHaveProperty('application_fee');
  });
  it('deve retornar null quando não existe pagamento para a referência', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ results: [] }), { status: 200 }),
        ),
    );
    expect(
      await new MercadoPagoGateway().searchPayment('token', 'tentativa'),
    ).toBeNull();
  });
  it('deve recusar uma referência ambígua com vários pagamentos', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ results: [{ id: 1 }, { id: 2 }] }), {
            status: 200,
          }),
        ),
    );
    await expect(
      new MercadoPagoGateway().searchPayment('token', 'tentativa'),
    ).rejects.toThrow('reconciliar');
  });
  it('deve manter um resultado incerto quando o provedor não responde', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Timeout')));
    await expect(
      new MercadoPagoGateway().createPayment('token', 'chave', {}),
    ).rejects.toThrow('Consulte a inscrição');
  });
  it('deve reconhecer a recusa explícita dos dados de pagamento', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{}', { status: 400 })),
    );
    await expect(
      new MercadoPagoGateway().createPayment('token', 'chave', {}),
    ).rejects.toBeInstanceOf(PaymentRejectedByProvider);
  });
  const validToken = {
    access_token: 'token',
    public_key: 'chave-publica',
    user_id: 456,
    expires_in: 3600,
    refresh_token: 'renovacao',
  };
  it.each(['authorization_code', 'refresh_token'])(
    'deve solicitar credenciais de teste por padrão no fluxo %s',
    async (grantType) => {
      vi.stubEnv('MERCADO_PAGO_TEST_MODE', undefined);
      const fetchMock = vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ ...validToken, live_mode: false }), {
            status: 200,
          }),
        );
      vi.stubGlobal('fetch', fetchMock);
      await new MercadoPagoGateway().exchangeOAuth({ grant_type: grantType });
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.mercadopago.com/oauth/token',
        expect.objectContaining({
          body: JSON.stringify({ grant_type: grantType, test_token: 'true' }),
        }),
      );
    },
  );
  it('deve recusar credenciais reais no ambiente de teste', async () => {
    vi.stubEnv('MERCADO_PAGO_TEST_MODE', 'true');
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ ...validToken, live_mode: true }), {
            status: 200,
          }),
        ),
    );
    await expect(
      new MercadoPagoGateway().exchangeOAuth({
        grant_type: 'authorization_code',
      }),
    ).rejects.toThrow('não correspondem ao ambiente');
  });
  it('deve solicitar credenciais reais somente com configuração explícita', async () => {
    vi.stubEnv('MERCADO_PAGO_TEST_MODE', 'false');
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ...validToken, live_mode: true }), {
          status: 200,
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    await new MercadoPagoGateway().exchangeOAuth({
      grant_type: 'refresh_token',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.mercadopago.com/oauth/token',
      expect.objectContaining({
        body: JSON.stringify({
          grant_type: 'refresh_token',
          test_token: 'false',
        }),
      }),
    );
  });
  it('deve rejeitar configuração de ambiente inválida antes de solicitar credenciais', async () => {
    vi.stubEnv('MERCADO_PAGO_TEST_MODE', 'talvez');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      new MercadoPagoGateway().exchangeOAuth({
        grant_type: 'authorization_code',
      }),
    ).rejects.toThrow('como true ou false');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('deve aceitar respostas sem live_mode para compatibilidade com o provedor', async () => {
    vi.stubEnv('MERCADO_PAGO_TEST_MODE', 'true');
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify(validToken), { status: 200 }),
        ),
    );
    expect(
      await new MercadoPagoGateway().exchangeOAuth({
        grant_type: 'authorization_code',
      }),
    ).toEqual(validToken);
  });
});
