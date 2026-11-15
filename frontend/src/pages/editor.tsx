import { MotionSection } from '../experience';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '../components/ui/alert-dialog';
import { EventArtwork, EventImageInput } from './event-images';
import { useEffect, useRef, useState } from 'react';
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
  type RegistrationType,
} from '../types';
type RegistrationDraft = { id: string; name: string; price: string; capacity: string };
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
            Number(v.replace(',', '.')) === 0 || Number(v.replace(',', '.')) >= 0.5 ||
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
  const [registrationTypes, setRegistrationTypes] = useState<RegistrationDraft[]>([
    { id: crypto.randomUUID(), name: 'Inscrição geral', price: '', capacity: '' },
  ]);
  const [registrationTypesDirty, setRegistrationTypesDirty] = useState(false);
  const [registrationTypesError, setRegistrationTypesError] = useState('');
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
  const dirty = !saved && (form.formState.isDirty || fieldsDirty || registrationTypesDirty);
  useUnsaved(dirty);
  const leaveFocus = useRef<HTMLElement | null>(null);
  const blocker = useBlocker(() => {
    if (dirty) leaveFocus.current = document.activeElement as HTMLElement;
    return dirty;
  });
  useEffect(() => {
    if (query.data && !form.formState.isDirty && !fieldsDirty && !registrationTypesDirty) {
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
      setRegistrationTypes(e.registrationTypes?.length
        ? e.registrationTypes.map((type) => ({ id: type.id, name: type.name, price: (type.priceInCents / 100).toFixed(2), capacity: type.capacity == null ? '' : String(type.capacity) }))
        : [{ id: crypto.randomUUID(), name: 'Inscrição geral', price: (e.priceInCents / 100).toFixed(2), capacity: '' }]);
    }
  }, [query.data, form, fieldsDirty, registrationTypesDirty]);
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
  const validateTypes = () => {
    if (id && !registrationTypesDirty) return true;
    const valid = registrationTypes.length > 0 && registrationTypes.every((type) =>
      type.name.trim() && /^\d+(?:[.,]\d{1,2})?$/.test(type.price) &&
      (toCents(type.price) === 0 || toCents(type.price) >= 50) &&
      (type.capacity === '' || (Number.isInteger(Number(type.capacity)) && Number(type.capacity) > 0)));
    setRegistrationTypesError(valid ? '' : 'Cada tipo precisa de categoria e valor válido (gratuito ou a partir de R$ 0,50); vagas devem ser positivas.');
    return valid;
  };
  const submit = async (v: Values) => {
    if (preparingImage) return;
    setError('');
    if (!validateTypes()) { setStep(1); return; }
    if (!validateFields()) return;
    if (user?.role === 'admin' && !v.ownerId) {
      setError('Cadastre um organizador ativo antes de criar o evento.');
      return;
    }
    try {
      const types: RegistrationType[] = registrationTypes.map((type) => ({ id: type.id, name: type.name.trim(), priceInCents: toCents(type.price), capacity: type.capacity === '' ? null : Number(type.capacity) }));
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
          ...(!id || registrationTypesDirty ? { registrationTypes: types } : {}),
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
      setRegistrationTypesDirty(false);
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
      <ol className="editor-steps mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4" aria-label="Etapas do evento">
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
      <form className="editor-form" onSubmit={form.handleSubmit(submit)}>
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
                <input type="hidden" {...form.register('price')} />
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div><h3 className="font-semibold">Tipos de inscrição</h3><p className="muted mt-1 text-sm">Crie categorias com valores e limites de vagas diferentes.</p></div>
                    <button type="button" className="btn secondary" onClick={() => {
                      setRegistrationTypes((items) => [...items, { id: crypto.randomUUID(), name: '', price: '', capacity: '' }]);
                      setRegistrationTypesDirty(true);
                    }}>Adicionar tipo</button>
                  </div>
                  {registrationTypes.map((type, index) => {
                    const update = (patch: Partial<RegistrationDraft>) => {
                      setRegistrationTypes((items) => items.map((item) => item.id === type.id ? { ...item, ...patch } : item));
                      setRegistrationTypesDirty(true);
                      if (index === 0 && patch.price !== undefined) form.setValue('price', patch.price, { shouldDirty: true, shouldValidate: true });
                    };
                    return <div key={type.id} className="rounded-xl border border-border p-4">
                      <div className="mb-4 flex min-h-10 items-center justify-between gap-3">
                        <h4 className="font-medium">Tipo {index + 1}</h4>
                        {registrationTypes.length > 1 && <button type="button" className="btn secondary" onClick={() => {
                          const next = registrationTypes.filter((item) => item.id !== type.id);
                          setRegistrationTypes(next);
                          setRegistrationTypesDirty(true);
                          form.setValue('price', next[0].price, { shouldDirty: true, shouldValidate: true });
                        }}>Remover</button>}
                      </div>
                      <div className="grid items-start gap-4 sm:grid-cols-3">
                        <Field label="Categoria"><input value={type.name} maxLength={120} placeholder="Estudante, profissional..." onChange={(e) => update({ name: e.target.value })} /></Field>
                        <div className="grid gap-2">
                          <Field label="Valor (R$)" error={index === 0 ? err.price?.message : undefined}>
                            <input inputMode="decimal" value={type.price} placeholder="Mínimo: R$ 0,50" onChange={(e) => update({ price: e.target.value })} />
                          </Field>
                          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={type.price === '0' || type.price === '0.00'} onChange={(e) => update({ price: e.target.checked ? '0' : '' })} />Gratuita</label>
                        </div>
                        <Field label="Vagas deste tipo" hint="Deixe vazio para usar somente o limite geral do evento."><input type="number" min={1} value={type.capacity} placeholder="Sem limite próprio" onChange={(e) => update({ capacity: e.target.value })} /></Field>
                      </div>
                    </div>;
                  })}
                  {registrationTypesError && <p role="alert" className="text-sm text-destructive">{registrationTypesError}</p>}
                </div>
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Capacidade total do evento" error={err.capacity?.message}>
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
                  Após a primeira inscrição, os tipos de inscrição, as perguntas e o
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
                      {registrationTypes.map((type) => <span className="block" key={type.id}>{type.name || 'Categoria sem nome'} · {toCents(type.price) === 0 ? 'Gratuita' : money(toCents(type.price))}</span>)}
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
                  if (step === 1 && !validateTypes()) return;
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
      <AlertDialog open={blocker.state === 'blocked'} onOpenChange={(open) => { if (!open && blocker.state === 'blocked') blocker.reset(); }}>
        <AlertDialogContent onCloseAutoFocus={(event) => {
          event.preventDefault();
          leaveFocus.current?.focus();
        }}>
          <AlertDialogHeader>
            <AlertDialogTitle>Sair sem salvar?</AlertDialogTitle>
            <AlertDialogDescription>Seu preenchimento será perdido.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => blocker.state === 'blocked' && blocker.reset()}>Continuar editando</AlertDialogCancel>
            <AlertDialogAction onClick={() => blocker.state === 'blocked' && blocker.proceed()}>Sair sem salvar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
