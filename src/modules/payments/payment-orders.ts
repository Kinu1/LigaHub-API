import { ServiceUnavailableException } from '@nestjs/common';
import type { ProviderPayment } from './payment-security.js';

export type ProviderApi = 'payments' | 'orders';
export type PaymentLookup = { api: ProviderApi; createdAt: Date };

type OrderTransaction = {
  id: string;
  amount: string;
  paid_amount?: string;
  status: string;
  status_detail: string;
  payment_method: {
    id: string;
    type: string;
    installments?: number;
    qr_code?: string;
    qr_code_base64?: string;
    ticket_url?: string;
  };
};
export type ProviderOrder = {
  id: string;
  type: string;
  external_reference: string;
  user_id: string | number;
  total_amount: string;
  total_paid_amount?: string;
  currency: string;
  country_code?: string;
  status: string;
  status_detail: string;
  last_updated_date: string;
  transactions?: { payments?: OrderTransaction[] };
};

function invalidOrder(): never {
  throw new ServiceUnavailableException(
    'O Mercado Pago retornou uma order que não pode ser reconciliada com segurança.',
  );
}

function amount(value: string): number {
  if (typeof value !== 'string' || !/^\d+\.\d{2}$/.test(value)) invalidOrder();
  const cents = Number(value.replace('.', ''));
  if (!Number.isSafeInteger(cents) || cents <= 0) invalidOrder();
  return cents / 100;
}

// O restante da aplicação conserva seu contrato de pagamento e seus estados.
export function normalizeOrder(order: ProviderOrder): ProviderPayment {
  if (
    !order ||
    typeof order.id !== 'string' ||
    !/^ORD[A-Z0-9]+$/.test(order.id) ||
    order.type !== 'online' ||
    order.currency !== 'BRL' ||
    (order.country_code !== undefined && order.country_code !== 'BRA') ||
    typeof order.external_reference !== 'string' ||
    !/^\d+$/.test(String(order.user_id)) ||
    !Number.isFinite(Date.parse(order.last_updated_date))
  )
    invalidOrder();
  const total = amount(order.total_amount);
  const payments = order.transactions?.payments;
  if (!Array.isArray(payments) || payments.length > 1) invalidOrder();
  const transaction = payments[0];
  const pendingDetails = !transaction;
  if (pendingDetails && !['created', 'processing'].includes(order.status))
    invalidOrder();
  if (
    transaction &&
    (!transaction.id ||
      !transaction.payment_method ||
      amount(transaction.amount) !== total)
  )
    invalidOrder();
  const status = transaction?.status ?? order.status;
  const detail = transaction?.status_detail ?? order.status_detail;
  let normalizedStatus: string;
  switch (status) {
    case 'processed':
      if (
        order.status !== 'processed' ||
        !['accredited', 'partially_refunded'].includes(detail)
      )
        invalidOrder();
      normalizedStatus =
        detail === 'partially_refunded' ? 'in_mediation' : 'approved';
      if (
        normalizedStatus === 'approved' &&
        (amount(order.total_paid_amount ?? '') < total ||
          amount(transaction?.paid_amount ?? '') < total)
      )
        invalidOrder();
      break;
    case 'created':
    case 'processing':
      normalizedStatus = 'in_process';
      break;
    case 'action_required':
      if (
        ![
          'waiting_payment',
          'waiting_capture',
          'waiting_transfer',
          'pending_challenge',
          'waiting_retry',
        ].includes(detail)
      )
        invalidOrder();
      normalizedStatus =
        detail === 'waiting_capture' ? 'authorized' : 'pending';
      break;
    case 'failed':
      normalizedStatus = 'rejected';
      break;
    case 'canceled':
    case 'expired':
      normalizedStatus = 'cancelled';
      break;
    case 'refunded':
      if (order.status !== 'refunded') invalidOrder();
      normalizedStatus = 'refunded';
      break;
    case 'charged_back':
      normalizedStatus = 'charged_back';
      break;
    default:
      invalidOrder();
  }
  const method = transaction?.payment_method;
  return {
    id: order.id,
    external_reference: order.external_reference,
    collector_id: order.user_id,
    currency_id: order.currency,
    transaction_amount: total,
    status: normalizedStatus,
    status_detail: detail,
    date_last_updated: order.last_updated_date,
    detailsPending: pendingDetails,
    payment_method_id: method?.id,
    payment_type_id: method?.type,
    installments: method?.id === 'pix' ? 1 : method?.installments,
    point_of_interaction: {
      transaction_data: {
        qr_code: method?.qr_code,
        qr_code_base64: method?.qr_code_base64,
        ticket_url: method?.ticket_url,
      },
    },
  };
}

export function orderRequest(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const total = Number(body.transaction_amount).toFixed(2);
  amount(total);
  const pix = body.payment_method_id === 'pix';
  return {
    type: 'online',
    processing_mode: 'automatic',
    total_amount: total,
    external_reference: body.external_reference,
    payer: body.payer,
    ...(pix ? { expiration_time: body.expiration_time } : {}),
    transactions: {
      payments: [
        {
          amount: total,
          payment_method: {
            id: body.payment_method_id,
            type: pix
              ? 'bank_transfer'
              : (body.payment_type_id ?? 'credit_card'),
            ...(!pix
              ? { token: body.token, installments: body.installments }
              : {}),
          },
        },
      ],
    },
  };
}
