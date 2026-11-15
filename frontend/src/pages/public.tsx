import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '../components/ui/alert-dialog';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { useEffect, useRef, useState } from 'react';
import { EventArtwork } from './event-images';
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
import {
  money,
  reviewReasonText,
  date,
  formatCpf,
  type Event,
  type Registration,
  type RegistrationType,
} from '../types';
const registrationSchema = z.object({
  name: z.string().trim().min(2, 'Informe seu nome completo.').max(120),
  cpf: z
    .string()
    .transform((value) => value.replace(/[.\-\s]/g, ''))
    .refine((value) => /^\d{11}$/.test(value), 'Informe o CPF com 11 dígitos.'),
  email: z.email('Informe um e-mail válido.').max(254),
});
function Steps({ step }: { step: number }) {
  return (
    <ol
      className="editor-steps mb-8 grid grid-cols-3 gap-2"
      aria-label="Etapas da inscrição"
    >
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
function EventSummary({
  event,
  registrationType,
}: {
  event: Event;
  registrationType: RegistrationType;
}) {
  return (
    <aside
      className="event-summary order-first self-start lg:order-last lg:sticky lg:top-6"
      aria-label="Resumo do evento"
    >
      <p className="eyebrow">SUA PARTICIPAÇÃO</p>
      <h2 className="text-2xl">{event.title}</h2>
      <div className="my-6 space-y-4">
        <p className="muted flex items-start gap-3 text-sm">
          <CalendarDays size={19} className="shrink-0 text-primary" />
          {date(event.startsAt)}
        </p>
        <p className="muted flex items-start gap-3 text-sm">
          <MapPin size={19} className="shrink-0 text-primary" />
          {event.location || 'Local a confirmar'}
        </p>
      </div>
      <div className="border-t border-border pt-5">
        <p className="muted text-sm">{registrationType.name}</p>
        <p className="mt-1 text-3xl font-semibold tracking-tight">
          {registrationType.priceInCents === 0
            ? 'Gratuita'
            : money(registrationType.priceInCents)}
        </p>
        {event.availableSpots !== undefined && (
          <p className="muted mt-4 text-xs">
            {event.availableSpots} vaga(s) disponível(is) segundo a última
            consulta.
          </p>
        )}
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
    refetchInterval: 30000,
  });
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [answerErrors, setAnswerErrors] = useState<Record<string, string>>({});
  const [review, setReview] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [reservedId, setReservedId] = useState('');
  const [selectedTypeId, setSelectedTypeId] = useState('');
  const form = useForm<z.infer<typeof registrationSchema>>({
    resolver: zodResolver(registrationSchema),
    defaultValues: { cpf: '' },
  });
  const dirty =
    !done && (form.formState.isDirty || Object.keys(answers).length > 0);
  useUnsaved(dirty);
  const leaveFocus = useRef<HTMLElement | null>(null);
  const blocker = useBlocker(() => {
    const leaving = dirty;
    if (leaving) leaveFocus.current = document.activeElement as HTMLElement;
    return leaving;
  });
  const event = query.data;
  const registrationTypes: RegistrationType[] = event?.registrationTypes?.length
    ? event.registrationTypes
    : event
      ? [
          {
            id: 'geral',
            name: 'Inscrição geral',
            priceInCents: event.priceInCents,
            capacity: null,
          },
        ]
      : [];
  const selectedRegistrationType = registrationTypes.find(
    (type) => type.id === selectedTypeId,
  ) ??
    registrationTypes[0] ?? {
      id: 'geral',
      name: 'Inscrição geral',
      priceInCents: event?.priceInCents ?? 0,
      capacity: null,
    };
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
        <Button variant="outline" onClick={() => query.refetch()}>
          Tentar novamente
        </Button>
      </>
    );
  if (!event) return null;
  return (
    <>
      <EventArtwork event={event}>
        <Heading eyebrow="EVENTO DA LIGA" title={event.title}>
          Preencha seus dados e garanta sua participação.
        </Heading>
      </EventArtwork>
      <div className="public-event-grid grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section>
          <p className="muted mb-7 whitespace-pre-wrap leading-relaxed">
            {event.description}
          </p>
          <Steps step={0} />
          {!event.acceptingRegistrations ? (
            <div className="card">
              <Notice>
                {event.status === 'published' &&
                event.registrationStartsAt &&
                new Date(event.registrationStartsAt) > new Date()
                  ? `As inscrições abrem em ${date(event.registrationStartsAt)} (horário de Brasília).`
                  : 'Este evento não está aceitando inscrições no momento.'}
              </Notice>
              <Button asChild variant="outline">
                <Link to={`/recuperar?evento=${publicId}`}>Já me inscrevi</Link>
              </Button>
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
                    <div>
                      <dt className="muted text-xs">CPF DO PARTICIPANTE</dt>
                      <dd>
                        {formatCpf(
                          form.getValues('cpf')?.replace(/[.\-\s]/g, ''),
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="muted text-xs">TIPO DE INSCRIÇÃO</dt>
                      <dd>{selectedRegistrationType.name}</dd>
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
                  <div className="rounded-xl bg-muted p-4">
                    <p className="text-sm">{event.title}</p>
                    <p className="mt-2 font-semibold">
                      {selectedRegistrationType.priceInCents === 0
                        ? 'Inscrição gratuita'
                        : money(selectedRegistrationType.priceInCents)}
                    </p>
                    <p className="muted mt-2 text-xs">
                      {selectedRegistrationType.priceInCents === 0
                        ? 'Sua inscrição gratuita será confirmada pela API.'
                        : 'Sua vaga será reservada pela API. O pagamento vem na próxima etapa.'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={() => setReview(false)}
                    >
                      Corrigir dados
                    </Button>
                    <Button
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        setError('');
                        try {
                          const record = await send<{ id: string }>(
                            `/public/events/${publicId}/registrations`,
                            {
                              ...form.getValues(),
                              cpf:
                                form
                                  .getValues('cpf')
                                  ?.replace(/[.\-\s]/g, '') || undefined,
                              answers,
                              registrationTypeId: selectedRegistrationType.id,
                            },
                          );
                          setDone(true);
                          setReservedId(record.id);
                        } catch (e) {
                          setError((e as Error).message);
                          setBusy(false);
                        }
                      }}
                    >
                      {busy
                        ? 'Reservando…'
                        : selectedRegistrationType.priceInCents === 0
                          ? 'Confirmar inscrição gratuita'
                          : 'Reservar e escolher pagamento →'}
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  {registrationTypes.length > 1 && (
                    <Field label="Tipo de inscrição">
                      <select
                        value={selectedRegistrationType.id}
                        onChange={(e) => setSelectedTypeId(e.target.value)}
                      >
                        {registrationTypes.map((type) => (
                          <option
                            key={type.id}
                            value={type.id}
                            disabled={
                              type.availableSpots === 0 ||
                              (type.priceInCents > 0 && !event.publicKey)
                            }
                          >
                            {type.name} ·{' '}
                            {type.priceInCents === 0
                              ? 'Gratuita'
                              : money(type.priceInCents)}
                            {type.availableSpots === 0
                              ? ' · Esgotada'
                              : type.priceInCents > 0 && !event.publicKey
                                ? ' · Pagamento indisponível'
                                : ''}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}
                  <Field
                    label="Nome completo"
                    error={form.formState.errors.name?.message}
                  >
                    <Input autoComplete="name" {...form.register('name')} />
                  </Field>
                  <Field
                    label="CPF do participante"
                    hint="Obrigatório. O pagamento deverá usar este mesmo CPF."
                    error={form.formState.errors.cpf?.message}
                  >
                    <Input
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={14}
                      placeholder="000.000.000-00"
                      {...form.register('cpf')}
                    />
                  </Field>
                  <Field
                    label="E-mail"
                    hint="Usaremos este endereço para enviar seu link pessoal."
                    error={form.formState.errors.email?.message}
                  >
                    <Input
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
                        <Input
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
                  <Button
                    className="w-full"
                    disabled={form.formState.isSubmitting}
                  >
                    Revisar minha inscrição →
                  </Button>
                </>
              )}
              <Link
                className="inline-block text-sm text-primary"
                to={`/recuperar?evento=${publicId}`}
              >
                Já se inscreveu? Solicite seu link de acesso.
              </Link>
            </form>
          )}
        </section>
        <EventSummary
          event={event}
          registrationType={selectedRegistrationType}
        />
      </div>
      <AlertDialog
        open={blocker.state === 'blocked'}
        onOpenChange={(open) => {
          if (!open && blocker.state === 'blocked') blocker.reset();
        }}
      >
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            // This dialog is opened by a route blocker, without a Radix trigger.
            event.preventDefault();
            leaveFocus.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Sair sem concluir?</AlertDialogTitle>
            <AlertDialogDescription>
              O preenchimento será perdido.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={(event) => {
                event.preventDefault();
                blocker.reset?.();
              }}
            >
              Continuar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                blocker.proceed?.();
              }}
            >
              Sair
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
        <Checkout registration={registration} refresh={() => query.refetch()} />
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
type PaymentBody = {
  method: 'pix' | 'card';
  installments: number;
  cpf: string;
  payerName: string;
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
          ) : sdk && config.data ? (
            <div className="payment-sdk-light">
              <CardPayment
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
          <Input
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
          <Input
            type="email"
            autoComplete="email"
            {...form.register('email')}
          />
        </Field>
        <Button
          className="h-auto min-h-9 w-full whitespace-normal"
          disabled={form.formState.isSubmitting}
        >
          {form.formState.isSubmitting
            ? 'Solicitando…'
            : 'Enviar link de acesso'}
        </Button>
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
        cancellationRequested: boolean;
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
        <Button asChild>
          <Link to="/recuperar">Solicitar link</Link>
        </Button>
      </>
    );
  if (query.isPending) return <Loading />;
  if (query.error)
    return (
      <>
        <Notice>{query.error.message}</Notice>
        <Button asChild>
          <Link to="/recuperar">Solicitar novo link</Link>
        </Button>
      </>
    );
  return (
    <div className="mx-auto max-w-xl">
      <Heading title={query.data?.event.title || 'Sua inscrição'} />
      <section className="card">
        <Status value={query.data?.status || ''} />
        {query.data?.suspended && (
          <Notice>
            Sua inscrição está suspensa. Entre em contato com a organização do
            evento.
          </Notice>
        )}
        {query.data?.status === 'canceled' && (
          <Notice>
            Sua inscrição foi cancelada e não garante vaga no evento. Para
            consultar os pagamentos, solicite acesso à gestão da inscrição.
          </Notice>
        )}
        {query.data?.cancellationRequested &&
          query.data.status !== 'canceled' && (
            <Notice>
              O cancelamento da sua inscrição foi solicitado. Entre em contato
              com a organização para acompanhar a solicitação.
            </Notice>
          )}
        <p className="mt-5">Olá, {query.data?.name}.</p>
        <p className="muted mt-3">
          {date(query.data?.event.startsAt)} · {query.data?.event.location}
        </p>
        <Button
          asChild
          variant="outline"
          className="mt-6 h-auto min-h-9 whitespace-normal"
        >
          <Link to="/recuperar">Solicitar acesso à gestão da inscrição</Link>
        </Button>
      </section>
    </div>
  );
}
