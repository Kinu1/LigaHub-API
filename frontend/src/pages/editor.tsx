import { MotionSection } from '../experience';
import { EventArtwork, EventImageInput } from './event-images';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useBlocker } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import {
  ScheduleField,
  ScheduleSection,
  scheduleError,
} from './event-schedule';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import {
  EventQuestions,
  questionError,
  QuestionsPreview,
} from './event-questions';
import { api, send, ApiError } from '../api';
import { useAuth } from '../auth';
import { Heading, Loading, Notice, Field, useUnsaved } from '../ui';
import {
  money,
  date,
  type Event,
  type Field as FormField,
  type User,
} from '../types';
const scheduleValue = z.string().superRefine((value, context) => {
  const message = scheduleError(value);
  if (message) context.addIssue({ code: 'custom', message });
});
const createSchema = (existingPriceInCents?: number) =>
  z
    .object({
      title: z.string().trim().min(1, 'Informe o título.').max(200),
      logoImage: z.string().max(400000),
      bannerImage: z.string().max(400000),
      description: z.string().max(10000),
      location: z.string().max(500),
      startsAt: scheduleValue,
      endsAt: scheduleValue,
      registrationDeadline: scheduleValue,
      registrationStartsAt: scheduleValue,
      price: z
        .string()
        .regex(
          /^\d+(?:[.,]\d{1,2})?$/,
          'Informe um valor positivo, com até duas casas decimais.',
        )
        .refine(
          (v) =>
            Number(v.replace(',', '.')) >= 0.5 ||
            (existingPriceInCents !== undefined &&
              toCents(v) === existingPriceInCents),
          'O preço mínimo da inscrição é R$ 0,50.',
        ),
      capacity: z
        .number()
        .int()
        .min(1, 'Informe pelo menos uma vaga.')
        .max(2147483647),
      reservationMinutes: z.number().int().min(5).max(60),
      ownerId: z.string(),
    })
    .superRefine((value, context) => {
      const deadline = value.registrationDeadline || value.startsAt;
      if (
        value.registrationStartsAt &&
        !scheduleError(value.registrationStartsAt) &&
        (!deadline ||
          (!scheduleError(deadline) && value.registrationStartsAt >= deadline))
      )
        context.addIssue({
          code: 'custom',
          path: ['registrationStartsAt'],
          message:
            'A abertura deve ser antes do encerramento das inscrições e do início do evento.',
        });
      if (
        value.endsAt &&
        !scheduleError(value.endsAt) &&
        (!value.startsAt ||
          (!scheduleError(value.startsAt) && value.endsAt <= value.startsAt))
      )
        context.addIssue({
          code: 'custom',
          path: ['endsAt'],
          message: 'O término deve ser depois do início do evento.',
        });
      if (
        value.registrationDeadline &&
        !scheduleError(value.registrationDeadline) &&
        (!value.startsAt ||
          (!scheduleError(value.startsAt) &&
            value.registrationDeadline > value.startsAt))
      )
        context.addIssue({
          code: 'custom',
          path: ['registrationDeadline'],
          message:
            'Defina o início do evento e encerre as inscrições até esse horário.',
        });
    });
