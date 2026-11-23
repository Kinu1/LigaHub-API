import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { digest } from './payment-security.js';
import type { PaymentAttempt } from '../../generated/prisma/client.js';

export type PixPricing = {
  registrationAmountInCents: number;
  platformFeeInCents: number;
  processingFeeInCents: number;
  totalInCents: number;
  processingRateBps: number;
  processingFixedInCents: number;
  pricingToken: string;
};

function configuredInteger(name: string, max: number): number {
  const raw = process.env[name];
  if (!raw || !/^\d+$/.test(raw) || Number(raw) > max)
    throw new ServiceUnavailableException(
      'A tarifa Pix da conta Mercado Pago precisa ser confirmada e configurada antes de cobrar taxas do participante.',
    );
  return Number(raw);
}

// O valor cobrado inclui a própria tarifa percentual. Arredondamento comercial em centavos.
export function calculatePixPricing(
  base: number,
  bps: number,
  fixed: number,
): Omit<PixPricing, 'pricingToken'> {
  if (
    !Number.isSafeInteger(base) ||
    base < 0 ||
    !Number.isSafeInteger(bps) ||
    bps < 0 ||
    bps >= 10_000 ||
    !Number.isSafeInteger(fixed) ||
    fixed < 0 ||
    fixed > 100_000
  )
    throw new ServiceUnavailableException(
      'A composição do pagamento Pix está inválida.',
    );
  if (base === 0)
    return {
      registrationAmountInCents: 0,
      platformFeeInCents: 0,
      processingFeeInCents: 0,
      totalInCents: 0,
      processingRateBps: bps,
      processingFixedInCents: fixed,
    };
  const platform = 100;
  const subtotal = base + platform;
  const fee = (gross: number) =>
    Math.floor((gross * bps + 5000) / 10_000) + fixed;
  let low = subtotal;
  let high = Math.min(
    2_147_483_647,
    Math.ceil(((subtotal + fixed) * 10_000) / (10_000 - bps)) + 1,
  );
  if (high - fee(high) < subtotal)
    throw new ServiceUnavailableException(
      'O valor total excede o limite permitido.',
    );
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (middle - fee(middle) >= subtotal) high = middle;
    else low = middle + 1;
  }
  return {
    registrationAmountInCents: base,
    platformFeeInCents: platform,
    processingFeeInCents: low - subtotal,
    totalInCents: low,
    processingRateBps: bps,
    processingFixedInCents: fixed,
  };
}

export function quotePixPricing(base: number, context: string): PixPricing {
  const bps = configuredInteger('MERCADO_PAGO_PIX_FEE_BPS', 9999);
  const fixed = configuredInteger('MERCADO_PAGO_PIX_FEE_FIXED_CENTS', 100_000);
  const amounts = calculatePixPricing(base, bps, fixed);
  return {
    ...amounts,
    pricingToken: digest(JSON.stringify({ version: 1, context, ...amounts })),
  };
}

export function assertPixPricingAcknowledged(
  pricing: PixPricing,
  token?: string,
): void {
  if (token !== pricing.pricingToken)
    throw new ConflictException(
      'Os valores do Pix precisam ser revisados. Atualize o pagamento e confirme a composição e o total antes de continuar.',
    );
}

export const organizerPayoutAmount = (
  payment: Pick<PaymentAttempt, 'amountInCents' | 'registrationAmountInCents'>,
) => payment.registrationAmountInCents ?? payment.amountInCents;

export const publicPixPricing = (
  payment: Pick<
    PaymentAttempt,
    | 'amountInCents'
    | 'registrationAmountInCents'
    | 'platformFeeInCents'
    | 'processingFeeInCents'
  >,
) =>
  payment.registrationAmountInCents == null
    ? undefined
    : {
        registrationAmountInCents: payment.registrationAmountInCents,
        platformFeeInCents: payment.platformFeeInCents ?? 0,
        processingFeeInCents: payment.processingFeeInCents ?? 0,
        totalInCents: payment.amountInCents,
      };
