import { useQuery } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { lazy, Suspense, useRef, useState } from 'react';
import { api, ApiError, send } from '../api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { formatCpf, money, type Registration } from '../types';
import { Field, Loading, Notice } from '../ui';
const CardCheckout = lazy(() => import('./card-checkout'));
type PaymentBody = {
  method: 'pix' | 'card';
  installments: number;
  cpf: string;
  payerName: string;
  cardToken?: string;
  paymentMethodId?: string;
  issuerId?: string;
};
export function Checkout({
  registration,
  refresh,
}: {
  registration: Registration;
  refresh: () => Promise<unknown>;
}) {
  const [method, setMethod] = useState<'pix' | 'card'>('pix');
  const [cpf, setCpf] = useState(registration.cpf ?? '');
  const [payerName, setPayerName] = useState(registration.name);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [reviewBody, setReviewBody] = useState<PaymentBody>();
  const attempt = useRef<{ key: string; body: PaymentBody } | null>(null);
  const locked = useRef(false);
  const config = useQuery({
    queryKey: ['checkout', registration.id],
    queryFn: () =>
      api<{
        publicKey: string;
        amountInCents: number;
        maxInstallments: number;
        allowedMethods?: ('pix' | 'card')[];
      }>(`/public/registrations/${registration.id}/checkout`),
  });
  const pay = async (body: PaymentBody) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    const current = attempt.current ?? { key: crypto.randomUUID(), body };
    attempt.current = current;
    try {
      await send(
        `/public/registrations/${registration.id}/payments`,
        current.body,
        'POST',
        { 'Idempotency-Key': current.key },
      );
      setUncertain(false);
      setReviewBody(undefined);
      attempt.current = null;
      await refresh().catch(() =>
        setError(
          'Pagamento enviado. Consulte a situação novamente para atualizar a tela.',
        ),
      );
    } catch (e) {
      setError((e as Error).message);
      const unknown = !(e instanceof ApiError) || e.status >= 500;
      setUncertain(unknown);
      if (!unknown) {
        attempt.current = null;
        setReviewBody(undefined);
      }
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  if (config.isPending) return <Loading />;
  if (config.error) return <Notice>{config.error.message}</Notice>;
  return (
    <section className="card">
      <h2>Como você prefere pagar?</h2>
      <p className="muted mt-2 text-sm">
        Confira seus dados e o valor antes de enviar o pagamento.
      </p>
      {error && <Notice>{error}</Notice>}
      {uncertain ? (
        <>
          <Notice>
            Não conseguimos confirmar o resultado da tentativa. Consulte a
            situação ou repita a mesma tentativa, sem alterar os dados.
          </Notice>
          <div className="flex flex-wrap gap-3">
            <Button variant="outline" disabled={busy} onClick={() => refresh()}>
              Consultar resultado
            </Button>
            <Button
              disabled={busy}
              onClick={() => attempt.current && pay(attempt.current.body)}
            >
              Repetir mesma tentativa
            </Button>
          </div>
        </>
      ) : reviewBody ? (
        <div className="mt-5 space-y-4">
          <h2>Revise o pagamento</h2>
          <p>
            {registration.name} · {registration.email}
          </p>
          <p>
            Pagador: {reviewBody.payerName} · CPF {formatCpf(reviewBody.cpf)}
          </p>
          <p className="font-semibold">
            {money(registration.priceInCents)} ·{' '}
            {reviewBody.method === 'pix'
              ? 'Pix'
              : `Cartão em ${reviewBody.installments} parcela(s)`}
          </p>
          {reviewBody.method === 'card' && (
            <p className="muted text-xs">
              O valor acima é o preço base. Confira no formulário do Mercado
              Pago os valores por parcela e eventuais juros.
            </p>
          )}
          <div className="flex gap-3">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setReviewBody(undefined)}
            >
              Corrigir
            </Button>
            <Button disabled={busy} onClick={() => pay(reviewBody)}>
              {busy ? 'Enviando…' : 'Confirmar pagamento'}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="my-5 flex gap-3">
            <Button
              variant={method === 'pix' ? 'default' : 'outline'}
              aria-pressed={method === 'pix'}
              onClick={() => {
                setMethod('pix');
                setError('');
              }}
            >
              Pix
            </Button>
            {(!config.data.allowedMethods ||
              config.data.allowedMethods.includes('card')) && (
              <Button
                variant={method === 'card' ? 'default' : 'outline'}
                aria-pressed={method === 'card'}
                onClick={() => {
                  setMethod('card');
                  setError('');
                }}
              >
                Cartão
              </Button>
            )}
          </div>
          <Field
            label="Nome completo do pagador"
            hint="Informe o nome da pessoa responsável por este pagamento."
          >
            <Input
              autoComplete="name"
              value={payerName}
              maxLength={120}
              onChange={(e) => setPayerName(e.target.value)}
            />
          </Field>
          {method === 'pix' ? (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                const normalized = cpf.replace(/\D/g, '');
                if (payerName.trim().length < 2) {
                  setError('Informe o nome completo do pagador.');
                  return;
                }
                if (normalized.length !== 11) {
                  setError('Informe o CPF com 11 dígitos.');
                  return;
                }
                setError('');
                setReviewBody({
                  method: 'pix',
                  cpf: normalized,
                  payerName: payerName.trim(),
                  installments: 1,
                });
              }}
            >
              <Field
                label="CPF do pagador"
                hint={
                  registration.cpf
                    ? 'O pagamento deve usar o mesmo CPF do participante.'
                    : 'Necessário para processar o pagamento.'
                }
              >
                <Input
                  inputMode="numeric"
                  autoComplete="off"
                  value={cpf}
                  readOnly={Boolean(registration.cpf)}
                  maxLength={14}
                  onChange={(e) => setCpf(e.target.value)}
                />
              </Field>
              <Button disabled={busy}>Revisar pagamento Pix</Button>
            </form>
          ) : config.data ? (
            <div className="payment-sdk-light">
              <Suspense fallback={<Loading />}>
                <CardCheckout
                  publicKey={config.data.publicKey}
                  key={config.data.publicKey}
                  initialization={{
                    amount: config.data.amountInCents / 100,
                    payer: {
                      email: registration.email,
                      ...(registration.cpf
                        ? {
                            identification: {
                              type: 'CPF',
                              number: registration.cpf,
                            },
                          }
                        : {}),
                    },
                  }}
                  customization={{
                    paymentMethods: {
                      maxInstallments: config.data.maxInstallments,
                    },
                  }}
                  onSubmit={async (data) => {
                    if (
                      registration.cpf &&
                      data.payer.identification?.number?.replace(/\D/g, '') !==
                        registration.cpf
                    ) {
                      setError(
                        'O CPF do pagador deve ser o mesmo CPF do participante.',
                      );
                      return;
                    }
                    if (payerName.trim().length < 2) {
                      setError('Informe o nome completo do pagador.');
                      return;
                    }
                    setReviewBody({
                      method: 'card',
                      cardToken: data.token,
                      paymentMethodId: data.payment_method_id,
                      issuerId:
                        data.issuer_id === undefined
                          ? undefined
                          : String(data.issuer_id),
                      installments: data.installments,
                      payerName: payerName.trim(),
                      cpf: (data.payer.identification?.number || '').replace(
                        /\D/g,
                        '',
                      ),
                    });
                  }}
                  onError={() =>
                    setError(
                      'Não foi possível carregar ou validar o cartão. Verifique os dados e tente novamente.',
                    )
                  }
                />
              </Suspense>
            </div>
          ) : (
            <Loading />
          )}
        </>
      )}
      <p className="muted mt-6 flex items-center gap-2 text-xs">
        <ShieldCheck size={16} />
        Processamento pelo Mercado Pago. A confirmação vem da API.
      </p>
    </section>
  );
}
