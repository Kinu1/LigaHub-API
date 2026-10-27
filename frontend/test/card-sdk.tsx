import { useState, type ComponentProps } from 'react';
import type { CardPayment as RealCardPayment } from '@mercadopago/sdk-react';

// Carregado exclusivamente pelo alias do Vite de testes de navegador.
export function initMercadoPago() {}

export function CardPayment({
  initialization,
  customization,
  onSubmit,
}: ComponentProps<typeof RealCardPayment>) {
  const [installments, setInstallments] = useState(1);
  const [token] = useState(() => `token-ficticio-${crypto.randomUUID()}`);
  const maximum = customization?.paymentMethods?.maxInstallments ?? 1;
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit({
          token,
          issuer_id: '123',
          payment_method_id: 'master',
          transaction_amount: initialization.amount,
          installments,
          payer: {
            email: initialization.payer?.email,
            identification: { type: 'CPF', number: '12345678909' },
          },
        });
      }}
    >
      <p role="note">Formulário simulado de cartão, exclusivo dos testes.</p>
      <label htmlFor="parcelas-simuladas">Parcelas do cartão de teste</label>
      <select
        id="parcelas-simuladas"
        value={installments}
        onChange={(event) => setInstallments(Number(event.target.value))}
      >
        {Array.from({ length: maximum }, (_, index) => (
          <option key={index + 1} value={index + 1}>
            {index + 1}x
          </option>
        ))}
      </select>
      <button className="btn">Revisar cartão de teste</button>
    </form>
  );
}
