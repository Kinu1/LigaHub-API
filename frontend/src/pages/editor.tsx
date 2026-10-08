import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useBlocker } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Trash2, ArrowLeft, ArrowRight } from 'lucide-react';
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
const schema = z.object({
  title: z.string().trim().min(1, 'Informe o título.').max(200),
  description: z.string().max(10000),
  location: z.string().max(500),
  startsAt: z.string(),
  endsAt: z.string(),
  registrationDeadline: z.string(),
  price: z
    .string()
    .regex(
      /^\d+(?:[.,]\d{1,2})?$/,
      'Informe um valor positivo, com até duas casas decimais.',
    )
    .refine(
      (v) => Number(v.replace(',', '.')) > 0,
      'O preço deve ser positivo.',
    ),
  capacity: z
    .number()
    .int()
    .min(1, 'Informe pelo menos uma vaga.')
    .max(2147483647),
  reservationMinutes: z.number().int().min(5).max(60),
  ownerId: z.string(),
});
type Values = z.infer<typeof schema>;
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
  const [saved, setSaved] = useState(false);
  const [savedId, setSavedId] = useState('');
  const [error, setError] = useState('');
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
    resolver: zodResolver(schema),
    defaultValues: {
      title: '',
      description: '',
      location: '',
      startsAt: '',
      endsAt: '',
      registrationDeadline: '',
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
        description: e.description,
        location: e.location,
        startsAt: localDate(e.startsAt),
        endsAt: localDate(e.endsAt),
        registrationDeadline: localDate(e.registrationDeadline),
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
  const steps = ['Informações', 'Vagas e preço', 'Formulário', 'Revisão'];
  const group: (keyof Values)[][] = [
    [
      'title',
      'description',
      'location',
      'startsAt',
      'endsAt',
      'registrationDeadline',
    ],
    ['price', 'capacity', 'reservationMinutes', 'ownerId'],
    [],
  ];
  const validateFields = () => {
    if (
      fields.some(
        (f) =>
          !f.label.trim() ||
          (f.type === 'select' &&
            (!f.options?.length || f.options.some((o) => !o.trim()))),
      )
    ) {
      setError('Preencha o nome de cada pergunta e as opções de seleção.');
      return false;
    }
    if (new Set(fields.map((f) => f.id)).size !== fields.length) {
      setError('Os identificadores das perguntas devem ser únicos.');
      return false;
    }
    return true;
  };
  const submit = async (v: Values) => {
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
          description: v.description,
          location: v.location,
          startsAt: isoDate(v.startsAt) ?? (id ? null : undefined),
          endsAt: isoDate(v.endsAt) ?? (id ? null : undefined),
          registrationDeadline:
            isoDate(v.registrationDeadline) ?? (id ? null : undefined),
          priceInCents: toCents(v.price),
          capacity: v.capacity,
          reservationMinutes: v.reservationMinutes,
          ...(user?.role === 'admin' ? { ownerId: v.ownerId } : {}),
          form: fields,
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
              <div className="grid gap-5 md:grid-cols-3">
                {(
                  [
                    ['startsAt', 'Início'],
                    ['endsAt', 'Fim'],
                    ['registrationDeadline', 'Inscrições até'],
                  ] as const
                ).map(([name, label]) => (
                  <Field
                    key={name}
                    label={label}
                    hint="Horário de Brasília"
                    error={err[name]?.message}
                  >
                    <input type="datetime-local" {...form.register(name)} />
                  </Field>
                ))}
              </div>
            </div>
          )}
          {step === 1 && (
            <div className="space-y-5">
              <h2>Vagas e pagamento</h2>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field
                  label="Preço da inscrição (R$)"
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
                hint="Entre 5 e 60 minutos. A API controla a expiração."
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
                Após a primeira inscrição, o backend protege preço, formulário e
                responsável contra alterações.
              </p>
            </div>
          )}
          {step === 2 && (
            <div>
              <div className="mb-5 flex flex-wrap justify-between gap-4">
                <div>
                  <h2>Perguntas aos participantes</h2>
                  <p className="muted mt-2 text-sm">
                    Nome e e-mail já estão incluídos. Adicione até 25 perguntas.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn secondary"
                  disabled={fields.length >= 25}
                  onClick={() => {
                    setFields([
                      ...fields,
                      {
                        id: `campo_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`,
                        label: '',
                        type: 'text',
                        required: false,
                      },
                    ]);
                    setFieldsDirty(true);
                  }}
                >
                  <Plus size={17} />
                  Adicionar pergunta
                </button>
              </div>
              {fields.length === 0 && (
                <p className="muted py-10 text-center">
                  Nenhuma pergunta extra. Você pode continuar.
                </p>
              )}
              {fields.map((f, index) => {
                const update = (patch: Partial<FormField>) => {
                  setFields(
                    fields.map((item, i) =>
                      i === index ? { ...item, ...patch } : item,
                    ),
                  );
                  setFieldsDirty(true);
                };
                return (
                  <div
                    className="mb-4 rounded-xl border border-zinc-200 p-5"
                    key={f.id}
                  >
                    <div className="mb-4 flex items-center justify-between">
                      <p className="text-sm font-semibold">
                        Pergunta {index + 1}
                      </p>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Remover pergunta ${index + 1}`}
                        onClick={() => {
                          setFields(fields.filter((_, i) => i !== index));
                          setFieldsDirty(true);
                        }}
                      >
                        <Trash2 size={17} />
                      </button>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Pergunta">
                        <input
                          value={f.label}
                          maxLength={150}
                          onChange={(e) => update({ label: e.target.value })}
                        />
                      </Field>
                      <Field label="Tipo de resposta">
                        <select
                          value={f.type}
                          onChange={(e) =>
                            update({
                              type: e.target.value as FormField['type'],
                              options:
                                e.target.value === 'select' ? [''] : undefined,
                            })
                          }
                        >
                          <option value="text">Texto</option>
                          <option value="number">Número</option>
                          <option value="select">Seleção</option>
                          <option value="checkbox">Checkbox</option>
                        </select>
                      </Field>
                    </div>
                    {f.type === 'select' && (
                      <div className="mt-4">
                        <Field label="Opções (uma por linha)">
                          <textarea
                            value={f.options?.join('\n') || ''}
                            onChange={(e) =>
                              update({ options: e.target.value.split('\n') })
                            }
                          />
                        </Field>
                      </div>
                    )}
                    <label className="mt-4 flex items-center gap-3 text-sm">
                      <input
                        type="checkbox"
                        checked={f.required}
                        onChange={(e) => update({ required: e.target.checked })}
                      />
                      Resposta obrigatória
                    </label>
                  </div>
                );
              })}
            </div>
          )}
          {step === 3 && (
            <div>
              <p className="eyebrow">PRÉVIA · AINDA NÃO PUBLICADO</p>
              <h2 className="text-2xl">{values.title}</h2>
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
                <h2 className="mb-4">Prévia do formulário</h2>
                <div className="space-y-4">
                  <Field label="Nome completo">
                    <input disabled placeholder="Nome do participante" />
                  </Field>
                  <Field label="E-mail">
                    <input disabled placeholder="participante@exemplo.com" />
                  </Field>
                  {fields.map((f) => (
                    <Field
                      key={f.id}
                      label={`${f.label}${f.required ? ' *' : ''}`}
                    >
                      {f.type === 'checkbox' ? (
                        <input type="checkbox" disabled />
                      ) : f.type === 'select' ? (
                        <select disabled>
                          <option>Selecione</option>
                          {f.options?.map((o) => (
                            <option key={o}>{o}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          disabled
                          type={f.type === 'number' ? 'number' : 'text'}
                        />
                      )}
                    </Field>
                  ))}
                </div>
              </div>
              <p className="muted mt-4 text-sm">
                Salvar cria ou atualiza o evento. A publicação acontece
                separadamente, após as verificações do backend.
              </p>
            </div>
          )}
        </section>
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
              type="button"
              className="btn"
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
            <button className="btn" disabled={form.formState.isSubmitting}>
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
