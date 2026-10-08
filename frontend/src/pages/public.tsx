import { useEffect, useRef, useState } from 'react';
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
  useBlocker,
} from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { CalendarDays, MapPin, ShieldCheck, Copy } from 'lucide-react';
import { initMercadoPago, CardPayment } from '@mercadopago/sdk-react';
import { api, send, ApiError } from '../api';
import {
  accessFragment,
  captureAccessFragment,
  forgetAccessFragment,
} from '../access-fragment';
import {
  Heading,
  Loading,
  Notice,
  Field,
  Status,
  Confirm,
  useUnsaved,
} from '../ui';
import { money, date, type Event, type Registration } from '../types';
const registrationSchema = z.object({
  name: z.string().trim().min(2, 'Informe seu nome completo.').max(120),
  email: z.email('Informe um e-mail válido.').max(254),
});
function Steps({ step }: { step: number }) {
  return (
    <ol className="mb-8 grid grid-cols-3 gap-2">
      {['Seus dados', 'Pagamento', 'Acompanhamento'].map((label, i) => (
        <li
          key={label}
          className={`step min-w-0 !flex-col sm:!flex-row ${i === step ? 'active' : ''}`}
          aria-current={i === step ? 'step' : undefined}
        >
          <span>{i + 1}</span>
          <span className="!block !h-auto !w-auto !border-0 !bg-transparent !text-inherit max-w-full break-words text-center text-[11px] sm:text-sm">
            {label}
          </span>
        </li>
      ))}
    </ol>
  );
}
function EventSummary({ event }: { event: Event }) {
  return (
    <aside className="card self-start lg:sticky lg:top-6">
      <p className="eyebrow">SEU PRÓXIMO ENCONTRO</p>
      <h2 className="text-2xl">{event.title}</h2>
      <div className="my-6 space-y-4">
        <p className="muted flex items-start gap-3 text-sm">
          <CalendarDays size={19} className="shrink-0 text-red-700" />
          {date(event.startsAt)}
        </p>
        <p className="muted flex items-start gap-3 text-sm">
          <MapPin size={19} className="shrink-0 text-red-700" />
          {event.location || 'Local a confirmar'}
        </p>
      </div>
      <div className="border-t border-zinc-100 pt-5">
        <p className="muted text-sm">Valor da inscrição</p>
        <p className="mt-1 text-3xl font-semibold tracking-tight">
          {money(event.priceInCents)}
        </p>
        <p className="muted mt-4 text-xs">
          {event.availableSpots} vaga(s) disponível(is) segundo a última
          consulta.
        </p>
      </div>
    </aside>
  );
}
export function PublicEvent() {
  const { publicId } = useParams();
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: ['public-event', publicId],
    queryFn: () => api<Event>(`/public/events/${publicId}`),
  });
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [answerErrors, setAnswerErrors] = useState<Record<string, string>>({});
  const [review, setReview] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [reservedId, setReservedId] = useState('');
  const form = useForm<z.infer<typeof registrationSchema>>({
    resolver: zodResolver(registrationSchema),
  });
  const dirty =
    !done && (form.formState.isDirty || Object.keys(answers).length > 0);
  useUnsaved(dirty);
  const blocker = useBlocker(dirty);
  const event = query.data;
  useEffect(() => {
    if (reservedId) navigate(`/inscricao/${reservedId}`);
  }, [reservedId, navigate]);
  const checkAnswers = () => {
    const errors: Record<string, string> = {};
    event?.form.forEach((f) => {
      const v = answers[f.id];
      if (
        f.required &&
        (v === undefined || v === '' || (f.type === 'checkbox' && v !== true))
      )
        errors[f.id] = 'Preencha esta resposta.';
      if (f.type === 'number' && v !== undefined && !Number.isFinite(v))
        errors[f.id] = 'Informe um número válido.';
    });
    setAnswerErrors(errors);
    return Object.keys(errors).length === 0;
  };
  if (query.isPending) return <Loading />;
  if (query.error)
    return (
      <>
        <Notice>{query.error.message}</Notice>
        <button className="btn secondary" onClick={() => query.refetch()}>
          Tentar novamente
        </button>
      </>
    );
  if (!event) return null;
  return (
    <>
      <Heading eyebrow="EVENTO DA LIGA" title={event.title}>
        Preencha seus dados e garanta sua participação.
      </Heading>
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <section>
          <p className="muted mb-7 whitespace-pre-wrap leading-relaxed">
            {event.description}
          </p>
          <Steps step={0} />
          {!event.acceptingRegistrations ? (
            <div className="card">
              <Notice>
                Este evento não está aceitando inscrições no momento.
              </Notice>
              <Link
                className="btn secondary"
                to={`/recuperar?evento=${publicId}`}
              >
                Já me inscrevi
              </Link>
            </div>
          ) : (
            <form
              className="card space-y-5"
              onSubmit={form.handleSubmit(() => {
                if (checkAnswers()) setReview(true);
              })}
            >
              <h2>
                {review ? 'Confira antes de continuar' : 'Vamos conhecer você'}
              </h2>
              {error && <Notice>{error}</Notice>}
              {review ? (
                <>
                  <dl className="space-y-3">
                    <div>
                      <dt className="muted text-xs">NOME</dt>
                      <dd>{form.getValues('name')}</dd>
                    </div>
                    <div>
                      <dt className="muted text-xs">E-MAIL</dt>
                      <dd className="break-all">{form.getValues('email')}</dd>
                    </div>
                    {event.form.map((f) => (
                      <div key={f.id}>
                        <dt className="muted text-xs">{f.label}</dt>
                        <dd>
                          {typeof answers[f.id] === 'boolean'
                            ? answers[f.id]
                              ? 'Sim'
                              : 'Não'
                            : String(answers[f.id] ?? 'Não informado')}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <div className="rounded-xl bg-zinc-50 p-4">
                    <p className="text-sm">{event.title}</p>
                    <p className="mt-2 font-semibold">
                      {money(event.priceInCents)}
                    </p>
                    <p className="muted mt-2 text-xs">
                      Sua vaga será reservada pela API. O pagamento vem na
                      próxima etapa.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      className="btn secondary"
                      disabled={busy}
                      onClick={() => setReview(false)}
                    >
                      Corrigir dados
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        setError('');
                        try {
                          const record = await send<{ id: string }>(
                            `/public/events/${publicId}/registrations`,
                            { ...form.getValues(), answers },
                          );
                          setDone(true);
                          setReservedId(record.id);
                        } catch (e) {
                          setError((e as Error).message);
                          setBusy(false);
                        }
                      }}
                    >
                      {busy ? 'Reservando…' : 'Reservar e escolher pagamento →'}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <Field
                    label="Nome completo"
                    error={form.formState.errors.name?.message}
                  >
                    <input autoComplete="name" {...form.register('name')} />
                  </Field>
                  <Field
                    label="E-mail"
                    hint="Usaremos este endereço para enviar seu link pessoal."
                    error={form.formState.errors.email?.message}
                  >
                    <input
                      type="email"
                      autoComplete="email"
                      {...form.register('email')}
                    />
                  </Field>
                  {event.form.map((f) => (
                    <Field
                      key={f.id}
                      label={`${f.label}${f.required ? ' *' : ''}`}
                      error={answerErrors[f.id]}
                    >
                      {f.type === 'checkbox' ? (
                        <input
                          type="checkbox"
                          checked={answers[f.id] === true}
                          onChange={(e) =>
                            setAnswers({ ...answers, [f.id]: e.target.checked })
                          }
                        />
                      ) : f.type === 'select' ? (
                        <select
                          value={String(answers[f.id] ?? '')}
                          onChange={(e) => {
                            const copy = { ...answers };
                            if (e.target.value) copy[f.id] = e.target.value;
                            else delete copy[f.id];
                            setAnswers(copy);
                          }}
                        >
                          <option value="">Selecione</option>
                          {f.options?.map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type={f.type === 'number' ? 'number' : 'text'}
                          step={f.type === 'number' ? 'any' : undefined}
                          value={String(answers[f.id] ?? '')}
                          maxLength={f.type === 'text' ? 5000 : undefined}
                          onChange={(e) => {
                            const copy = { ...answers };
                            if (e.target.value !== '')
                              copy[f.id] =
                                f.type === 'number'
                                  ? Number(e.target.value)
                                  : e.target.value;
                            else delete copy[f.id];
                            setAnswers(copy);
                          }}
                        />
                      )}
                    </Field>
                  ))}
                  <button
                    className="btn w-full"
                    disabled={form.formState.isSubmitting}
                  >
                    Revisar minha inscrição →
                  </button>
                </>
              )}
              <Link
                className="inline-block text-sm text-red-800"
                to={`/recuperar?evento=${publicId}`}
              >
                Já se inscreveu? Solicite seu link de acesso.
              </Link>
            </form>
          )}
        </section>
        <EventSummary event={event} />
      </div>
      {blocker.state === 'blocked' && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
          <div
            className="card max-w-md"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="leave-registration"
          >
            <h2 id="leave-registration">Sair sem concluir?</h2>
            <p className="muted my-4">O preenchimento será perdido.</p>
            <div className="flex gap-3">
              <button
                className="btn secondary"
                autoFocus
                onClick={() => blocker.reset()}
              >
                Continuar
              </button>
              <button className="btn" onClick={() => blocker.proceed()}>
                Sair
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
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
        <Link className="btn" to="/recuperar">
          Solicitar novo link
        </Link>
      </>
    );
  if (!accessReady || query.isPending) return <Loading />;
  if (query.error)
    return (
      <>
        <Notice>{query.error.message}</Notice>
        <Link className="btn" to="/recuperar">
          Solicitar link de acesso
        </Link>
        <button className="btn secondary ml-3" onClick={() => query.refetch()}>
          Tentar novamente
        </button>
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
      <Heading eyebrow="SUA INSCRIÇÃO" title={registration.event.title}>
        Olá, {registration.name}. Acompanhe sua participação aqui.
      </Heading>
      <Steps step={registration.status === 'confirmed' || pending ? 2 : 1} />
      <section className="card mb-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Status value={registration.status} />
          <p className="font-semibold">{money(registration.priceInCents)}</p>
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
            O pagamento precisa de análise do organizador. Aguarde a
            atualização.
          </Notice>
        )}
        {registration.suspended && (
          <Notice>Esta inscrição foi suspensa. Consulte o organizador.</Notice>
        )}
        {registration.cancellationRequestedAt && (
          <Notice success>
            Solicitação de cancelamento registrada. O eventual reembolso depende
            da análise do organizador.
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
        <Checkout registration={registration} refresh={() => query.refetch()} />
      )}
      <section className="card mt-6">
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
            <div key={p.id} className="mt-5 border-t border-zinc-100 pt-5">
              <div className="flex flex-wrap justify-between gap-3">
                <p>
                  {p.method === 'pix' ? 'Pix' : `Cartão · ${p.installments}x`}
                </p>
                <Status value={p.status} />
              </div>
              {p.method === 'pix' &&
                ['pending', 'created'].includes(p.status) &&
                p.checkout && (
                  <div className="mt-5">
                    {p.checkout.qrCodeBase64 && (
                      <img
                        className="mx-auto h-52 w-52"
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
          <button className="btn secondary" onClick={() => query.refetch()}>
            Atualizar situação
          </button>
          {!registration.cancellationRequestedAt && (
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
    <p className="mt-4 rounded-xl bg-zinc-50 p-3 text-sm">
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
      <textarea
        readOnly
        value={code}
        aria-label="Código Pix copia e cola"
        className="text-xs"
      />
      <button
        className="btn secondary mt-3"
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
      </button>
      <p role="status" className="muted mt-2 text-sm">
        {message}
      </p>
    </div>
  );
}
type PaymentBody = {
  method: 'pix' | 'card';
  installments: number;
  cpf: string;
  cardToken?: string;
  paymentMethodId?: string;
  issuerId?: string;
};
function Checkout({
  registration,
  refresh,
}: {
  registration: Registration;
  refresh: () => Promise<unknown>;
}) {
  const [method, setMethod] = useState<'pix' | 'card'>('pix');
  const [cpf, setCpf] = useState('');
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
      }>(`/public/registrations/${registration.id}/checkout`),
  });
  const [sdk, setSdk] = useState(false);
  useEffect(() => {
    if (method === 'card' && config.data) {
      try {
        initMercadoPago(config.data.publicKey, { locale: 'pt-BR' });
        setSdk(true);
      } catch {
        setError('Não foi possível iniciar o formulário do cartão.');
      }
    }
  }, [method, config.data]);
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
            <button
              className="btn secondary"
              disabled={busy}
              onClick={() => refresh()}
            >
              Consultar resultado
            </button>
            <button
              className="btn"
              disabled={busy}
              onClick={() => attempt.current && pay(attempt.current.body)}
            >
              Repetir mesma tentativa
            </button>
          </div>
        </>
      ) : reviewBody ? (
        <div className="mt-5 space-y-4">
          <h2>Revise o pagamento</h2>
          <p>
            {registration.name} · {registration.email}
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
            <button
              className="btn secondary"
              disabled={busy}
              onClick={() => setReviewBody(undefined)}
            >
              Corrigir
            </button>
            <button
              className="btn"
              disabled={busy}
              onClick={() => pay(reviewBody)}
            >
              {busy ? 'Enviando…' : 'Confirmar pagamento'}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="my-5 flex gap-3">
            <button
              className={`btn ${method === 'pix' ? '' : 'secondary'}`}
              onClick={() => {
                setMethod('pix');
                setError('');
              }}
            >
              Pix
            </button>
            <button
              className={`btn ${method === 'card' ? '' : 'secondary'}`}
              onClick={() => {
                setMethod('card');
                setError('');
              }}
            >
              Cartão
            </button>
          </div>
          {method === 'pix' ? (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                const normalized = cpf.replace(/\D/g, '');
                if (normalized.length !== 11) {
                  setError('Informe o CPF com 11 dígitos.');
                  return;
                }
                setError('');
                setReviewBody({
                  method: 'pix',
                  cpf: normalized,
                  installments: 1,
                });
              }}
            >
              <Field
                label="CPF do pagador"
                hint="Necessário para processar o pagamento."
              >
                <input
                  inputMode="numeric"
                  autoComplete="off"
                  value={cpf}
                  maxLength={14}
                  onChange={(e) => setCpf(e.target.value)}
                />
              </Field>
              <button className="btn" disabled={busy}>
                Revisar pagamento Pix
              </button>
            </form>
          ) : sdk && config.data ? (
            <CardPayment
              key={config.data.publicKey}
              initialization={{
                amount: config.data.amountInCents / 100,
                payer: { email: registration.email },
              }}
              customization={{
                paymentMethods: {
                  maxInstallments: config.data.maxInstallments,
                },
              }}
              onSubmit={async (data) => {
                setReviewBody({
                  method: 'card',
                  cardToken: data.token,
                  paymentMethodId: data.payment_method_id,
                  issuerId:
                    data.issuer_id === undefined
                      ? undefined
                      : String(data.issuer_id),
                  installments: data.installments,
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
const recoverySchema = z.object({
  publicId: z.uuid('Informe o identificador ou link completo do evento.'),
  email: z.email('Informe o e-mail usado na inscrição.'),
});
export function RecoveryPage() {
  const [params] = useSearchParams();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const form = useForm<z.infer<typeof recoverySchema>>({
    resolver: zodResolver(recoverySchema),
    defaultValues: { publicId: params.get('evento') || '', email: '' },
  });
  return (
    <div className="mx-auto max-w-lg">
      <Heading eyebrow="ACOMPANHAMENTO" title="Volte à sua inscrição">
        Solicite um novo link pessoal no e-mail usado para se inscrever.
      </Heading>
      <form
        className="card space-y-5"
        onSubmit={form.handleSubmit(async (values) => {
          setError('');
          setMessage('');
          try {
            const result = await send<{ message: string }>(
              '/public/access/recover',
              values,
            );
            setMessage(result.message);
          } catch (e) {
            setError((e as Error).message);
          }
        })}
      >
        {message && <Notice success>{message}</Notice>}
        {error && <Notice>{error}</Notice>}
        <Field
          label="Link ou identificador do evento"
          error={form.formState.errors.publicId?.message}
        >
          <input
            {...form.register('publicId')}
            onChange={(e) => {
              const value = e.target.value.trim();
              const match = /\/eventos\/([0-9a-f-]{36})/i.exec(value);
              form.setValue('publicId', match ? match[1] : value, {
                shouldValidate: true,
              });
            }}
            placeholder="Cole o link que recebeu da liga"
          />
        </Field>
        <Field label="Seu e-mail" error={form.formState.errors.email?.message}>
          <input
            type="email"
            autoComplete="email"
            {...form.register('email')}
          />
        </Field>
        <button className="btn w-full" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting
            ? 'Solicitando…'
            : 'Enviar link de acesso'}
        </button>
      </form>
    </div>
  );
}
export function StatusPage() {
  const { id } = useParams();
  const [token] = useState(() => accessFragment('token'));
  useEffect(() => captureAccessFragment(), []);
  const query = useQuery({
    queryKey: ['status', id],
    queryFn: () =>
      api<{
        name: string;
        status: string;
        suspended: boolean;
        event: { title: string; location: string; startsAt: string };
      }>(`/public/registrations/${id}/status`, {
        headers: { 'x-registration-status-token': token || '' },
      }),
    enabled: !!token,
  });
  if (!token)
    return (
      <>
        <Notice>Solicite um novo link para consultar sua inscrição.</Notice>
        <Link className="btn" to="/recuperar">
          Solicitar link
        </Link>
      </>
    );
  if (query.isPending) return <Loading />;
  if (query.error)
    return (
      <>
        <Notice>{query.error.message}</Notice>
        <Link className="btn" to="/recuperar">
          Solicitar novo link
        </Link>
      </>
    );
  return (
    <div className="mx-auto max-w-xl">
      <Heading title={query.data?.event.title || 'Sua inscrição'} />
      <section className="card">
        <Status value={query.data?.status || ''} />
        <p className="mt-5">Olá, {query.data?.name}.</p>
        <p className="muted mt-3">
          {date(query.data?.event.startsAt)} · {query.data?.event.location}
        </p>
        <Link className="btn secondary mt-6" to="/recuperar">
          Solicitar acesso à gestão da inscrição
        </Link>
      </section>
    </div>
  );
}