type Values = z.infer<ReturnType<typeof createSchema>>;
export function toCents(value: string) {
  const [whole, decimal = ''] = value.replace(',', '.').split('.');
  return Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
}
export function localDate(value: string | null) {
  if (!value) return '';
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(new Date(value))
    .replace(' ', 'T');
}
export function isoDate(value: string) {
  return value ? new Date(`${value}:00-03:00`).toISOString() : undefined;
}
export function EventEditor() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [step, setStep] = useState(0);
  const [fields, setFields] = useState<FormField[]>([]);
  const [fieldsDirty, setFieldsDirty] = useState(false);
  const [showQuestionErrors, setShowQuestionErrors] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savedId, setSavedId] = useState('');
  const [error, setError] = useState('');
  const [imageBusy, setImageBusy] = useState({ logo: false, banner: false });
  const preparingImage = imageBusy.logo || imageBusy.banner;
  const query = useQuery({
    queryKey: ['event', id],
    queryFn: () => api<Event>(`/events/${id}`),
    enabled: !!id,
  });
  const users = useQuery({
    queryKey: ['users'],
    queryFn: () => api<User[]>('/users'),
    enabled: user?.role === 'admin',
  });
  const form = useForm<Values>({
    resolver: zodResolver(createSchema(query.data?.priceInCents)),
    defaultValues: {
      title: '',
      logoImage: '',
      bannerImage: '',
      description: '',
      location: '',
      startsAt: '',
      endsAt: '',
      registrationDeadline: '',
      registrationStartsAt: '',
      price: '',
      capacity: 50,
      reservationMinutes: 15,
      ownerId: '',
    },
  });
  const dirty = !saved && (form.formState.isDirty || fieldsDirty);
  useUnsaved(dirty);
  const blocker = useBlocker(dirty);
  useEffect(() => {
    if (query.data && !form.formState.isDirty && !fieldsDirty) {
      const e = query.data;
      form.reset({
        title: e.title,
        logoImage: e.logoImage ?? '',
        bannerImage: e.bannerImage ?? '',
        description: e.description,
        location: e.location,
        startsAt: localDate(e.startsAt),
        endsAt: localDate(e.endsAt),
        registrationDeadline: localDate(e.registrationDeadline),
        registrationStartsAt: localDate(e.registrationStartsAt),
        price: (e.priceInCents / 100).toFixed(2),
        capacity: e.capacity,
        reservationMinutes: e.reservationMinutes,
        ownerId: e.ownerId,
      });
      setFields(e.form);
    }
  }, [query.data, form]);
  useEffect(() => {
    if (!id && users.data) {
      const organizer = users.data.find(
        (u) => u.role === 'organizer' && u.active,
      );
      if (organizer) form.setValue('ownerId', organizer.id);
    }
  }, [users.data, id, form]);
  useEffect(() => {
    if (savedId) navigate(`/painel/eventos/${savedId}`);
  }, [savedId, navigate]);
  const values = form.watch();
  const err = form.formState.errors;
  const steps = [
    'Informações',
    'Vagas e preço',
    'Perguntas da inscrição',
    'Revisão',
  ];
  const group: (keyof Values)[][] = [
    [
      'title',
      'logoImage',
      'bannerImage',
      'description',
      'location',
      'startsAt',
      'endsAt',
      'registrationDeadline',
      'registrationStartsAt',
    ],
    ['price', 'capacity', 'reservationMinutes', 'ownerId'],
    [],
  ];
  const validateFields = () => {
    setShowQuestionErrors(true);
    const invalidIndex = fields.findIndex((field) => questionError(field));
    if (invalidIndex !== -1) {
      setError(
        `Pergunta ${invalidIndex + 1}: ${questionError(fields[invalidIndex])}`,
      );
      setStep(2);
      return false;
    }
    if (new Set(fields.map((f) => f.id)).size !== fields.length) {
      setError('Os identificadores das perguntas devem ser únicos.');
      return false;
    }
    return true;
  };
  const submit = async (v: Values) => {
    if (preparingImage) return;
    setError('');
    if (!validateFields()) return;
    if (user?.role === 'admin' && !v.ownerId) {
      setError('Cadastre um organizador ativo antes de criar o evento.');
      return;
    }
    try {
      const event = await send<Event>(
        id ? `/events/${id}` : '/events',
        {
          title: v.title,
          logoImage: v.logoImage || null,
          bannerImage: v.bannerImage || null,
          description: v.description,
          location: v.location,
          startsAt: isoDate(v.startsAt) ?? (id ? null : undefined),
          endsAt: isoDate(v.endsAt) ?? (id ? null : undefined),
          registrationDeadline:
            isoDate(v.registrationDeadline) ?? (id ? null : undefined),
          registrationStartsAt:
            isoDate(v.registrationStartsAt) ?? (id ? null : undefined),
          ...(id && query.data?.priceInCents === toCents(v.price)
            ? {}
            : { priceInCents: toCents(v.price) }),
          capacity: v.capacity,
          reservationMinutes: v.reservationMinutes,
          ...(user?.role === 'admin' ? { ownerId: v.ownerId } : {}),
          form: fields.map(({ options, ...field }) => ({
            ...field,
            ...(field.type === 'select'
              ? { options: options?.map((option) => option.trim()) }
              : {}),
          })),
        },
        id ? 'PATCH' : 'POST',
      );
      setSaved(true);
      setSavedId(event.id);
      form.reset(v);
      setFieldsDirty(false);
      await client.invalidateQueries({ queryKey: ['events'] });
      await client.invalidateQueries({ queryKey: ['event', id] });
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiError && e.fields)
        Object.entries(e.fields).forEach(([key, message]) =>
          form.setError(key as keyof Values, { message }),
        );
    }
  };
  if (id && query.isPending) return <Loading />;
  if (query.error) return <Notice>{query.error.message}</Notice>;
  return (
    <>
      <Link
        className="mb-5 inline-block text-sm text-zinc-500"
        to={id ? `/painel/eventos/${id}` : '/painel/eventos'}
      >
        ← Voltar aos eventos
      </Link>
      <Heading title={id ? 'Editar evento' : 'Prepare seu próximo encontro'}>
        Um passo de cada vez, do primeiro detalhe ao convite.
      </Heading>
      <ol className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {steps.map((label, index) => (
          <li
            key={label}
            className={`step ${step === index ? 'active' : ''}`}
            aria-current={step === index ? 'step' : undefined}
          >
            <span>{index + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      {error && <Notice>{error}</Notice>}
      <form onSubmit={form.handleSubmit(submit)}>
        <MotionSection change={step}>
          <section className="card">
            {step === 0 && (
              <div className="space-y-5">
                <h2>Sobre o evento</h2>
                <Field label="Nome do evento" error={err.title?.message}>
                  <input
                    {...form.register('title')}
                    maxLength={200}
                    placeholder="Ex.: Jornada da Liga Acadêmica"
                  />
                </Field>
                <Field label="Descrição" error={err.description?.message}>
                  <textarea
                    {...form.register('description')}
                    placeholder="Conte aos participantes o que esperar."
                  />
                </Field>
                <Field label="Local" error={err.location?.message}>
                  <input {...form.register('location')} />
                </Field>
                <section
                  aria-labelledby="event-images-title"
                  className="border-t border-zinc-200 pt-6"
                >
                  <h3 id="event-images-title" className="font-semibold">
                    Identidade visual do evento
                  </h3>
                  <p className="muted mt-1 mb-5 text-sm">
                    Adicione uma logo e um banner para quem abrir o link do
                    evento. As imagens são opcionais.
                  </p>
                  <div className="flex flex-col gap-6">
                    <EventImageInput
                      kind="banner"
                      value={values.bannerImage}
                      onChange={(value) =>
                        form.setValue('bannerImage', value, {
                          shouldDirty: true,
                          shouldValidate: true,
                        })
                      }
                      onBusyChange={(busy) =>
                        setImageBusy((current) => ({ ...current, banner: busy }))
                      }
                    />
                    <EventImageInput
                      kind="logo"
                      value={values.logoImage}
                      onChange={(value) =>
                        form.setValue('logoImage', value, {
                          shouldDirty: true,
                          shouldValidate: true,
                        })
                      }
                      onBusyChange={(busy) =>
                        setImageBusy((current) => ({
                          ...current,
                          logo: busy,
                        }))
                      }
                    />
                  </div>
                </section>
                <ScheduleSection
                  deadline={
                    <>
                      <Controller
                        name="registrationStartsAt"
                        control={form.control}
                        render={({ field, fieldState }) => (
                          <ScheduleField
                            title="Início das inscrições"
                            description="Em branco, as inscrições abrem ao publicar o evento."
                            {...field}
                            onChange={(value) => {
                              form.setValue(field.name, value, {
                                shouldDirty: true,
                                shouldValidate: true,
                              });
                            }}
                            error={fieldState.error?.message}
                          />
                        )}
                      />
                      <Controller
                        name="registrationDeadline"
                        control={form.control}
                        render={({ field, fieldState }) => (
                          <ScheduleField
                            title="Encerramento das inscrições"
                            description="Pode ser antes ou no mesmo horário de início do evento."
                            {...field}
                            onChange={(value) => {
                              form.setValue(field.name, value, {
                                shouldDirty: true,
                                shouldValidate: true,
                              });
                            }}
                            error={fieldState.error?.message}
                          />
                        )}
                      />
                    </>
                  }
                >
                  <Controller
                    name="startsAt"
                    control={form.control}
                    render={({ field, fieldState }) => (
                      <ScheduleField
                        title="Início do evento"
                        {...field}
                        onChange={(value) => {
                          form.setValue(field.name, value, {
                            shouldDirty: true,
                            shouldValidate: true,
                          });
                        }}
                        error={fieldState.error?.message}
                      />
                    )}
                  />
                  <Controller
                    name="endsAt"
                    control={form.control}
                    render={({ field, fieldState }) => (
                      <ScheduleField
                        title="Término do evento"
                        {...field}
                        onChange={(value) => {
                          form.setValue(field.name, value, {
                            shouldDirty: true,
                            shouldValidate: true,
                          });
                        }}
                        error={fieldState.error?.message}
                      />
                    )}
                  />
                </ScheduleSection>
              </div>
            )}
            {step === 1 && (
              <div className="space-y-5">
                <h2>Vagas e pagamento</h2>
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field
                    label="Preço da inscrição (R$)"
                    hint="Valor mínimo: R$ 0,50."
                    error={err.price?.message}
                  >
                    <input
                      inputMode="decimal"
                      {...form.register('price')}
                      placeholder="25,00"
                    />
                  </Field>
                  <Field label="Capacidade" error={err.capacity?.message}>
                    <input
                      type="number"
                      min={1}
                      {...form.register('capacity', { valueAsNumber: true })}
                    />
                  </Field>
                </div>
                <Field
                  label="Reserva temporária (minutos)"
                  hint="Tempo para concluir o pagamento antes de liberar a vaga. Entre 5 e 60 minutos."
                  error={err.reservationMinutes?.message}
                >
                  <input
                    type="number"
                    min={5}
                    max={60}
                    {...form.register('reservationMinutes', {
                      valueAsNumber: true,
                    })}
                  />
                </Field>
                {user?.role === 'admin' && (
                  <Field label="Organizador responsável">
                    <select {...form.register('ownerId')}>
                      <option value="">Selecione o responsável</option>
                      {users.data
                        ?.filter((u) => u.role === 'organizer' && u.active)
                        .map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                )}
                <p className="muted text-sm">
                  Após a primeira inscrição, o preço, as perguntas e o
                  responsável não poderão ser alterados.
                </p>
              </div>
            )}
            {step === 2 && (
              <EventQuestions
                fields={fields}
                showErrors={showQuestionErrors}
                onChange={(next) => {
                  setFields(next);
                  setFieldsDirty(true);
                  setError('');
                }}
              />
            )}
            {step === 3 && (
              <div>
                <p className="eyebrow">PRÉVIA · AINDA NÃO PUBLICADO</p>
                <EventArtwork event={values}>
                  <h2 className="text-2xl">{values.title}</h2>
                </EventArtwork>
                <p className="muted mt-3 whitespace-pre-wrap">
                  {values.description || 'Sem descrição.'}
                </p>
                <div className="my-6 grid gap-4 sm:grid-cols-3">
                  <div>
                    <p className="muted text-xs">DATA</p>
                    <p className="mt-2">{date(isoDate(values.startsAt))}</p>
                  </div>
                  <div>
                    <p className="muted text-xs">LOCAL</p>
                    <p className="mt-2">{values.location || 'A confirmar'}</p>
                  </div>
                  <div>
                    <p className="muted text-xs">INSCRIÇÃO</p>
                    <p className="mt-2 font-semibold">
                      {money(toCents(values.price))}
                    </p>
                  </div>
                </div>
                <div className="rounded-xl bg-zinc-50 p-5">
                  <p className="mb-2 text-sm">
                    Início das inscrições:{' '}
                    {values.registrationStartsAt
                      ? date(isoDate(values.registrationStartsAt))
                      : 'Ao publicar o evento'}
                  </p>
                  <p className="mb-5 text-sm">
                    Encerramento das inscrições:{' '}
                    {date(
                      isoDate(values.registrationDeadline || values.startsAt),
                    )}
                  </p>
                  <h2 className="mb-4">Prévia do formulário</h2>
                  <QuestionsPreview fields={fields} />
                </div>
                <p className="muted mt-4 text-sm">
                  Salvar cria ou atualiza o evento. A publicação acontece
                  separadamente, na página do evento.
                </p>
              </div>
            )}
          </section>
        </MotionSection>
        <div className="mt-6 flex justify-between gap-4">
          <button
            type="button"
            className="btn secondary"
            disabled={step === 0 || form.formState.isSubmitting}
            onClick={() => setStep(step - 1)}
          >
            <ArrowLeft size={17} />
            Anterior
          </button>
          {step < 3 ? (
            <button
              key="continue"
              type="button"
              className="btn"
              disabled={preparingImage}
              onClick={async () => {
                setError('');
                if (await form.trigger(group[step])) {
                  if (step !== 2 || validateFields()) setStep(step + 1);
                }
              }}
            >
              Continuar <ArrowRight size={17} />
            </button>
          ) : (
            <button
              key="save"
              type="submit"
              className="btn"
              disabled={form.formState.isSubmitting}
            >
              {form.formState.isSubmitting ? 'Salvando…' : 'Salvar evento'}
            </button>
          )}
        </div>
      </form>
      {blocker.state === 'blocked' && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
          <div
            className="card max-w-md"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="unsaved-title"
          >
            <h2 id="unsaved-title">Sair sem salvar?</h2>
            <p className="muted my-4">Seu preenchimento será perdido.</p>
            <div className="flex gap-3">
              <button
                className="btn secondary"
                autoFocus
                onClick={() => blocker.reset()}
              >
                Continuar editando
              </button>
              <button className="btn" onClick={() => blocker.proceed()}>
                Sair sem salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
