import { useQuery } from '@tanstack/react-query';
import { Copy } from 'lucide-react';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  accessFragment,
  captureAccessFragment,
  forgetAccessFragment,
} from '../access-fragment';
import { api, send } from '../api';
import { Button } from '../components/ui/button';
import { Textarea } from '../components/ui/textarea';
import { money, reviewReasonText, type Registration } from '../types';
import { PaymentPricingBreakdown } from './payment-pricing';
import { Confirm, Heading, Loading, Notice, Status } from '../ui';
import { EventArtwork } from './event-images';
import { Steps } from './public-shared';
const Checkout = lazy(() =>
  import('./checkout').then((m) => ({ default: m.Checkout })),
);
export function ParticipantPage() {
  const { id } = useParams();
  const [token] = useState(() => accessFragment('access'));
  const [accessReady, setAccessReady] = useState(!token);
  const [accessError, setAccessError] = useState('');
  const exchanged = useRef<Promise<unknown> | null>(null);
  useEffect(() => {
    if (!token) return;
    captureAccessFragment();
    exchanged.current ??= send(`/public/registrations/${id}/access`, { token });
    exchanged.current
      .then(() => {
        forgetAccessFragment('access');
        setAccessReady(true);
      })
      .catch((e) => setAccessError((e as Error).message));
  }, [token, id]);
  const query = useQuery({
    queryKey: ['participant', id],
    queryFn: () => api<Registration>(`/public/registrations/${id}`),
    enabled: accessReady,
    refetchInterval: (q) =>
      q.state.data?.payments?.some((p) =>
        [
          'created',
          'pending',
          'in_process',
          'authorized',
          'in_mediation',
        ].includes(p.status),
      )
        ? 10_000
        : false,
    refetchIntervalInBackground: false,
  });
  const registration = query.data;
  if (accessError)
    return (
      <>
        <Notice>{accessError}</Notice>
        <Button asChild>
          <Link to="/recuperar">Solicitar novo link</Link>
        </Button>
      </>
    );
  if (!accessReady || query.isPending) return <Loading />;
  if (query.error)
    return (
      <>
        <Notice>{query.error.message}</Notice>
        <Button asChild>
          <Link to="/recuperar">Solicitar link de acesso</Link>
        </Button>
        <Button
          variant="outline"
          className="ml-3"
          onClick={() => query.refetch()}
        >
          Tentar novamente
        </Button>
      </>
    );
  if (!registration) return null;
  const pending = registration.payments.some((p) =>
    ['created', 'pending', 'in_process', 'authorized', 'in_mediation'].includes(
      p.status,
    ),
  );
  const canPay =
    registration.status === 'reserved' &&
    !pending &&
    !registration.suspended &&
    !registration.cancellationRequestedAt;
  return (
    <div className="mx-auto max-w-3xl">
      <EventArtwork event={registration.event}>
        <Heading eyebrow="SUA INSCRIÇÃO" title={registration.event.title}>
          Olá, {registration.name}. Acompanhe sua participação aqui.
        </Heading>
      </EventArtwork>
      {registration.status !== 'canceled' && (
        <Steps step={registration.status === 'confirmed' || pending ? 2 : 1} />
      )}
      <section className="card mb-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Status value={registration.status} />
          <div className="text-right">
            <p className="muted text-xs">Valor da inscrição</p>
            <p className="font-semibold">{money(registration.priceInCents)}</p>
          </div>
        </div>
        <p className="muted mt-4 text-sm break-all">
          {registration.name} · {registration.email}
        </p>
        {registration.status === 'reserved' && (
          <ReservationTimer
            expiresAt={registration.reservationExpiresAt}
            refresh={() => query.refetch()}
          />
        )}
        <p className="muted mt-3 text-xs">
          O link enviado ao seu e-mail é pessoal. Se expirar, solicite outro.
        </p>
        {registration.status === 'confirmed' && (
          <Notice success>
            Inscrição confirmada pelo backend. Sua vaga está garantida.
          </Notice>
        )}
        {registration.status === 'payment_review' && (
          <Notice>
            {reviewReasonText(registration.reviewReason)} O pagamento precisa de
            análise do organizador. Aguarde a atualização.
          </Notice>
        )}
        {registration.suspended && (
          <Notice>Esta inscrição foi suspensa. Consulte o organizador.</Notice>
        )}
        {registration.status === 'canceled' && (
          <Notice>
            Esta inscrição foi cancelada e não garante vaga no evento. Consulte
            os pagamentos abaixo para acompanhar a situação de cada cobrança.
          </Notice>
        )}
        {registration.cancellationRequestedAt &&
          registration.status !== 'canceled' && (
            <Notice success>
              Solicitação de cancelamento registrada. O eventual reembolso
              depende da análise do organizador.
            </Notice>
          )}
        {registration.status === 'expired' && (
          <>
            <Notice>
              Sua reserva expirou. Consulte a disponibilidade para tentar
              novamente.
            </Notice>
            <Confirm
              title="Consultar e renovar reserva?"
              description="A API verificará se ainda há vagas e se a reserva pode ser renovada."
              onConfirm={async () => {
                await send(`/public/registrations/${id}/renew`);
                await query.refetch();
              }}
            >
              Tentar renovar reserva
            </Confirm>
          </>
        )}
      </section>
      {canPay && (
        <Suspense fallback={<Loading />}>
          <Checkout
            registration={registration}
            refresh={() => query.refetch()}
          />
        </Suspense>
      )}
      <section className="data-section mt-8">
        <h2>Pagamentos e acompanhamento</h2>
        {pending && (
          <p className="muted mt-3">
            Estamos consultando a API a cada 10 segundos enquanto o pagamento
            estiver pendente.
          </p>
        )}
        {registration.payments.length === 0 ? (
          <p className="muted mt-4">Nenhum pagamento iniciado.</p>
        ) : (
          registration.payments.map((p) => (
            <div key={p.id} className="mt-5 border-t border-border pt-5">
              <div className="flex flex-wrap justify-between gap-3">
                <p>
                  {p.method === 'pix' ? 'Pix' : `Cartão · ${p.installments}x`}
                </p>
                <Status value={p.status} />
              </div>
              {p.pricing && (
                <div className="mt-4">
                  <PaymentPricingBreakdown pricing={p.pricing} historical />
                </div>
              )}
              {p.status === 'refunded' && (
                <p className="muted mt-3">
                  Este pagamento foi reembolsado pelo Mercado Pago. Consulte o
                  comprovante no provedor para acompanhar a devolução.
                </p>
              )}
              {p.method === 'pix' &&
                ['pending', 'created'].includes(p.status) &&
                p.checkout && (
                  <div className="mt-5">
                    {p.checkout.qrCodeBase64 && (
                      <img
                        className="payment-sdk-light mx-auto h-52 w-52"
                        src={`data:image/png;base64,${p.checkout.qrCodeBase64}`}
                        alt="QR Code para pagamento Pix"
                      />
                    )}
                    {p.checkout.qrCode && <PixCopy code={p.checkout.qrCode} />}
                  </div>
                )}
            </div>
          ))
        )}
        <div className="mt-6 flex flex-wrap gap-3">
          <Button variant="outline" onClick={() => query.refetch()}>
            Atualizar situação
          </Button>
          {!registration.cancellationRequestedAt &&
            registration.status !== 'canceled' && (
              <Confirm
                title="Solicitar cancelamento?"
                description="Essa ação registra uma solicitação. Não executa reembolso automático."
                onConfirm={async () => {
                  await send(`/public/registrations/${id}/cancellation`);
                  await query.refetch();
                }}
              >
                Solicitar cancelamento
              </Confirm>
            )}
        </div>
      </section>
    </div>
  );
}
function ReservationTimer({
  expiresAt,
  refresh,
}: {
  expiresAt: string;
  refresh: () => unknown;
}) {
  const [now, setNow] = useState(Date.now());
  const queried = useRef(false);
  useEffect(() => {
    queried.current = false;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);
  const remaining = Math.max(
    0,
    Math.floor((new Date(expiresAt).getTime() - now) / 1000),
  );
  useEffect(() => {
    if (remaining === 0 && !queried.current) {
      queried.current = true;
      refresh();
    }
  }, [remaining, refresh]);
  return (
    <p className="mt-4 rounded-xl bg-muted p-3 text-sm">
      {remaining
        ? `Tempo estimado de reserva: ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`
        : 'Prazo encerrado. Consultando a situação da reserva.'}
    </p>
  );
}
function PixCopy({ code }: { code: string }) {
  const [message, setMessage] = useState('');
  return (
    <div className="mt-4">
      <Textarea
        readOnly
        value={code}
        aria-label="Código Pix copia e cola"
        className="text-xs"
      />
      <Button
        variant="outline"
        className="mt-3"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(code);
            setMessage('Código copiado.');
          } catch {
            setMessage('Selecione e copie o código no campo acima.');
          }
        }}
      >
        <Copy size={17} />
        Copiar código Pix
      </Button>
      <p role="status" className="muted mt-2 text-sm">
        {message}
      </p>
    </div>
  );
}
