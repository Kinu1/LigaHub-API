import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertPixPricingAcknowledged,
  calculatePixPricing,
  quotePixPricing,
} from './pix-pricing.js';
afterEach(() => vi.unstubAllEnvs());
describe('Composição de Pix com taxa LigaHub', () => {
  it('acrescenta R$ 1 e a tarifa percentual sobre o total, preservando o valor do organizador', () => {
    expect(calculatePixPricing(1000, 99, 0)).toMatchObject({
      registrationAmountInCents: 1000,
      platformFeeInCents: 100,
      processingFeeInCents: 11,
      totalInCents: 1111,
    });
    expect(calculatePixPricing(1000, 0, 0)).toMatchObject({
      platformFeeInCents: 100,
      processingFeeInCents: 0,
      totalInCents: 1100,
    });
    expect(calculatePixPricing(1000, 0, 25)).toMatchObject({
      processingFeeInCents: 25,
      totalInCents: 1125,
    });
  });
  it('não aplica taxa a inscrições gratuitas', () => {
    expect(calculatePixPricing(0, 99, 10)).toMatchObject({
      registrationAmountInCents: 0,
      platformFeeInCents: 0,
      processingFeeInCents: 0,
      totalInCents: 0,
    });
  });
  it('encontra o menor total em centavos que preserva inscrição e taxa LigaHub após a tarifa cadastrada', () => {
    for (let base = 1; base < 2000; base += 7)
      for (const bps of [0, 49, 99, 199, 1000])
        for (const fixed of [0, 5]) {
          const p = calculatePixPricing(base, bps, fixed);
          const net = (gross: number) =>
            gross - Math.floor((gross * bps + 5000) / 10000) - fixed;
          expect(net(p.totalInCents)).toBe(base + 100);
          expect(net(p.totalInCents - 1)).toBeLessThan(base + 100);
          expect(p.totalInCents).toBe(base + 100 + p.processingFeeInCents);
        }
  });
  it('recusa tarifas ausentes ou inválidas em vez de assumir isenção', () => {
    vi.stubEnv('MERCADO_PAGO_PIX_FEE_BPS', '');
    vi.stubEnv('MERCADO_PAGO_PIX_FEE_FIXED_CENTS', '0');
    expect(() => quotePixPricing(1000, 'contexto')).toThrow(
      /precisa ser confirmada/,
    );
    vi.stubEnv('MERCADO_PAGO_PIX_FEE_BPS', '0,99');
    expect(() => quotePixPricing(1000, 'contexto')).toThrow();
    expect(() => calculatePixPricing(2_147_483_647, 99, 0)).toThrow();
  });
  it('obriga revisar uma cotação alterada e vincula a revisão à inscrição e à conta', () => {
    vi.stubEnv('MERCADO_PAGO_PIX_FEE_BPS', '99');
    vi.stubEnv('MERCADO_PAGO_PIX_FEE_FIXED_CENTS', '0');
    const p = quotePixPricing(1000, 'inscricao:conta');
    expect(() => assertPixPricingAcknowledged(p, p.pricingToken)).not.toThrow();
    expect(() => assertPixPricingAcknowledged(p)).toThrow();
    expect(() =>
      assertPixPricingAcknowledged(
        quotePixPricing(1000, 'outra:conta'),
        p.pricingToken,
      ),
    ).toThrow();
    vi.stubEnv('MERCADO_PAGO_PIX_FEE_BPS', '0');
    expect(() =>
      assertPixPricingAcknowledged(
        quotePixPricing(1000, 'inscricao:conta'),
        p.pricingToken,
      ),
    ).toThrow();
  });
});
