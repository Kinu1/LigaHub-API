import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  normalizeOrder,
  orderRequest,
  type ProviderOrder,
} from './payment-orders.js';
import { MercadoPagoGateway } from './payment.gateway.js';
import { PaymentRejectedByProvider } from './payment.gateway.js';
import { assertProviderPayment } from './payment-security.js';

function order(status = 'processed', detail = 'accredited'): ProviderOrder {
  return {
    id: 'ORDTST123',
    type: 'online',
    external_reference: 'tentativa',
    user_id: '456',
    total_amount: '10.25',
    total_paid_amount: '10.25',
    currency: 'BRL',
    country_code: 'BRA',
    status,
    status_detail: detail,
    last_updated_date: new Date().toISOString(),
    transactions: {
      payments: [
        {
          id: 'PAY123',
          amount: '10.25',
          paid_amount: '10.25',
          status,
          status_detail: detail,
          payment_method: {
            id: 'pix',
            type: 'bank_transfer',
            qr_code: 'codigo-pix',
          },
        },
      ],
    },
  };
}

describe('Integração Orders API', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('deve confirmar apenas uma order processada com transação creditada', () => {
    const payment = normalizeOrder(order());
    expect(payment.status).toBe('approved');
    expect(payment.id).toBe('ORDTST123');
    expect(() =>
      assertProviderPayment(payment, 'tentativa', '456', 1025, 'pix', 1),
    ).not.toThrow();
  });
  it.each([
    ['action_required', 'waiting_payment', 'pending'],
    ['action_required', 'pending_challenge', 'pending'],
    ['action_required', 'waiting_capture', 'authorized'],
    ['processing', 'in_process', 'in_process'],
    ['failed', 'cc_rejected_other_reason', 'rejected'],
    ['canceled', 'expired', 'cancelled'],
    ['refunded', 'refunded', 'refunded'],
    ['charged_back', 'settled', 'charged_back'],
    ['processed', 'partially_refunded', 'in_mediation'],
  ])(
    'deve traduzir %s/%s para %s sem aprovar indevidamente',
    (status, detail, expected) => {
      expect(normalizeOrder(order(status, detail)).status).toBe(expected);
    },
  );
  it('deve guardar a identidade da order em processamento sem detalhes de transação', () => {
    const pending = order('processing', 'in_process');
    pending.transactions = { payments: [] };
    const payment = normalizeOrder(pending);
    expect(payment).toMatchObject({
      id: pending.id,
      status: 'in_process',
      detailsPending: true,
    });
    expect(() =>
      assertProviderPayment(payment, 'tentativa', '456', 1025, 'card', 3),
    ).not.toThrow();
    expect(() =>
      assertProviderPayment(payment, 'tentativa', 'outro-vendedor', 1025),
    ).toThrow();
  });
  it.each([
    'currency',
    'total_amount',
    'country_code',
    'user_id',
    'last_updated_date',
    'id',
  ])('deve rejeitar uma order com %s inválido', (field) => {
    const invalid = { ...order(), [field]: 'inválido' };
    expect(() => normalizeOrder(invalid)).toThrow('segurança');
  });
  it('deve rejeitar aprovação sem transação e valores ou estados divergentes', () => {
    const invalid = order();
    invalid.transactions = { payments: [] };
    expect(() => normalizeOrder(invalid)).toThrow();
    const differentAmount = order();
    differentAmount.transactions!.payments![0]!.amount = '1.00';
    expect(() => normalizeOrder(differentAmount)).toThrow();
    const differentStatus = order();
    differentStatus.status = 'processing';
    expect(() => normalizeOrder(differentStatus)).toThrow();
    expect(() => normalizeOrder(order('processed', 'desconhecido'))).toThrow();
    const invalidOrderDetail = order();
    invalidOrderDetail.status_detail = 'desconhecido';
    expect(() => normalizeOrder(invalidOrderDetail)).toThrow();
    const partialOrder = order();
    partialOrder.status_detail = 'partially_refunded';
    expect(normalizeOrder(partialOrder).status).toBe('in_mediation');
  });
  it('deve rejeitar múltiplas transações para uma inscrição', () => {
    const multiple = order();
    multiple.transactions!.payments!.push(multiple.transactions!.payments![0]!);
    expect(() => normalizeOrder(multiple)).toThrow();
  });
  it('deve recusar aprovação com valor creditado insuficiente', () => {
    const insufficient = order();
    insufficient.total_paid_amount = '1.00';
    expect(() => normalizeOrder(insufficient)).toThrow();
    const missing = order();
    delete missing.transactions!.payments![0]!.paid_amount;
    expect(() => normalizeOrder(missing)).toThrow();
  });
  it.each([409, 429, 500])(
    'deve manter o resultado incerto quando Orders responde HTTP %s',
    async (http) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response('{}', { status: http })),
      );
      await expect(
        new MercadoPagoGateway().createPayment(
          'token',
          'chave',
          { transaction_amount: 10 },
          'orders',
        ),
      ).rejects.not.toBeInstanceOf(PaymentRejectedByProvider);
    },
  );
  it('deve distinguir valor recusado de erro desconhecido de Orders', async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ errors: [{ code: 'invalid_transaction_amount' }] }),
          { status: 400 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ errors: [{ code: 'processing_error' }] }),
          { status: 400 },
        ),
      );
    vi.stubGlobal('fetch', mock);
    const gateway = new MercadoPagoGateway();
    await expect(
      gateway.createPayment(
        'token',
        'chave',
        { transaction_amount: 10 },
        'orders',
      ),
    ).rejects.toBeInstanceOf(PaymentRejectedByProvider);
    await expect(
      gateway.createPayment(
        'token',
        'chave',
        { transaction_amount: 10 },
        'orders',
      ),
    ).rejects.not.toBeInstanceOf(PaymentRejectedByProvider);
  });
  it('deve enviar Pix com valor decimal, prazo estável e sem notification_url ou comissão', async () => {
    const mock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify(order('action_required', 'waiting_payment')),
          { status: 201 },
        ),
      );
    vi.stubGlobal('fetch', mock);
    await new MercadoPagoGateway().createPayment(
      'token-vendedor',
      'chave-estavel',
      {
        transaction_amount: 10.25,
        external_reference: 'tentativa',
        payment_method_id: 'pix',
        expiration_time: 'PT1830S',
        payer: { email: 'participante@test.com' },
        notification_url: 'https://exemplo.com',
      },
      'orders',
    );
    const [url, options] = mock.mock.calls[0]!;
    expect(url).toBe('https://api.mercadopago.com/v1/orders');
    expect(options.headers).toMatchObject({
      Authorization: 'Bearer token-vendedor',
      'X-Idempotency-Key': 'chave-estavel',
    });
    const body = JSON.parse(options.body as string);
    expect(body).toMatchObject({
      total_amount: '10.25',
      expiration_time: 'PT1830S',
      transactions: {
        payments: [
          {
            amount: '10.25',
            payment_method: { id: 'pix', type: 'bank_transfer' },
          },
        ],
      },
    });
    expect(body).not.toHaveProperty('notification_url');
    expect(body).not.toHaveProperty('application_fee');
  });
  it('deve preservar o token e o parcelamento do cartão sem dados brutos do cartão', () => {
    const body = orderRequest({
      transaction_amount: 10.25,
      token: 'token-sdk',
      installments: 3,
      payment_method_id: 'master',
      payer: { email: 'teste@test.com' },
    });
    expect(body).toMatchObject({
      transactions: {
        payments: [
          {
            payment_method: {
              id: 'master',
              type: 'credit_card',
              token: 'token-sdk',
              installments: 3,
            },
          },
        ],
      },
    });
    expect(body).not.toHaveProperty('expiration_time');
  });
  it('deve consultar a order pelo seu ID e conservar o QR Code', async () => {
    const mock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify(order('action_required', 'waiting_payment')),
        ),
      );
    vi.stubGlobal('fetch', mock);
    const payment = await new MercadoPagoGateway().getPayment(
      'token',
      'ORDTST123',
      'orders',
    );
    expect(mock.mock.calls[0]![0]).toBe(
      'https://api.mercadopago.com/v1/orders/ORDTST123',
    );
    expect(payment.point_of_interaction?.transaction_data?.qr_code).toBe(
      'codigo-pix',
    );
  });
  it('deve buscar pela referência e por intervalo de criação obrigatório', async () => {
    const mock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ data: [order()], paging: { total: '1' } }),
        ),
      );
    vi.stubGlobal('fetch', mock);
    const createdAt = new Date(Date.now() - 60_000);
    const payment = await new MercadoPagoGateway().searchPayment(
      'token',
      'tentativa',
      { api: 'orders', createdAt },
    );
    expect(payment?.status).toBe('approved');
    const url = new URL(mock.mock.calls[0]![0] as string);
    expect(url.searchParams.get('external_reference')).toBe('tentativa');
    expect(url.searchParams.get('begin_date')).toBe(
      new Date(createdAt.getTime() - 300_000).toISOString(),
    );
    expect(url.searchParams.has('end_date')).toBe(true);
  });
  it.each([
    { data: [order(), order()], paging: { total: '2' } },
    { data: [order()], paging: { total: '2' } },
    {
      data: [{ ...order(), external_reference: 'outra' }],
      paging: { total: '1' },
    },
    { data: [], paging: { total: 'inválido' } },
  ])(
    'deve recusar busca ambígua, truncada ou com referência divergente: %j',
    async (response) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response(JSON.stringify(response))),
      );
      await expect(
        new MercadoPagoGateway().searchPayment('token', 'tentativa', {
          api: 'orders',
          createdAt: new Date(),
        }),
      ).rejects.toThrow();
    },
  );
});
