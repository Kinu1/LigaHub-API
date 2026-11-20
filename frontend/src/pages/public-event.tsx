import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, MapPin } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useBlocker, useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import { api, send } from '../api';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/ui/alert-dialog';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import {
  date,
  formatCpf,
  money,
  type Event,
  type RegistrationType,
} from '../types';
import { Field, Heading, Loading, Notice, useUnsaved } from '../ui';
import { EventArtwork } from './event-images';
import { Steps } from './public-shared';
const registrationSchema = z.object({
  name: z.string().trim().min(2, 'Informe seu nome completo.').max(120),
  cpf: z
    .string()
    .transform((value) => value.replace(/[.\-\s]/g, ''))
    .refine((value) => /^\d{11}$/.test(value), 'Informe o CPF com 11 dígitos.'),
  email: z.email('Informe um e-mail válido.').max(254),
});
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
          <>
            {registrationType.priceInCents > 0 && event.pixFeePolicy && (
              <p className="mt-3 text-sm">
                No Pix: acréscimo de{' '}
                {money(event.pixFeePolicy.platformFeeInCents)} de taxa de
                serviço LigaHub e tarifa do Mercado Pago, quando aplicável. O
                total será exibido antes de confirmar o pagamento.
              </p>
            )}
            <p className="muted mt-4 text-xs">
              {event.availableSpots} vaga(s) disponível(is) segundo a última
              consulta.
            </p>
          </>
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
                  {selectedRegistrationType.priceInCents > 0 &&
                    event.pixFeePolicy && (
                      <p className="text-sm">
                        O valor acima é da inscrição. No Pix, o participante
                        paga também{' '}
                        {money(event.pixFeePolicy.platformFeeInCents)} ao
                        LigaHub e a tarifa de processamento do Mercado Pago, se
                        houver. Você verá a composição e o total antes de pagar.
                      </p>
                    )}
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
