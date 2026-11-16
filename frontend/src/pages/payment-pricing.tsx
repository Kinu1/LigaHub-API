import { money, type PaymentPricing } from '../types';

export function PaymentPricingBreakdown({
  pricing,
  historical = false,
}: {
  pricing: PaymentPricing;
  historical?: boolean;
}) {
  return (
    <div
      className="rounded-xl border border-border p-4"
      aria-label="Composição do pagamento Pix"
    >
      <dl className="space-y-2 text-sm">
        <div className="flex justify-between gap-4">
          <dt>Valor da inscrição</dt>
          <dd className="shrink-0 whitespace-nowrap tabular-nums">
            {money(pricing.registrationAmountInCents)}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt>Taxa de serviço LigaHub</dt>
          <dd className="shrink-0 whitespace-nowrap tabular-nums">
            {money(pricing.platformFeeInCents)}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt>Tarifa de processamento Mercado Pago</dt>
          <dd className="shrink-0 whitespace-nowrap tabular-nums">
            {money(pricing.processingFeeInCents)}
          </dd>
        </div>
        <div className="flex justify-between gap-4 border-t pt-2 text-base font-semibold">
          <dt>
            {historical ? 'Total cobrado no Pix' : 'Total a pagar no Pix'}
          </dt>
          <dd className="shrink-0 whitespace-nowrap tabular-nums">
            {money(pricing.totalInCents)}
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-muted-foreground">
        A taxa LigaHub e a tarifa de processamento são pagas pelo participante e
        já estão incluídas neste total. O organizador recebe o valor da
        inscrição.
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        A tarifa é calculada pela condição cadastrada da conta Mercado Pago, com
        arredondamento em centavos. O total não será aumentado depois de gerar
        este Pix.
      </p>
    </div>
  );
}
